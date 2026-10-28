import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gatewayKeyFor } from "./auth.mjs"
import { presentation } from "./config.mjs"
import { recordTranslation, replaceTranslation, addComparison, findHistory, hasSeen, markDelivered, markSeen, restoreFeed, wasDelivered, writePublicFeed } from "./history.mjs"
import { findPlugin, pluginPresence, pluginTurnedOff, readPluginList, syncHostSurface } from "./options.mjs"
import { dataDir, ensureDir, magpieBaseUrl, noteGatewayActivity, writeAtomic } from "./paths.mjs"
import { HEARTBEAT_MS, PUBLISH_WAIT_REASONS, STALE_MS, beatIsStale, lockIsStale, pidAlive, publishBackoff, shouldExitAfterPublish, workerToken } from "./proc.mjs"
import { claimCompare, enqueue, finishClaim, holdCompare, queueDepth, queueWaitMs, recoverProcessing, replayJournal, takeJob, touchClaim } from "./queue.mjs"
import { persistItem } from "./sinks.mjs"
import { CONNECT_ATTEMPTS, connectBackoff, connectionFailure, translateJob } from "./translate.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKER_SCRIPT = fileURLToPath(new URL("./worker.mjs", import.meta.url))
const PASSTHROUGH = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP", "MAGPIE_BASE_URL"]

function sourceHash() {
  const hash = createHash("sha256")
  for (const name of ["worker.mjs", "translate.mjs", "mask.mjs", "queue.mjs", "hooks.mjs", "history.mjs", "options.mjs", "proc.mjs"]) {
    hash.update(fs.readFileSync(path.join(HERE, name)))
  }
  return hash.digest("hex").slice(0, 16)
}

export function alive(pid) {
  return pidAlive(pid)
}

export { shouldExitAfterPublish, workerToken }

export function shouldSpawn(env = process.env) {
  return env.MAGPIE_TRANSLATOR_NO_SPAWN !== "1"
}

export function lockPath(env = process.env) {
  return path.join(dataDir(env), "worker.lock")
}

export function minimalEnv(env, dir = dataDir(env), token = "") {
  const out = {}
  for (const key of PASSTHROUGH) {
    const value = env[key]
    if (typeof value === "string" && value) out[key] = value
  }
  out.MAGPIE_TRANSLATOR_HOME = dir
  out.MAGPIE_TRANSLATOR_PARENT_PID = String(process.pid)
  if (token) out.MAGPIE_TRANSLATOR_LOCK_TOKEN = String(token)
  if (env.MAGPIE_TRANSLATOR_HOLD_AFTER_RECORD) out.MAGPIE_TRANSLATOR_HOLD_AFTER_RECORD = env.MAGPIE_TRANSLATOR_HOLD_AFTER_RECORD
  if (env.MAGPIE_TRANSLATOR_NO_PROC === "1") out.MAGPIE_TRANSLATOR_NO_PROC = "1"
  if (env.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD) out.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD = env.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD
  return out
}

function readLock(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function parentPid(env = process.env) {
  const pid = Number(env.MAGPIE_TRANSLATOR_PARENT_PID)
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

export function parentGone(env = process.env) {
  const pid = parentPid(env)
  return pid > 0 && !alive(pid)
}

export function pluginShouldExit(env = process.env) {
  const state = pluginPresence(env)
  return state === "off" || state === "absent"
}

function stopError() {
  const err = new Error("worker stopping")
  err.name = "StopWorker"
  return err
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const ACQUIRE_LIMIT_MS = 5000

function stopFile(dir) {
  return path.join(dir, "worker.stop")
}

function requestStop(dir, reason) {
  writeAtomic(stopFile(dir), `${reason}\n`)
}

function stopRequested(dir) {
  try { return fs.existsSync(stopFile(dir)) } catch { return false }
}

function clearStop(dir) {
  try { fs.unlinkSync(stopFile(dir)) } catch { /* 没有停止文件 */ }
}

function lockBody(id, hash, parent) {
  return {
    token: id,
    heartbeat: Date.now(),
    hash,
    parent: Number(parent) || 0,
    pid: process.pid,
  }
}

function restoreGrave(grave, file) {
  try { fs.linkSync(grave, file) } catch { return false }
  try { fs.unlinkSync(grave) } catch { /* 已经链回去了 */ }
  return true
}

// 过期锁用各自的墓碑名字 rename 拿走。rename 失败的人继续抢。
// 若拿走的不是刚才那把过期锁，就 link 回去；link 失败就留下墓碑，避免删掉新主人的文件。
async function takeStale(dir, file, seen, id) {
  const staleToken = String(seen?.token || "")
  if (!staleToken) return "retry"
  const again = readLock(file)
  if (!again || String(again.token) !== staleToken || !lockIsStale(again)) return "retry"
  const grave = path.join(dir, `worker.lock.dead.${staleToken}.${id}`)
  try { fs.renameSync(file, grave) } catch { return "retry" }
  const moved = readLock(grave)
  if (!moved || String(moved.token) !== staleToken || !lockIsStale(moved)) {
    restoreGrave(grave, file)
    return "retry"
  }
  try { fs.unlinkSync(grave) } catch { /* 过期锁可以留着 */ }
  return "ready"
}

export async function acquireWorkerLock(dir, hash, parent, token = process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN) {
  ensureDir(dir)
  const id = String(token || randomBytes(16).toString("hex"))
  process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN = id
  const file = path.join(dir, "worker.lock")
  const privateFile = path.join(dir, `worker.lock.${id}`)
  const deadline = Date.now() + ACQUIRE_LIMIT_MS
  const writePrivate = () => writeAtomic(privateFile, `${JSON.stringify(lockBody(id, hash, parent))}\n`)
  while (Date.now() < deadline) {
    writePrivate()
    try {
      fs.linkSync(privateFile, file)
    } catch (err) {
      if (err?.code !== "EEXIST") {
        try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
        return false
      }
      const current = readLock(file)
      if (current && String(current.token) === id) {
        try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
        clearStop(dir)
        sweepDeadLocks(dir)
        return true
      }
      if (current && !lockIsStale(current)) {
        if (current.hash !== hash) requestStop(dir, "hash")
        try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
        return false
      }
      await takeStale(dir, file, current || {}, id)
      continue
    }
    const owned = readLock(file)
    if (owned && String(owned.token) === id) {
      try { fs.unlinkSync(privateFile) } catch { /* 锁已经链上 */ }
      clearStop(dir)
      sweepDeadLocks(dir)
      return true
    }
  }
  try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
  return false
}

function releaseWorkerLock(dir, token) {
  const file = path.join(dir, "worker.lock")
  const current = readLock(file)
  if (!current || String(current.token) !== String(token)) return
  const grave = path.join(dir, `worker.lock.dead.${token}`)
  try { fs.renameSync(file, grave) } catch { return }
  const moved = readLock(grave)
  if (!moved || String(moved.token) !== String(token)) {
    restoreGrave(grave, file)
    return
  }
  try { fs.unlinkSync(grave) } catch { /* 已经不在 */ }
  sweepDeadLocks(dir)
}

export function sweepDeadLocks(dir, now = Date.now()) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const name of names) {
    if (!name.startsWith("worker.lock.dead.")) continue
    const file = path.join(dir, name)
    const record = readLock(file)
    const beat = Number(record?.heartbeat)
    let stale = false
    if (Number.isFinite(beat) && beat > 0) stale = beatIsStale(beat, now)
    else {
      try { stale = now - fs.statSync(file).mtimeMs > STALE_MS } catch { continue }
    }
    if (!stale) continue
    try { fs.unlinkSync(file) } catch { /* 可能正被链回去 */ }
  }
}

export function refreshWorkerLock(dir, token) {
  const file = path.join(dir, "worker.lock")
  const current = readLock(file)
  if (!current) return true
  if (String(current.token) !== String(token)) return false
  const next = { ...current, heartbeat: Date.now(), pid: process.pid }
  const temp = path.join(dir, `worker.lock.beat.${token}`)
  try { writeAtomic(temp, `${JSON.stringify(next)}\n`) } catch { return true }
  const again = readLock(file)
  if (!again || String(again.token) !== String(token)) {
    try { fs.unlinkSync(temp) } catch { /* 临时心跳可以留着 */ }
    return false
  }
  try { fs.renameSync(temp, file) } catch {
    try { fs.unlinkSync(temp) } catch { /* 临时心跳可以留着 */ }
    return true
  }
  const check = readLock(file)
  if (!check) return true
  return String(check.token) === String(token)
}

export function workerLaunch(env, dir, token) {
  const args = []
  if (env.MAGPIE_TRANSLATOR_NO_PROC === "1" && env.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD) {
    args.push("--preload", String(env.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD))
  }
  args.push(WORKER_SCRIPT)
  return {
    command: process.execPath,
    args,
    options: {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: dir,
      env: minimalEnv(env, dir, token),
    },
  }
}

// 锁靠心跳。心跳还新就不另起进程，也不发信号。代码变了就写停止文件，让旧工人自己退出。
export function ensureWorker(env = process.env) {
  if (!shouldSpawn(env)) return false
  const dir = dataDir(env)
  ensureDir(dir)
  const hash = sourceHash()
  const current = readLock(lockPath(env))
  if (current && !lockIsStale(current)) {
    if (current.hash !== hash) requestStop(dir, "hash")
    return false
  }
  const token = randomBytes(16).toString("hex")
  const launch = workerLaunch(env, dir, token)
  const child = spawn(launch.command, launch.args, launch.options)
  child.unref()
  return true
}

function scrub(job) {
  const clean = { ...job }
  delete clean.__claim
  delete clean.ownerPid
  delete clean.ownerStart
  delete clean.ownerToken
  delete clean.heartbeat
  delete clean.gatewayKey
  delete clean.notBefore
  delete clean.connAttempts
  return clean
}

function keepClaimFresh(claim, env) {
  const timer = setInterval(() => {
    try { touchClaim(claim, env) } catch { /* 下一拍再写 */ }
  }, HEARTBEAT_MS)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
}

function watchStop(env, ac, extra) {
  const stop = () => {
    if (pluginShouldExit(env) || (typeof extra === "function" && extra())) ac.abort()
  }
  stop()
  const timer = setInterval(stop, 200)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
}

function lockLost(opts) {
  return typeof opts.lockLost === "function" && opts.lockLost()
}

async function holdAfterRecord(env) {
  const file = env.MAGPIE_TRANSLATOR_HOLD_AFTER_RECORD
  if (!file) return
  fs.writeFileSync(file, "ready\n")
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    let text = ""
    try { text = fs.readFileSync(file, "utf8") } catch { /* 文件刚被换掉 */ }
    if (text.includes("go")) return
    await sleep(20)
  }
}

export async function runQueued(job, env = process.env, opts = {}) {
  const claim = job?.__claim
  const attempts = Number(job?.connAttempts) || 0
  const clean = scrub(job)
  if (clean.id && (findHistory(clean.id, env) || wasDelivered(clean.id, env))) {
    finishClaim(claim, env)
    return findHistory(clean.id, env)
  }
  const ac = new AbortController()
  const stopWatch = watchStop(env, ac, opts.lockLost)
  const releaseBeat = keepClaimFresh(claim, env)
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    if (pluginShouldExit(env) || lockLost(opts)) throw stopError()
    translation = await translateJob({ ...clean, gatewayKey: gatewayKeyFor(env) }, {
      fetchImpl: opts.fetchImpl,
      signal: ac.signal,
    })
  } catch (err) {
    if (err?.name === "StopWorker" || (ac.signal.aborted && (pluginShouldExit(env) || lockLost(opts)))) {
      throw stopError()
    }
    if (connectionFailure(err) && attempts + 1 < CONNECT_ATTEMPTS) {
      try {
        enqueue({
          ...clean,
          connAttempts: attempts + 1,
          notBefore: Date.now() + connectBackoff(attempts + 1),
        }, env)
        finishClaim(claim, env)
        return { requeued: true }
      } catch {
        error = String(err?.message || err).slice(0, 500)
      }
    } else {
      error = String(err?.message || err).slice(0, 500)
    }
  } finally {
    stopWatch()
    releaseBeat()
    noteGatewayActivity(env)
  }
  const entry = {
    ...clean,
    ms: Date.now() - started,
    translation,
    error,
    status: error ? "error" : "done",
  }
  const recorded = recordTranslation(entry, env, clean.historyLimit)
  if (error && recorded && !recorded.error && (recorded.status === "done" || recorded.status === "ok")) {
    finishClaim(claim, env)
    return findHistory(clean.id, env) || recorded
  }
  const first = markDelivered(clean.id, env)
  writePublicFeed(env)
  if (first) {
    await persistItem(env, entry, clean.display, clean.webhookUrl, {
      origin: clean.origin,
      allowRemoteExport: clean.allowRemoteExport,
    })
  }
  if (typeof opts.afterRecord === "function") await opts.afterRecord(entry)
  await holdAfterRecord(env)
  finishClaim(claim, env)
  return entry
}

function pluginOptions(env) {
  try {
    const loaded = readPluginList(env)
    if (loaded.missing) return null
    const entry = findPlugin(loaded.list, env, {})
    if (!entry || entry.off === true) return null
    return entry.options && typeof entry.options === "object" ? entry.options : {}
  } catch {
    return null
  }
}

export async function processCompare(env = process.env, opts = {}) {
  const options = opts.options || pluginOptions(env)
  const request = options?._compare
  if (!request || typeof request !== "object") return false
  const nonce = String(request.nonce || "")
  const entryId = String(request.entryId || "")
  const translator = String(request.translator || "").trim()
  if (!nonce || !entryId || !translator) return false
  if (hasSeen(nonce, env)) return false
  const claim = claimCompare(env, {
    nonce,
    entryId,
    translator,
    replace: request.replace === true,
  })
  if (!claim) return false
  const releaseHold = holdCompare(nonce)
  let finished = false
  const ac = new AbortController()
  const stopWatch = watchStop(env, ac, opts.lockLost)
  const releaseBeat = keepClaimFresh(claim, env)
  try {
    const row = findHistory(entryId, env)
    if (!row) {
      markSeen(nonce, env)
      finished = true
      return false
    }
    const view = presentation(options)
    const started = Date.now()
    let translation = ""
    let error = ""
    const job = {
      translator,
      language: row.language || view.language,
      prompt: row.prompt || "",
      style: row.style || "",
      model: row.model || "",
      original: row.original || "",
      masked: row.maskCode ? (row.masked || row.original || "") : (row.original || ""),
      slots: row.maskCode && Array.isArray(row.slots) ? row.slots : [],
      magpieBaseUrl: magpieBaseUrl(options, env),
      translateTimeoutMs: view.translateTimeoutMs,
    }
    try {
      if (pluginShouldExit(env) || lockLost(opts)) throw stopError()
      translation = await translateJob({ ...job, gatewayKey: gatewayKeyFor(env) }, {
        fetchImpl: opts.fetchImpl,
        signal: ac.signal,
      })
    } catch (err) {
      if (err?.name === "StopWorker" || (ac.signal.aborted && (pluginShouldExit(env) || lockLost(opts)))) {
        throw stopError()
      }
      error = String(err?.message || err).slice(0, 500)
    }
    const patch = {
      id: `compare-${nonce}`,
      translator,
      translation,
      error,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    }
    if (request.replace === true) replaceTranslation(entryId, patch, env)
    else addComparison(entryId, patch, env)
    markSeen(nonce, env)
    writePublicFeed(env)
    finished = true
    return true
  } finally {
    stopWatch()
    releaseBeat()
    releaseHold()
    noteGatewayActivity(env)
    if (finished) finishClaim(claim, env)
  }
}

export async function processOnce(env = process.env, opts = {}) {
  replayJournal(env)
  recoverProcessing(env)
  restoreFeed(env, opts.historyLimit)
  const job = takeJob(env)
  if (job) {
    await runQueued(job, env, opts)
    return true
  }
  return processCompare(env, opts)
}

export async function drain(env = process.env, opts = {}) {
  let n = 0
  while (await processOnce(env, opts)) {
    n += 1
    if (n > 100) break
  }
  return n
}

async function loop() {
  const dir = dataDir()
  const hash = sourceHash()
  if (!await acquireWorkerLock(dir, hash, process.env.MAGPIE_TRANSLATOR_PARENT_PID)) return
  const token = workerToken()
  let released = false
  let lost = false
  const shutdown = () => {
    if (released) return
    released = true
    releaseWorkerLock(dir, token)
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGHUP", shutdown)
  const beat = setInterval(() => {
    if (!refreshWorkerLock(dir, token)) lost = true
  }, HEARTBEAT_MS)
  if (typeof beat.unref === "function") beat.unref()
  let idle = 0
  let retrySince = 0
  let retryAttempt = 0
  try {
    for (;;) {
      if (lost) break
      if (pluginShouldExit()) break
      if (!parentGone() && stopRequested(dir)) break
      let did = false
      let holdFeed = false
      try {
        did = await processOnce(process.env, { lockLost: () => lost })
      } catch (err) {
        if (err?.name === "StopWorker") break
        did = false
      }
      if (queueDepth() === 0) {
        let published = { wrote: false, reason: "empty" }
        const publishOpts = parentGone() ? { debounceMs: 0, minIntervalMs: 0 } : {}
        try { published = syncHostSurface(process.env, publishOpts) } catch { published = { wrote: false, reason: "error" } }
        holdFeed = !parentGone() && (published.reason === "debounce" || published.reason === "rate")
        const waiting = PUBLISH_WAIT_REASONS.includes(published.reason)
        if (waiting) {
          if (!retrySince) retrySince = Date.now()
        } else {
          retrySince = 0
          retryAttempt = 0
        }
        if (shouldExitAfterPublish({ parentDead: parentGone(), reason: published.reason, retrySince })) break
        if (waiting && parentGone()) {
          const wait = publishBackoff(retryAttempt)
          retryAttempt += 1
          await sleep(wait)
          continue
        }
      } else if (parentGone()) {
        const deferred = queueWaitMs()
        await sleep(deferred > 0 ? Math.min(deferred, 1000) : 50)
        continue
      }
      if (did) idle = 0
      else idle += 1
      if (pluginShouldExit()) break
      if (!parentGone() && stopRequested(dir)) break
      if (!did && pluginTurnedOff()) break
      const deferred = queueWaitMs()
      if (deferred > 0) {
        await sleep(Math.min(deferred, 500))
        continue
      }
      if (!parentGone() && idle > 40 && !holdFeed) break
      await sleep(parentGone() ? 50 : 500)
    }
  } finally {
    clearInterval(beat)
    if (!released) {
      released = true
      releaseWorkerLock(dir, token)
    }
  }
}

if (import.meta.main) loop()
