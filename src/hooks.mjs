import { randomUUID } from "node:crypto"
import { presentation } from "./config.mjs"
import { DEFAULT_GATEWAY_KEY, DEFAULT_PANEL_PORT, MAX_MASKED_CHARS } from "./constants.mjs"
import { deliver } from "./enqueue.mjs"
import { findHistory, hasSeen, markSeen } from "./history.mjs"
import { extractUserText } from "./extract.mjs"
import { sameLanguage } from "./language.mjs"
import { maskCode } from "./mask.mjs"
import { matchRule } from "./match.mjs"
import { isOwnRequest } from "./own.mjs"
import { magpieBaseUrl } from "./paths.mjs"
import { skipReason } from "./turn.mjs"

// magpie 要求异步 hook 导出 onRequest。这里不改请求体：返回 undefined，宿主保持原字节。
export async function onRequest(body, ctx) {
  try {
    noteCompare(ctx?.options, process.env)
    if (ctx && typeof ctx === "object") {
      if (!ctx.state || typeof ctx.state !== "object") ctx.state = {}
      ctx.state.own = isOwnRequest(body)
    }
  } catch {
    // 认不出来就当普通请求，onResponse 还会再查一次 ctx.request。
  }
}

export function noteCompare(options, env = process.env) {
  const request = options?._compare
  if (!request || typeof request !== "object") return
  const nonce = String(request.nonce || "")
  const entryId = String(request.entryId || "")
  const translator = String(request.translator || "").trim()
  if (!nonce || !entryId || !translator || hasSeen(nonce, env)) return
  const row = findHistory(entryId, env)
  if (!row) return
  markSeen(nonce, env)
  deliver({
    kind: "compare",
    id: `compare-${nonce}`,
    entryId,
    nonce,
    at: new Date().toISOString(),
    translator,
    language: row.language || "",
    prompt: row.prompt || "",
    style: row.style || "",
    original: row.original || "",
    masked: row.masked || row.original || "",
    slots: Array.isArray(row.slots) ? row.slots : [],
    magpieBaseUrl: row.magpieBaseUrl || magpieBaseUrl(options, env),
    gatewayKey: typeof options.gatewayKey === "string" && options.gatewayKey.trim() ? options.gatewayKey.trim() : DEFAULT_GATEWAY_KEY,
    translateTimeoutMs: presentation(options).translateTimeoutMs,
    display: ["log"],
    localPanel: false,
  }, env)
}

// 宿主会丢掉这个函数的返回值，客户端那边的字节已经写完了。这里只把正文放进本机收件箱。
export async function onResponse(reply, ctx) {
  try {
    if (!ctx || reply == null || typeof reply !== "object") return
    if (ctx.state?.own || isOwnRequest(ctx.request)) return
    const model = ctx.request?.model ?? ctx.model ?? ""
    const rule = matchRule(ctx.options, { agent: ctx.agent || "", model })
    if (!rule) return
    const extracted = extractUserText(reply, ctx.protocol)
    if (!extracted.text) return
    if (skipReason(ctx.request, extracted.text)) return
    const masked = maskCode(extracted.text)
    if (!masked.prose) return
    let text = masked.masked
    let truncated = false
    if (text.length > MAX_MASKED_CHARS) {
      text = text.slice(0, MAX_MASKED_CHARS)
      truncated = true
    }
    const options = ctx.options || {}
    const view = presentation(options, rule)
    if (!view.rewriteSameLanguage && sameLanguage(masked.prose, view.language)) return
    deliver({
      id: randomUUID(),
      at: new Date().toISOString(),
      agent: ctx.agent || "",
      session: ctx.session || "",
      model,
      translator: rule.translator,
      language: view.language,
      prompt: view.prompt,
      style: view.style,
      display: view.display,
      webhookUrl: view.webhookUrl,
      protocol: extracted.protocol || ctx.protocol || "",
      original: extracted.text,
      masked: text,
      slots: masked.slots,
      truncated,
      magpieBaseUrl: magpieBaseUrl(options),
      gatewayKey: typeof options.gatewayKey === "string" && options.gatewayKey.trim() ? options.gatewayKey.trim() : DEFAULT_GATEWAY_KEY,
      panelPort: Number(options.panelPort) || DEFAULT_PANEL_PORT,
      translateTimeoutMs: view.translateTimeoutMs,
      localPanel: view.localPanel,
      historyLimit: view.historyLimit,
    })
  } catch {
    // 旁路失败就没有译文。原回复已经在客户端那边，不受影响。
  }
}
