import fs from "node:fs"
import path from "node:path"
import { DEFAULT_HISTORY_LIMIT } from "./constants.mjs"
import { parseHistoryLimit } from "./config.mjs"
import { dataDir, ensureDir } from "./paths.mjs"
import { writeFeed } from "./publish.mjs"

const PUBLIC = ["id", "at", "agent", "model", "translator", "language", "ms", "original", "translation", "error", "status"]

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
    comparisons: [],
  }
  if (!row.id) return null
  const cap = parseHistoryLimit(limit)
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

export function findHistory(id, env = process.env) {
  return readHistory(env).find((item) => item.id === id) || null
}

export function publicEntry(entry) {
  const view = {}
  for (const key of PUBLIC) view[key] = entry[key] ?? (key === "ms" ? 0 : "")
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
