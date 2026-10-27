// 跨平台的进程判断。只允许 process.kill(pid, 0) 探活，不读进程表，也不发真正的信号。

export const HEARTBEAT_MS = 2000
export const STALE_MS = 8000
export const PUBLISH_RETRY_LIMIT_MS = 20000
export const PUBLISH_WAIT_REASONS = ["conflict", "debounce", "rate", "error", "read"]

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

export function publishBackoff(attempt, base = 50, cap = 1000) {
  const n = Number(attempt)
  const exp = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5) : 0
  return Math.min(cap, base * 2 ** exp)
}

// 父进程已经退出。还在等的发布（防抖、频率、冲突、读、写）超过时限才离开。
export function shouldExitAfterPublish({ parentDead, reason, conflictSince = 0, retrySince = 0, now = Date.now() } = {}) {
  if (!parentDead) return false
  if (PUBLISH_WAIT_REASONS.includes(reason)) {
    const since = Number(retrySince) || Number(conflictSince) || 0
    return since > 0 && now - since >= PUBLISH_RETRY_LIMIT_MS
  }
  return true
}
