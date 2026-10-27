import { readFileSync } from "node:fs"
import { parseTimeout } from "./config.mjs"
import { DEFAULT_MAGPIE_BASE } from "./constants.mjs"
import { keepCode, restore } from "./mask.mjs"
import { systemPrompt } from "./prompt.mjs"

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version
export const USER_AGENT = `magpie-translator/${VERSION}`

export function timeoutFor(job, opts = {}) {
  const asked = parseTimeout(job?.translateTimeoutMs ?? job?.timeoutMs)
  const cap = Number(opts.maxMs)
  return cap > 0 ? Math.min(asked, cap) : asked
}

export function gatewayKeyFromEnv(env = process.env) {
  const key = env.MAGPIE_TRANSLATOR_GATEWAY_KEY
  return typeof key === "string" && key.trim() ? key.trim() : ""
}

// 只请求一次。超时和 5xx 不再由插件重试：重试会把一次本来已经很长的转述再拉长一倍。
export async function translateJob(job, opts = {}) {
  const timeoutMs = timeoutFor(job, opts)
  const raw = await translateOnce(job, opts, timeoutMs)
  const restored = Array.isArray(job.slots) && job.slots.length ? restore(raw, job.slots) : raw
  return keepCode(job.original || job.masked || "", restored)
}

async function translateOnce(job, { fetchImpl = globalThis.fetch, onDelta, signal } = {}, timeoutMs) {
  const base = String(job.magpieBaseUrl || DEFAULT_MAGPIE_BASE).replace(/\/$/, "")
  const key = typeof job.gatewayKey === "string" ? job.gatewayKey.trim() : ""
  const headers = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
  }
  if (key) headers.authorization = `Bearer ${key}`
  const res = await fetchImpl(`${base}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: job.translator,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt(job) },
        { role: "user", content: job.masked ?? job.original ?? "" },
      ],
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    const brief = detail.replace(/\s+/g, " ").slice(0, 180)
    const error = new Error(`翻译模型返回 HTTP ${res.status}${brief ? `：${brief}` : ""}`)
    error.status = res.status
    throw error
  }
  const raw = await readModelText(res, onDelta)
  if (!String(raw).trim()) throw new Error("翻译模型没有返回文字")
  return raw
}

async function readModelText(res, onDelta) {
  const ctype = (res.headers.get("content-type") || "").toLowerCase()
  if (ctype.includes("application/json")) return textFromCompletion(await res.json())
  return readSSE(res, onDelta)
}

function textFromCompletion(body) {
  const choice = body?.choices?.[0]
  const content = choice?.message?.content ?? choice?.delta?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
  return ""
}

async function readSSE(res, onDelta) {
  const reader = res.body?.getReader?.()
  if (!reader) {
    const text = await res.text()
    if (text.trimStart().startsWith("{")) return textFromCompletion(JSON.parse(text))
    return collectSSE(text, onDelta)
  }
  const decoder = new TextDecoder()
  let buf = ""
  let out = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split("\n")
    buf = parts.pop() ?? ""
    out = applyLines(parts, out, onDelta)
  }
  if (buf.trim()) out = applyLines([buf], out, onDelta)
  return out
}

function collectSSE(text, onDelta) {
  return applyLines(String(text).split("\n"), "", onDelta)
}

function applyLines(lines, out, onDelta) {
  let next = out
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue
    const data = trimmed.slice(5).trim()
    if (!data || data === "[DONE]") continue
    let json
    try { json = JSON.parse(data) } catch { continue }
    if (json.error) {
      const message = json.error?.message || json.message || "翻译模型返回错误"
      throw new Error(message)
    }
    const choice = json.choices?.[0]
    const delta = choice?.delta?.content
    const full = choice?.message?.content
    if (typeof full === "string" && full) next = full
    else if (typeof delta === "string") next += delta
    if (onDelta) onDelta(next)
  }
  return next
}
