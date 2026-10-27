const ID = /^[A-Za-z0-9._~@+-]+\/[A-Za-z0-9._~:+-]+$/

export function modelsFromGateway(body) {
  const data = body?.data
  if (!Array.isArray(data)) return []
  const out = []
  for (const item of data) {
    const id = typeof item?.id === "string" ? item.id.trim() : ""
    if (!ID.test(id) || out.includes(id)) continue
    out.push(id)
    if (out.length >= 400) break
  }
  return out
}

export function parseModelLines(text) {
  const out = []
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const token = line.trim().split(/\s+/)[0] || ""
    if (!ID.test(token) || out.includes(token)) continue
    out.push(token)
    if (out.length >= 400) break
  }
  return out
}

export async function listModels({ baseUrl, gatewayKey, timeoutMs = 2500, fetchImpl = globalThis.fetch } = {}) {
  const gateway = await gatewayModels(baseUrl, gatewayKey, timeoutMs, fetchImpl)
  if (gateway.models.length) return { source: "gateway", models: gateway.models, error: "" }
  return { source: "none", models: [], error: gateway.error || "列不出模型" }
}

async function gatewayModels(baseUrl, gatewayKey, timeoutMs, fetchImpl) {
  if (!baseUrl) return { models: [], error: "" }
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/v1/models`, {
      headers: gatewayKey ? { authorization: `Bearer ${gatewayKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { models: [], error: `模型列表 HTTP ${res.status}` }
    return { models: modelsFromGateway(await res.json()), error: "" }
  } catch (err) {
    return { models: [], error: String(err?.message || err).slice(0, 180) }
  }
}

