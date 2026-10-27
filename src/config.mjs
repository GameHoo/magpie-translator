// 工作模型、翻译模型、语言、提示词和展示都来自 magpie 插件配置。
// 这里不设厂商名单：translator 和 model 是 magpie models 印出来的任意 id。

import { DEFAULT_HISTORY_LIMIT, DEFAULT_TRANSLATE_TIMEOUT_MS } from "./constants.mjs"

export const DEFAULT_LANGUAGE = "简体中文"
export const DEFAULT_DISPLAY = ["log"]

const DISPLAYS = new Set(["panel", "log", "file", "stdout", "notify", "webhook"])
const MAX_NOTE = 4000

export function parseDisplay(value) {
  const source = value == null || value === "" ? DEFAULT_DISPLAY : Array.isArray(value) ? value : String(value).split(/[\s,]+/)
  const out = []
  for (const item of source) {
    const name = String(item || "").trim().toLowerCase()
    if (!DISPLAYS.has(name) || out.includes(name)) continue
    out.push(name)
  }
  return out.length ? out : [...DEFAULT_DISPLAY]
}

export function parseTimeout(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_TRANSLATE_TIMEOUT_MS
  return Math.min(600_000, Math.max(10_000, Math.round(n)))
}

export function parseHistoryLimit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_LIMIT
  return Math.min(2000, Math.max(20, Math.round(n)))
}

export function parseFlag(value, fallback = false) {
  if (typeof value === "boolean") return value
  if (value === "true" || value === "1" || value === "on") return true
  if (value === "false" || value === "0" || value === "off") return false
  return fallback
}

export function presentation(options = {}, rule = {}) {
  const rewrite = rule.rewriteSameLanguage != null && rule.rewriteSameLanguage !== ""
    ? parseFlag(rule.rewriteSameLanguage, false)
    : parseFlag(options.rewriteSameLanguage, false)
  return {
    language: text(rule.language, options.language) || DEFAULT_LANGUAGE,
    prompt: clip(text(rule.prompt, options.prompt)),
    style: clip(text(rule.style, options.style)),
    display: parseDisplay(rule.display ?? options.display),
    webhookUrl: httpUrl(text(rule.webhookUrl, options.webhookUrl)),
    translateTimeoutMs: parseTimeout(options.translateTimeoutMs),
    rewriteSameLanguage: rewrite,
    localPanel: parseFlag(options.localPanel, false),
    historyLimit: parseHistoryLimit(options.historyLimit),
  }
}

function text(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function clip(value) {
  return value.length > MAX_NOTE ? value.slice(0, MAX_NOTE) : value
}

function httpUrl(value) {
  if (!value) return ""
  try {
    const url = new URL(value)
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString()
  } catch { /* 非法地址就不当出口 */ }
  return ""
}
