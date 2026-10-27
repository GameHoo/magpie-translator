import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gatewayKeyFor } from "./auth.mjs"
import { presentation } from "./config.mjs"
import { recordTranslation, replaceTranslation, addComparison, findHistory, hasSeen, markSeen, restoreFeed, writePublicFeed } from "./history.mjs"
import { findPlugin, pluginPresence, pluginTurnedOff, readPluginList, syncHostSurface } from "./options.mjs"
import { dataDir, ensureDir, magpieBaseUrl } from "./paths.mjs"
import { claimCompare, finishClaim, holdCompare, recoverProcessing, takeJob } from "./queue.mjs"
import { persistItem } from "./sinks.mjs"
import { translateJob } from "./translate.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKER_SCRIPT = fileURLToPath(new URL("./worker.mjs", import.meta.url))
const PASSTHROUGH = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP", "MAGPIE_BASE_URL"]

function sourceHash() {
  const hash = createHash("sha256")
  for (const name of ["worker.mjs", "translate.mjs", "mask.mjs", "queue.mjs", "hooks.mjs", "history.mjs", "options.mjs"]) {
    hash.update(fs.readFileSync(path.join(HERE, name)))
  }
  return hash.digest("hex").slice(0, 16)
}

export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function shouldSpawn(env = process.env) {
  return env.MAGPIE_TRANSLATOR_NO_SPAWN !== "1"
}

export function lockPath(env = process.env) {
  return path.join(dataDir(env), "worker.lock")
}

export function minimalEnv(env, dir = dataDir(env)) {
  const out = {}
  for (const key of PASSTHROUGH) {
    const value = env[key]
    if (typeof value === "string" && value) out[key] = value
  }
  out.MAGPIE_TRANSLATOR_HOME = dir
  out.MAGPIE_TRANSLATOR_PARENT_PID = String(process.pid)
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

async function acquireWorkerLock(dir, hash, parent) {
  const file = path.join(dir, "worker.lock")
  const body = `${JSON.stringify({ pid: process.pid, hash, parent: Number(parent) || 0 })}\n`
  for (let i = 0; i < 40; i += 1) {
    try {
      const fd = fs.openSync(file, "wx", 0o600)
      fs.writeFileSync(fd, body)
      fs.closeSync(fd)
      return true
    } catch (err) {
      if (err?.code !== "EEXIST") return false
      const current = readLock(file)
      const pid = Number(current?.pid)
      if (pid && pid !== process.pid && alive(pid)) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        continue
      }
      try { fs.unlinkSync(file) } catch { /* 对方刚退出 */ }
    }
  }
  return false
}

function releaseWorkerLock(dir) {
  const file = path.join(dir, "worker.lock")
  try {
    const current = readLock(file)
    if (Number(current?.pid) === process.pid) fs.unlinkSync(file)
  } catch { /* 锁已经没了 */ }
}

// 工人自己用独占锁保证只有一个。父进程退出或插件关掉之后，下一轮循环就停。
export function ensureWorker(env = process.env) {
  if (!shouldSpawn(env)) return false
  const dir = dataDir(env)
  ensureDir(dir)
  const hash = sourceHash()
  const file = path.join(dir, "worker.lock")
  const current = readLock(file)
  if (current && alive(Number(current.pid))) {
    const same = current.hash === hash && alive(Number(current.parent))
    if (same) return false
    try { process.kill(Number(current.pid), "SIGTERM") } catch { /* 正在退出 */ }
  } else if (current) {
    try { fs.unlinkSync(file) } catch { /* 对方刚清掉 */ }
  }
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    detached: true,
    stdio: "ignore",
    cwd: dir,
    env: minimalEnv(env, dir),
  })
  child.unref()
  return true
}

function scrub(job) {
  const clean = { ...job }
  delete clean.__claim
  delete clean.ownerPid
  delete clean.gatewayKey
  return clean
}

function watchStop(env, ac) {
  const timer = setInterval(() => {
    if (parentGone(env) || pluginShouldExit(env)) ac.abort()
  }, 200)
  if (typeof timer.unref === "function") timer.unref()
  return () => clearInterval(timer)
}

export async function runQueued(job, env = process.env, opts = {}) {
  const claim = job?.__claim
  const clean = scrub(job)
  const ac = new AbortController()
  const stopWatch = watchStop(env, ac)
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    if (parentGone(env) || pluginShouldExit(env)) throw stopError()
    translation = await translateJob({ ...clean, gatewayKey: gatewayKeyFor(env) }, {
      fetchImpl: opts.fetchImpl,
      signal: ac.signal,
    })
  } catch (err) {
    if (err?.name === "StopWorker" || (ac.signal.aborted && (parentGone(env) || pluginShouldExit(env)))) {
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
  writePublicFeed(env)
  finishClaim(claim)
  await persistItem(env, entry, clean.display, clean.webhookUrl, {
    origin: clean.origin,
    allowRemoteExport: clean.allowRemoteExport,
  })
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
      if (parentGone(env) || pluginShouldExit(env)) throw stopError()
      translation = await translateJob({ ...job, gatewayKey: gatewayKeyFor(env) }, {
        fetchImpl: opts.fetchImpl,
        signal: ac.signal,
      })
    } catch (err) {
      if (err?.name === "StopWorker" || (ac.signal.aborted && (parentGone(env) || pluginShouldExit(env)))) {
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

async function loop() {
  const dir = dataDir()
  const hash = sourceHash()
  if (!await acquireWorkerLock(dir, hash, process.env.MAGPIE_TRANSLATOR_PARENT_PID)) return
  let released = false
  const shutdown = () => {
    if (released) return
    released = true
    releaseWorkerLock(dir)
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGHUP", shutdown)
  let idle = 0
  try {
    for (;;) {
      if (parentGone() || pluginShouldExit()) break
      let did = false
      try {
        did = await processOnce()
      } catch (err) {
        if (err?.name === "StopWorker") break
        did = false
      }
      try { syncHostSurface() } catch { /* 下一轮再写摘要 */ }
      if (did) idle = 0
      else idle += 1
      if (parentGone() || pluginShouldExit()) break
      if (!did && pluginTurnedOff()) break
      if (idle > 40) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } finally {
    if (!released) {
      released = true
      releaseWorkerLock(dir)
    }
  }
}

if (import.meta.main) loop()
