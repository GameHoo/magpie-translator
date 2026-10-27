import { parseTimeout } from "./config.mjs"
import { DEFAULT_GATEWAY_KEY, DEFAULT_MAGPIE_BASE } from "./constants.mjs"
import { restore } from "./mask.mjs"
import { systemPrompt } from "./prompt.mjs"

export async function translateJob(job, opts = {}) {
  const timeoutMs = parseTimeout(job.translateTimeoutMs ?? job.timeoutMs)
  try {
    return await translateOnce(job, opts, timeoutMs)
  } catch (err) {
    if (!retriable(err)) throw err
    try {
      return await translateOnce(job, opts, timeoutMs)
    } catch (again) {
      const error = new Error(`${again?.message || again}（已重试一次）`)
      error.cause = again
      throw error
    }
  }
}

async function translateOnce(job, { fetchImpl = globalThis.fetch, onDelta } = {}, timeoutMs) {
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
    signal: AbortSignal.timeout(timeoutMs),
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
