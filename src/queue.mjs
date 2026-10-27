import fs from "node:fs"
import path from "node:path"
import { dataDir, ensureDir } from "./paths.mjs"

export function inboxDir(env = process.env) {
  return path.join(dataDir(env), "inbox")
}

export function enqueue(job, env = process.env) {
  const dir = inboxDir(env)
  ensureDir(dir)
  const id = String(job?.id || "")
  if (!id) throw new Error("任务没有 id")
  const file = path.join(dir, `${id}.json`)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(job)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
  return file
}

export function listInbox(env = process.env) {
  try {
    return fs.readdirSync(inboxDir(env)).filter((name) => name.endsWith(".json")).sort()
  } catch {
    return []
  }
}

export function takeJob(env = process.env) {
  const dir = inboxDir(env)
  for (const name of listInbox(env)) {
    const file = path.join(dir, name)
    let raw
    try { raw = fs.readFileSync(file, "utf8") } catch { continue }
    try { fs.unlinkSync(file) } catch { continue }
    try {
      const job = JSON.parse(raw)
      if (job && typeof job === "object") return job
    } catch { /* 坏文件丢掉 */ }
  }
  return null
}
