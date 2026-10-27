import { parseTimeout } from "./config.mjs"
import { DEFAULT_GATEWAY_KEY, DEFAULT_MAGPIE_BASE } from "./constants.mjs"
import { restore } from "./mask.mjs"
import { systemPrompt } from "./prompt.mjs"

export async function translateJob(job, opts = {}) {
  const asked = parseTimeout(job.translateTimeoutMs ?? job.timeoutMs)
  const timeoutMs = Math.min(asked, Number(opts.maxMs) > 0 ? Number(opts.maxMs) : asked)
  try {
    return await translateOnce(job, opts, timeoutMs)
  } catch (err) {
    if (opts.signal?.aborted || !retriable(err)) throw err
    try {
      return await translateOnce(job, opts, timeoutMs)
    } catch (again) {
      const error = new Error(`${again?.message || again}（已重试一次）`)
      error.cause = again
      error.status = again?.status
      throw error
    }
  }
}

async function translateOnce(job, { fetchImpl = globalThis.fetch, onDelta, signal } = {}, timeoutMs) {
  const base = String(job.magpieBaseUrl || DEFAULT_MAGPIE_BASE).replace(/\/$/, "")
  const res = await fetchImpl(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${job.gatewayKey || DEFAULT_GATEWAY_KEY}`,
      "user-agent": "magpie-translator/0.1",
    },
    body: JSON.stringify({
      model: job.translator,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt(job) },
        { role: "user", content: job.masked },
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
  return restore(raw, Array.isArray(job.slots) ? job.slots : [])
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

function retriable(err) {
  const status = Number(err?.status)
  if (status === 408 || status === 429 || status >= 500) return true
  if (status >= 400) return false
  const name = String(err?.name || "")
  const message = String(err?.message || err)
  if (name === "TimeoutError" || name === "AbortError") return true
  return /timed out|timeout|aborted|fetch failed|network|ECONNRESET|EAI_AGAIN|socket hang up/i.test(message)
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
