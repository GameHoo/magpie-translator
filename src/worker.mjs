import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gatewayKeyFor } from "./auth.mjs"
import { presentation } from "./config.mjs"
import { recordTranslation, replaceTranslation, addComparison, findHistory, hasSeen, markDelivered, markSeen, restoreFeed, wasDelivered, writePublicFeed } from "./history.mjs"
import { findPlugin, pluginPresence, pluginTurnedOff, readPluginList, syncHostSurface } from "./options.mjs"
import { dataDir, ensureDir, magpieBaseUrl, writeAtomic } from "./paths.mjs"
import { pidExists, processStartTime, sameProcess, signalWorker } from "./proc.mjs"
import { claimCompare, finishClaim, holdCompare, queueDepth, recoverProcessing, takeJob } from "./queue.mjs"
import { persistItem } from "./sinks.mjs"
import { translateJob } from "./translate.mjs"

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
  return pidExists(pid)
}

export { signalWorker, sameProcess }

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

// 过期锁用 rename 拿走，再 link 自己的文件。rename 和 link 都是原子的。
export async function acquireWorkerLock(dir, hash, parent, token = process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN) {
  ensureDir(dir)
  const id = String(token || randomBytes(16).toString("hex"))
  process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN = id
  const file = path.join(dir, "worker.lock")
  const mine = {
    pid: process.pid,
    startTime: processStartTime(process.pid),
    token: id,
    hash,
    parent: Number(parent) || 0,
  }
  const privateFile = path.join(dir, `worker.lock.${id}`)
  writeAtomic(privateFile, `${JSON.stringify(mine)}\n`)
  for (let i = 0; i < 50; i += 1) {
    try {
      fs.linkSync(privateFile, file)
      try { fs.unlinkSync(privateFile) } catch { /* 锁已经链上 */ }
      return true
    } catch (err) {
      if (err?.code !== "EEXIST") {
        try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
        return false
      }
    }
    const current = readLock(file)
    if (current && Number(current.pid) === process.pid && String(current.token) === id && sameProcess(current)) {
      try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
      return true
    }
    if (sameProcess(current)) {
      if (current.hash !== hash) signalWorker(current, "SIGTERM")
      else {
        try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
        return false
      }
      await sleep(50)
      continue
    }
    const staleToken = String(current?.token || "missing")
    const again = readLock(file)
    if (String(again?.token || "missing") !== staleToken || sameProcess(again)) continue
    const grave = path.join(dir, `worker.lock.dead.${staleToken}`)
    try { fs.renameSync(file, grave) } catch { continue }
    const moved = readLock(grave)
    if (String(moved?.token || "missing") !== staleToken || sameProcess(moved)) {
      try { fs.linkSync(grave, file) } catch { /* 名字已经被占 */ }
      try { fs.unlinkSync(grave) } catch { /* 已经还回去了 */ }
      continue
    }
    try { fs.unlinkSync(grave) } catch { /* 过期锁可以留着 */ }
  }
  try { fs.unlinkSync(privateFile) } catch { /* 没有临时文件 */ }
  return false
}

function releaseWorkerLock(dir, token) {
  const file = path.join(dir, "worker.lock")
  const current = readLock(file)
  if (!current) return
  if (String(current.token) !== String(token)) return
  if (Number(current.pid) !== process.pid) return
  if (String(current.startTime) !== processStartTime(process.pid)) return
  const grave = path.join(dir, `worker.lock.dead.${token}`)
  try { fs.renameSync(file, grave) } catch { return }
  const moved = readLock(grave)
  if (String(moved?.token) !== String(token)) {
    try { fs.linkSync(grave, file) } catch { /* 新主人已经放上锁 */ }
  }
  try { fs.unlinkSync(grave) } catch { /* 已经不在 */ }
}

// 活着的工人，pid、启动时刻和 token 都对得上，就不发信号。父进程没了也让它把队列做完。
export function ensureWorker(env = process.env) {
  if (!shouldSpawn(env)) return false
  const dir = dataDir(env)
  ensureDir(dir)
  const hash = sourceHash()
  const file = path.join(dir, "worker.lock")
  const current = readLock(file)
  if (sameProcess(current)) {
    if (current.hash === hash) return false
    signalWorker(current, "SIGTERM")
  }
  const token = randomBytes(16).toString("hex")
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    detached: true,
    stdio: "ignore",
    cwd: dir,
    env: minimalEnv(env, dir, token),
  })
  child.unref()
  return true
}

function scrub(job) {
  const clean = { ...job }
  delete clean.__claim
  delete clean.ownerPid
  delete clean.ownerStart
  delete clean.gatewayKey
  return clean
}

function watchStop(env, ac) {
  const timer = setInterval(() => {
    if (pluginShouldExit(env)) ac.abort()
  }, 200)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
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
  const clean = scrub(job)
  if (clean.id && (findHistory(clean.id, env) || wasDelivered(clean.id, env))) {
    finishClaim(claim)
    return findHistory(clean.id, env)
  }
  const ac = new AbortController()
  const stopWatch = watchStop(env, ac)
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    if (pluginShouldExit(env)) throw stopError()
    translation = await translateJob({ ...clean, gatewayKey: gatewayKeyFor(env) }, {
      fetchImpl: opts.fetchImpl,
      signal: ac.signal,
    })
  } catch (err) {
    if (err?.name === "StopWorker" || (ac.signal.aborted && pluginShouldExit(env))) {
      throw stopError()
    }
    error = String(err?.message || err).slice(0, 500)
  } finally {
    stopWatch()
  }
  const entry = {
    ...clean,
    ms: Date.now() - started,
    translation,
    error,
    status: error ? "error" : "done",
  }
  recordTranslation(entry, env, clean.historyLimit)
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
  finishClaim(claim)
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
  const stopWatch = watchStop(env, ac)
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
      if (pluginShouldExit(env)) throw stopError()
      translation = await translateJob({ ...job, gatewayKey: gatewayKeyFor(env) }, {
        fetchImpl: opts.fetchImpl,
        signal: ac.signal,
      })
    } catch (err) {
      if (err?.name === "StopWorker" || (ac.signal.aborted && pluginShouldExit(env))) {
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
    releaseHold()
    if (finished) finishClaim(claim)
  }
}

export async function processOnce(env = process.env, opts = {}) {
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

function publishWait(reason) {
  return reason === "debounce" || reason === "rate" || reason === "conflict" || reason === "error" || reason === "read"
}

async function loop() {
  const dir = dataDir()
  const hash = sourceHash()
  if (!await acquireWorkerLock(dir, hash, process.env.MAGPIE_TRANSLATOR_PARENT_PID)) return
  const token = process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  let released = false
  const shutdown = () => {
    if (released) return
    released = true
    releaseWorkerLock(dir, token)
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGHUP", shutdown)
  let idle = 0
  try {
    for (;;) {
      if (pluginShouldExit()) break
      let did = false
      try {
        did = await processOnce()
      } catch (err) {
        if (err?.name === "StopWorker") break
        did = false
      }
      if (queueDepth() === 0) {
        let published = { wrote: false, reason: "empty" }
        try { published = syncHostSurface() } catch { published = { wrote: false, reason: "error" } }
        if (parentGone() && !publishWait(published.reason)) break
      } else if (parentGone()) {
        await sleep(50)
        continue
      }
      if (did) idle = 0
      else idle += 1
      if (pluginShouldExit()) break
      if (!did && pluginTurnedOff()) break
      if (!parentGone() && idle > 40) break
      await sleep(parentGone() ? 50 : 500)
    }
  } finally {
    if (!released) {
      released = true
      releaseWorkerLock(dir, token)
    }
  }
}

if (import.meta.main) loop()
