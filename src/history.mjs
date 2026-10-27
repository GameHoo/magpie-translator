import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DEFAULT_HISTORY_LIMIT } from "./constants.mjs"
import { parseHistoryLimit } from "./config.mjs"
import { dataDir, ensureDir, logPath, writeAtomic } from "./paths.mjs"

const PUBLIC = ["id", "at", "agent", "model", "translator", "language", "style", "ms", "original", "translation", "error", "status"]

// magpie 的页面一次最多提交 64KiB 的 options。公开记录要连同设置一起放得下。
export const FEED_BUDGET = 48_000

export function historyPath(env = process.env) {
  return path.join(dataDir(env), "history.json")
}

export function readHistory(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath(env), "utf8"))
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : []
  } catch {
    return []
  }
}

function isSuccess(row) {
  if (!row || row.error) return false
  return row.status === "done" || row.status === "ok"
}

export function recordTranslation(entry, env = process.env, limit = DEFAULT_HISTORY_LIMIT) {
  const cap = parseHistoryLimit(limit)
  if (cap === 0) {
    writeHistory([], env)
    return null
  }
  const row = {
    id: String(entry.id || ""),
    at: entry.at || new Date().toISOString(),
    agent: entry.agent || "",
    model: entry.model || "",
    translator: entry.translator || "",
    language: entry.language || "",
    ms: Number(entry.ms) || 0,
    original: entry.original || "",
    translation: entry.translation || "",
    error: entry.error || "",
    status: entry.status || "",
    prompt: entry.prompt || "",
    style: entry.style || "",
    masked: entry.masked || "",
    slots: Array.isArray(entry.slots) ? entry.slots : [],
    maskCode: !!entry.maskCode,
    truncated: !!entry.truncated,
    comparisons: [],
  }
  if (!row.id) return null
  const previous = readHistory(env).find((item) => item.id === row.id)
  if (previous && isSuccess(previous) && !isSuccess(row)) return publicEntry(previous)
  const next = [row, ...readHistory(env).filter((item) => item.id !== row.id)].slice(0, cap)
  writeHistory(next, env)
  return publicEntry(row)
}

export function addComparison(entryId, comparison, env = process.env) {
  const rows = readHistory(env)
  const row = rows.find((item) => item.id === entryId)
  if (!row) return null
  if (!Array.isArray(row.comparisons)) row.comparisons = []
  row.comparisons.push({
    id: String(comparison.id || `${entryId}-${row.comparisons.length + 1}`),
    translator: comparison.translator || "",
    translation: comparison.translation || "",
    error: comparison.error || "",
    ms: Number(comparison.ms) || 0,
    at: comparison.at || new Date().toISOString(),
  })
  writeHistory(rows, env)
  return publicEntry(row)
}

export function replaceTranslation(entryId, patch, env = process.env) {
  const rows = readHistory(env)
  const row = rows.find((item) => item.id === entryId)
  if (!row) return null
  if (isSuccess(row) && patch.error) return publicEntry(row)
  row.translation = patch.translation || ""
  row.error = patch.error || ""
  row.ms = Number(patch.ms) || 0
  row.status = row.error ? "error" : "done"
  writeHistory(rows, env)
  return publicEntry(row)
}

export function findHistory(id, env = process.env) {
  return readHistory(env).find((item) => item.id === id) || null
}

export function publicEntry(entry) {
  const view = {}
  for (const key of PUBLIC) view[key] = entry[key] ?? (key === "ms" ? 0 : "")
  view.truncated = !!entry.truncated
  view.comparisons = (Array.isArray(entry.comparisons) ? entry.comparisons : []).map((item) => ({
    id: item.id || "",
    translator: item.translator || "",
    translation: item.translation || "",
    error: item.error || "",
    ms: Number(item.ms) || 0,
    at: item.at || "",
  }))
  return view
}

// 页面通过 magpie.options.get() 读到的那一份。最新的在前，超长的丢掉尾巴，
// 整份超过预算就少放几条。磁盘上的 history.json 仍是全文。
export function droppedPath(env = process.env) {
  return path.join(dataDir(env), "dropped.json")
}

export function readDropped(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(droppedPath(env), "utf8"))
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : []
  } catch {
    return []
  }
}

export function recordDropped(env, items) {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.id)
  if (!list.length) return []
  const next = [...list, ...readDropped(env)].slice(0, 20)
  writeAtomic(droppedPath(env), `${JSON.stringify(next)}\n`)
  try {
    ensureDir(dataDir(env))
    for (const item of list) {
      fs.appendFileSync(logPath(env), `${JSON.stringify({ at: item.at, dropped: true, id: item.id })}\n`, { mode: 0o600 })
    }
  } catch { /* 页面上的摘要仍会列出丢掉的任务 */ }
  const ids = list.map((item) => item.id).join(", ")
  console.error(`magpie-translator: dropped ${list.length} queued job(s) because the inbox is over 100: ${ids}`)
  return next
}

export function publicFeed(rows = [], dropped = []) {
  const feed = { entries: fitEntries(rows.map(publicEntry)) }
  const list = (Array.isArray(dropped) ? dropped : []).slice(0, 20).map((item) => ({
    id: String(item.id || ""),
    at: item.at || "",
    original: String(item.original || "").slice(0, 160),
  })).filter((item) => item.id)
  if (list.length) feed.dropped = list
  return feed
}

export function writePublicFeed(env = process.env) {
  const file = path.join(dataDir(env), "feed.json")
  const next = JSON.stringify(publicFeed(readHistory(env), readDropped(env)))
  try {
    if (fs.readFileSync(file, "utf8") === next) return false
  } catch { /* 还没有这份文件 */ }
  writeAtomic(file, next)
  return true
}

function fitEntries(entries) {
  const out = []
  for (const entry of entries) {
    if (JSON.stringify([...out, entry]).length <= FEED_BUDGET) {
      out.push(entry)
      continue
    }
    const room = FEED_BUDGET - JSON.stringify(out).length - 80
    if (room < 240) break
    const clipped = clipEntry(entry, room)
    if (JSON.stringify([...out, clipped]).length > FEED_BUDGET) break
    out.push(clipped)
  }
  return out
}

function clipEntry(entry, room) {
  const copy = {
    ...entry,
    comparisons: (entry.comparisons || []).map((item) => ({ ...item })),
  }
  const shrink = (text, max) => {
    const value = String(text || "")
    return value.length <= max ? value : `${value.slice(0, max)}…`
  }
  for (let guard = 1; JSON.stringify(copy).length > room && guard < 16; guard += 1) {
    const max = Math.max(80, Math.floor(6000 / guard))
    copy.original = shrink(copy.original, max)
    copy.translation = shrink(copy.translation, max)
    copy.viewClipped = true
    for (const item of copy.comparisons) item.translation = shrink(item.translation, max)
  }
  return copy
}

// 把日志里还没进 history.json 的行补回去。historyLimit 为 0 时不补，也不新建文件。
export function restoreFeed(env = process.env, limit) {
  const cap = parseHistoryLimit(limit)
  const current = readHistory(env)
  if (cap === 0) return current
  const seen = new Set(current.map(signature))
  const added = []
  for (const row of readLogRows(env)) {
    const sig = signature(row)
    if (seen.has(sig)) continue
    seen.add(sig)
    added.push(row)
  }
  let rows = current
  if (added.length) {
    rows = [...current, ...added].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    if (rows.length > cap) rows = rows.slice(0, cap)
    writeHistory(rows, env)
  }
  return rows
}

function signature(row) {
  return `${row.at || ""}\0${row.translator || ""}\0${row.original || ""}`
}

function logId(at, translator, original) {
  return `log-${createHash("sha256").update(`${at}\0${translator || ""}\0${original}`).digest("hex").slice(0, 16)}`
}

function readLogRows(env) {
  let text = ""
  try { text = fs.readFileSync(logPath(env), "utf8") } catch { return [] }
  const lines = text.split(/\n/).filter(Boolean).slice(-5000)
  const rows = []
  for (const line of lines) {
    let parsed
    try { parsed = JSON.parse(line) } catch { continue }
    if (!parsed || typeof parsed !== "object" || parsed.dropped === true) continue
    const at = typeof parsed.at === "string" ? parsed.at : ""
    const original = typeof parsed.original === "string" ? parsed.original : ""
    const translation = typeof parsed.translation === "string" ? parsed.translation : ""
    if (!original && !translation) continue
    const error = typeof parsed.error === "string" ? parsed.error : ""
    const ok = parsed.ok !== false && !error
    rows.push({
      id: logId(at, parsed.translator, original),
      at,
      agent: typeof parsed.agent === "string" ? parsed.agent : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      translator: typeof parsed.translator === "string" ? parsed.translator : "",
      language: typeof parsed.language === "string" ? parsed.language : "",
      ms: 0,
      original,
      translation: ok ? translation : "",
      error,
      status: ok ? "done" : "error",
      prompt: "",
      style: "",
      masked: original,
      slots: [],
      magpieBaseUrl: "",
      truncated: false,
      comparisons: [],
    })
  }
  return rows
}

function writeHistory(rows, env) {
  writeAtomic(historyPath(env), `${JSON.stringify(rows)}\n`)
}

export function seenPath(env = process.env) {
  return path.join(dataDir(env), "compare-seen.json")
}

export function hasSeen(nonce, env = process.env) {
  return readSeen(env).includes(nonce)
}

export function markSeen(nonce, env = process.env) {
  const seen = readSeen(env)
  if (!nonce || seen.includes(nonce)) return
  seen.push(nonce)
  writeAtomic(seenPath(env), `${JSON.stringify(seen.slice(-200))}\n`)
}

function deliveryDir(env) {
  return path.join(dataDir(env), "delivered")
}

function deliveryName(id) {
  return createHash("sha256").update(String(id)).digest("hex")
}

export function wasDelivered(id, env = process.env) {
  if (!id) return false
  return fs.existsSync(path.join(deliveryDir(env), deliveryName(id)))
}

// 同一个任务 id 只记下一次。历史和 webhook 都先看这个标记。
export function markDelivered(id, env = process.env) {
  if (!id) return false
  ensureDir(deliveryDir(env))
  const file = path.join(deliveryDir(env), deliveryName(id))
  try {
    const fd = fs.openSync(file, "wx", 0o600)
    fs.writeFileSync(fd, `${id}\n`)
    fs.closeSync(fd)
    return true
  } catch (err) {
    if (err?.code === "EEXIST") return false
    throw err
  }
}

function readSeen(env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(seenPath(env), "utf8"))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
