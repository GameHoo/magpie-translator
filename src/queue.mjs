import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { dataDir, ensureDir, writeAtomic } from "./paths.mjs"

export function inboxDir(env = process.env) {
  return path.join(dataDir(env), "inbox")
}

export function processingDir(env = process.env) {
  return path.join(dataDir(env), "processing")
}

export function enqueue(job, env = process.env) {
  const dir = inboxDir(env)
  ensureDir(dir)
  const id = String(job?.id || "")
  if (!id) throw new Error("任务没有 id")
  const file = path.join(dir, `${id}.json`)
  writeAtomic(file, `${JSON.stringify(job)}\n`)
  return file
}

export function listInbox(env = process.env) {
  try {
    return fs.readdirSync(inboxDir(env)).filter((name) => name.endsWith(".json")).sort()
  } catch {
    return []
  }
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

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// 崩溃留下的 processing 文件，主人进程已经不在时移回收件箱。还活着的主人继续做。
export function recoverProcessing(env = process.env) {
  const processing = processingDir(env)
  const inbox = inboxDir(env)
  let names = []
  try { names = fs.readdirSync(processing) } catch { return 0 }
  ensureDir(inbox)
  let n = 0
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const from = path.join(processing, name)
    if (name.startsWith("compare-")) {
      const current = readJson(from)
      const pid = Number(current?.pid)
      if (!pid || !alive(pid)) {
        try { fs.unlinkSync(from) } catch { /* 另一个工人刚收走 */ }
      }
      continue
    }
    const job = readJson(from)
    const owner = Number(job?.ownerPid)
    if (owner && alive(owner) && owner !== process.pid) continue
    const to = path.join(inbox, name)
    try {
      fs.renameSync(from, to)
      n += 1
    } catch { /* 另一个工人先拿走了 */ }
  }
  return n
}

// 用 rename 认领。两个工人抢同一个文件，只有一个 rename 成功。
export function takeJob(env = process.env) {
  const dir = inboxDir(env)
  const processing = processingDir(env)
  ensureDir(processing)
  for (const name of listInbox(env)) {
    if (!name.endsWith(".json") || name.startsWith("compare-")) continue
    const from = path.join(dir, name)
    const to = path.join(processing, name)
    try { fs.renameSync(from, to) } catch { continue }
    const job = readJson(to)
    if (!job) {
      try { fs.unlinkSync(to) } catch { /* 坏文件丢掉 */ }
      continue
    }
    job.ownerPid = process.pid
    try { writeAtomic(to, `${JSON.stringify(job)}\n`) } catch { /* 认领已经成立 */ }
    job.__claim = to
    return job
  }
  return null
}

export function finishClaim(claim) {
  if (!claim) return
  try { fs.unlinkSync(claim) } catch { /* 已经不在了 */ }
}

export function compareClaimName(nonce) {
  const hash = createHash("sha256").update(String(nonce)).digest("hex").slice(0, 24)
  return `compare-${hash}.json`
}

const inflightCompare = new Set()

export function holdCompare(nonce) {
  const key = String(nonce)
  inflightCompare.add(key)
  return () => inflightCompare.delete(key)
}

function createNew(file, body) {
  try {
    const fd = fs.openSync(file, "wx", 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(body)}\n`)
    fs.closeSync(fd)
    return true
  } catch (err) {
    if (err?.code === "EEXIST") return false
    throw err
  }
}

// 同一个 nonce 只有一个工人能拿到。死掉的主人留下的文件可以再抢。
export function claimCompare(env, body) {
  const dir = processingDir(env)
  ensureDir(dir)
  const file = path.join(dir, compareClaimName(body.nonce))
  const payload = { ...body, pid: process.pid, at: Date.now() }
  if (createNew(file, payload)) return file
  const current = readJson(file)
  const pid = Number(current?.pid)
  if (pid && pid !== process.pid && alive(pid)) return ""
  if (pid === process.pid && inflightCompare.has(String(body.nonce))) return ""
  try { fs.unlinkSync(file) } catch { /* 对方刚删 */ }
  if (createNew(file, payload)) return file
  return ""
}
