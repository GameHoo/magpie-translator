// 跨平台的进程判断。只允许 process.kill(pid, 0) 探活，不读进程表，也不发真正的信号。

export const HEARTBEAT_MS = 2000
export const STALE_MS = 8000
export const CONFLICT_LIMIT_MS = 10000

export function workerToken(env = process.env) {
  const token = env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  if (typeof token === "string" && token) return token
  return `local-${process.pid}`
}

export function pidAlive(pid) {
  const id = Number(pid)
  if (!Number.isInteger(id) || id <= 0) return false
  try {
    process.kill(id, 0)
    return true
  } catch (err) {
    return err?.code !== "ESRCH"
  }
}

export function beatIsStale(heartbeat, now = Date.now(), staleMs = STALE_MS) {
  const beat = Number(heartbeat)
  if (!Number.isFinite(beat) || beat <= 0) return true
  return now - beat > staleMs
}

export function lockIsStale(record, now = Date.now()) {
  if (!record || !record.token) return true
  return beatIsStale(record.heartbeat, now)
}

// 父进程已经退出，并且 plugins.json 的冲突重试超过时限，才离开。
export function shouldExitAfterPublish({ parentDead, reason, conflictSince = 0, now = Date.now() } = {}) {
  if (!parentDead) return false
  if (reason === "conflict") return conflictSince > 0 && now - conflictSince >= CONFLICT_LIMIT_MS
  if (reason === "debounce" || reason === "rate" || reason === "error" || reason === "read") return false
  return true
}
