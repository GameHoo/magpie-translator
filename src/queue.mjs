import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { recordDropped } from "./history.mjs"
import { dataDir, ensureDir, writeAtomic } from "./paths.mjs"
import { beatIsStale, workerToken } from "./proc.mjs"

export const INBOX_CAP = 100

export function inboxDir(env = process.env) {
  return path.join(dataDir(env), "inbox")
}

export function processingDir(env = process.env) {
  return path.join(dataDir(env), "processing")
}

function capInbox(env, keepName) {
  const dir = inboxDir(env)
  const names = listInbox(env).filter((name) => name !== keepName)
  if (names.length < INBOX_CAP) return
  const ranked = names.map((name) => {
    const file = path.join(dir, name)
    let mtime = 0
    try { mtime = fs.statSync(file).mtimeMs } catch { /* 读不到就当最旧 */ }
    return { name, mtime }
  }).sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name))
  const extra = names.length - (INBOX_CAP - 1)
  const dropped = []
  for (let i = 0; i < extra; i += 1) {
    const file = path.join(dir, ranked[i].name)
    let job = null
    try { job = JSON.parse(fs.readFileSync(file, "utf8")) } catch { /* 坏文件也丢掉 */ }
    try { fs.unlinkSync(file) } catch { continue }
    dropped.push({
      id: String(job?.id || ranked[i].name.replace(/\.json$/, "")),
      at: new Date().toISOString(),
      original: String(job?.original || "").slice(0, 160),
    })
  }
  if (dropped.length) recordDropped(env, dropped)
}

export function enqueue(job, env = process.env) {
  const dir = inboxDir(env)
  ensureDir(dir)
  const id = String(job?.id || "")
  if (!id) throw new Error("任务没有 id")
  const name = `${id}.json`
  capInbox(env, name)
  const file = path.join(dir, name)
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

function claimIsFresh(record, now = Date.now()) {
  return !beatIsStale(record?.heartbeat, now)
}

export function queueDepth(env = process.env) {
  let processing = 0
  try {
    processing = fs.readdirSync(processingDir(env)).filter((name) => name.endsWith(".json") && !name.startsWith("compare-")).length
  } catch { /* 还没有这个目录 */ }
  return listInbox(env).length + processing
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// 认领上带了 token 和 heartbeat。心跳还新的时候不挪走，两个工人短暂重叠也不会抢同一条。
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
      if (claimIsFresh(current)) continue
      try { fs.unlinkSync(from) } catch { /* 另一个工人刚收走 */ }
      continue
    }
    const job = readJson(from)
    if (claimIsFresh(job)) continue
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
    job.ownerToken = workerToken(env)
    job.heartbeat = Date.now()
    try { writeAtomic(to, `${JSON.stringify(job)}\n`) } catch { /* 认领已经成立 */ }
    job.__claim = to
    return job
  }
  return null
}

export function touchClaim(claim, env = process.env) {
  if (!claim) return false
  const token = workerToken(env)
  const job = readJson(claim)
  if (!job || String(job.ownerToken) !== token) return false
  const latest = readJson(claim)
  if (!latest || String(latest.ownerToken) !== token) return false
  latest.heartbeat = Date.now()
  try { writeAtomic(claim, `${JSON.stringify(latest)}\n`) } catch { return false }
  const again = readJson(claim)
  return !!again && String(again.ownerToken) === token
}

export function finishClaim(claim, env = process.env) {
  if (!claim) return false
  const token = workerToken(env)
  const job = readJson(claim)
  if (!job || String(job.ownerToken) !== token) return false
  const grave = `${claim}.done.${token}.${process.pid}.${Date.now()}`
  try { fs.renameSync(claim, grave) } catch { return false }
  const moved = readJson(grave)
  if (!moved || String(moved.ownerToken) !== token) {
    try { fs.linkSync(grave, claim) } catch { return false }
    try { fs.unlinkSync(grave) } catch { /* 已经链回去了 */ }
    return false
  }
  try { fs.unlinkSync(grave) } catch { /* 认领已经挪走 */ }
  return true
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
  const payload = { ...body, ownerToken: workerToken(env), heartbeat: Date.now(), at: Date.now() }
  if (createNew(file, payload)) return file
  const current = readJson(file)
  if (claimIsFresh(current)) return ""
  if (inflightCompare.has(String(body.nonce)) && String(current?.ownerToken || "") === workerToken(env)) return ""
  try { fs.unlinkSync(file) } catch { /* 对方刚删 */ }
  if (createNew(file, payload)) return file
  return ""
}
