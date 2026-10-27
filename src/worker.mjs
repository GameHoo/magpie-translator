import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { presentation } from "./config.mjs"
import { readHistory, recordTranslation, replaceTranslation, addComparison, findHistory, hasSeen, markSeen, restoreFeed, writePublicFeed } from "./history.mjs"
import { findPlugin, packageRoot, pluginTurnedOff, readPluginList } from "./options.mjs"
import { dataDir, ensureDir, magpieBaseUrl } from "./paths.mjs"
import { takeJob } from "./queue.mjs"
import { persistItem } from "./sinks.mjs"
import { gatewayKeyFromEnv, translateJob } from "./translate.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))

function sourceHash() {
  const hash = createHash("sha256")
  for (const name of ["worker.mjs", "translate.mjs", "mask.mjs", "queue.mjs", "hooks.mjs"]) {
    hash.update(fs.readFileSync(path.join(HERE, name)))
  }
  return hash.digest("hex").slice(0, 16)
}

function alive(pid) {
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

// 脱离 hook 的进程。hook 的 AbortSignal 停不掉它，宿主重启也停不掉它。
// 只写数据目录，不写插件目录，也不写 plugins.json。
export function ensureWorker(env = process.env) {
  if (!shouldSpawn(env)) return false
  const dir = dataDir(env)
  ensureDir(dir)
  const hash = sourceHash()
  const note = path.join(dir, "worker.json")
  try {
    const current = JSON.parse(fs.readFileSync(note, "utf8"))
    if (current.hash === hash && alive(current.pid)) return false
    if (alive(current.pid)) {
      try { process.kill(current.pid, "SIGTERM") } catch { /* 已经退出 */ }
    }
  } catch { /* 还没有工人 */ }
  const child = spawn(process.execPath, [fileURLToPath(new URL("./worker.mjs", import.meta.url))], {
    detached: true,
    stdio: "ignore",
    cwd: dir,
    env: { ...env, MAGPIE_TRANSLATOR_HOME: dir },
  })
  child.unref()
  fs.writeFileSync(note, `${JSON.stringify({ pid: child.pid, hash })}\n`, { mode: 0o600 })
  return true
}

function finish(entry, env, limit) {
  delete entry.gatewayKey
  recordTranslation(entry, env, limit)
  writePublicFeed(env)
}

export async function runQueued(job, env = process.env, opts = {}) {
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    translation = await translateJob({ ...job, gatewayKey: gatewayKeyFromEnv(env) }, {
      fetchImpl: opts.fetchImpl,
    })
  } catch (err) {
    error = String(err?.message || err).slice(0, 500)
  }
  const entry = {
    ...job,
    ms: Date.now() - started,
    translation,
    error,
    status: error ? "error" : "done",
  }
  delete entry.gatewayKey
  finish(entry, env, job.historyLimit)
  await persistItem(env, entry, job.display, job.webhookUrl, {
    origin: job.origin,
    allowRemoteExport: job.allowRemoteExport,
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
  const row = findHistory(entryId, env)
  if (!row) {
    markSeen(nonce, env)
    return false
  }
  markSeen(nonce, env)
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
    gatewayKey: gatewayKeyFromEnv(env),
  }
  try {
    translation = await translateJob(job, { fetchImpl: opts.fetchImpl })
  } catch (err) {
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
  writePublicFeed(env)
  return true
}

export async function processOnce(env = process.env, opts = {}) {
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
  let idle = 0
  for (;;) {
    let did = false
    try { did = await processOnce() } catch { did = false }
    if (did) idle = 0
    else idle += 1
    if (pluginTurnedOff() && !did) break
    if (idle > 40) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

if (import.meta.main) loop()
