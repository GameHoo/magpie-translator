import { DEFAULT_GATEWAY_KEY, DEFAULT_MAGPIE_BASE } from "./constants.mjs"
import { restore } from "./mask.mjs"
import { systemPrompt } from "./prompt.mjs"

export async function translateJob(job, { fetchImpl = globalThis.fetch, onDelta } = {}) {
  const base = String(job.magpieBaseUrl || DEFAULT_MAGPIE_BASE).replace(/\/$/, "")
  const res = await fetchImpl(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${job.gatewayKey || DEFAULT_GATEWAY_KEY}`,
      "user-agent": "magpie-plain-zh/0.1",
    },
    body: JSON.stringify({
      model: job.translator,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt(job) },
        { role: "user", content: job.masked },
      ],
    }),
    signal: AbortSignal.timeout(job.timeoutMs || 90_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    const brief = detail.replace(/\s+/g, " ").slice(0, 180)
    throw new Error(`翻译模型返回 HTTP ${res.status}${brief ? `：${brief}` : ""}`)
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
