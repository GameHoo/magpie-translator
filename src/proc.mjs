import fs from "node:fs"

// 进程启动时刻。用来确认 pid 还是当初那个进程，避免 pid 被系统复用后发信号。
export function processStartTime(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return ""
  try {
    const stat = fs.readFileSync(`/proc/${id}/stat`, "utf8")
    const end = stat.lastIndexOf(")")
    if (end < 0) return ""
    const fields = stat.slice(end + 2).trim().split(/\s+/)
    return fields[19] || ""
  } catch {
    return ""
  }
}

export function pidExists(pid) {
  return processStartTime(pid) !== ""
}

export function processToken(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return ""
  if (id === process.pid) {
    const own = process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN
    if (typeof own === "string" && own) return own
  }
  try {
    const raw = fs.readFileSync(`/proc/${id}/environ`)
    const line = raw.toString("utf8").split("\0").find((item) => item.startsWith("MAGPIE_TRANSLATOR_LOCK_TOKEN="))
    return line ? line.slice("MAGPIE_TRANSLATOR_LOCK_TOKEN=".length) : ""
  } catch {
    return ""
  }
}

// 锁里的 pid、启动时刻、随机 token 三者都对上，才是当初那个工人。
export function sameProcess(record) {
  const pid = Number(record?.pid)
  if (!pid) return false
  const start = processStartTime(pid)
  if (!start || start !== String(record.startTime || "")) return false
  if (!record.token || processToken(pid) !== String(record.token)) return false
  return true
}

export function signalWorker(record, signal = "SIGTERM") {
  if (!sameProcess(record)) return false
  try {
    process.kill(Number(record.pid), signal)
    return true
  } catch {
    return false
  }
}
