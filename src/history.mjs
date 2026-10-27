import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DEFAULT_HISTORY_LIMIT } from "./constants.mjs"
import { parseHistoryLimit } from "./config.mjs"
import { dataDir, ensureDir, logPath } from "./paths.mjs"
import { writeFeed } from "./publish.mjs"

const PUBLIC = ["id", "at", "agent", "model", "translator", "language", "style", "ms", "original", "translation", "error", "status"]

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

export function recordTranslation(entry, env = process.env, limit = DEFAULT_HISTORY_LIMIT) {
  const cap = parseHistoryLimit(limit)
  if (cap === 0) {
    writeHistory([], env)
    publish([], env)
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
    magpieBaseUrl: entry.magpieBaseUrl || "",
    truncated: !!entry.truncated,
    comparisons: [],
  }
  if (!row.id) return null
  const next = [row, ...readHistory(env).filter((item) => item.id !== row.id)].slice(0, cap)
  writeHistory(next, env)
  publish(next, env)
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
  publish(rows, env)
  return publicEntry(row)
}

export function replaceTranslation(entryId, patch, env = process.env) {
  const rows = readHistory(env)
  const row = rows.find((item) => item.id === entryId)
  if (!row) return null
  row.translation = patch.translation || ""
  row.error = patch.error || ""
  row.ms = Number(patch.ms) || 0
  row.status = row.error ? "error" : "done"
  writeHistory(rows, env)
  publish(rows, env)
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

export function publish(rows = readHistory(), env = process.env) {
  return writeFeed({
    at: new Date().toISOString(),
    entries: rows.map(publicEntry),
  }, env)
}

// 更新会换一个插件目录，feed.js 跟着新目录变成空文件。log.jsonl 还在数据目录里。
// 把日志里还没进 history.json 的行补回去，再写成 feed。historyLimit 为 0 时不补。
export function restoreFeed(env = process.env, limit) {
  const cap = parseHistoryLimit(limit)
  const current = readHistory(env)
  if (cap === 0) {
    publish(current, env)
    return current
  }
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
  publish(rows, env)
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
    if (!parsed || typeof parsed !== "object") continue
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
  const file = historyPath(env)
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(rows)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
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
  const file = seenPath(env)
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(seen.slice(-200))}\n`, { mode: 0o600 })
}

function readSeen(env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(seenPath(env), "utf8"))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
