import { randomUUID } from "node:crypto"
import { presentation } from "./config.mjs"
import { DEFAULT_GATEWAY_KEY, DEFAULT_PANEL_PORT, MAX_MASKED_CHARS } from "./constants.mjs"
import { deliver } from "./enqueue.mjs"
import { extractUserText } from "./extract.mjs"
import { maskCode } from "./mask.mjs"
import { matchRule } from "./match.mjs"
import { isOwnRequest } from "./own.mjs"
import { magpieBaseUrl } from "./paths.mjs"

// magpie 要求异步 hook 导出 onRequest。这里不改请求体：返回 undefined，宿主保持原字节。
export async function onRequest(body, ctx) {
  try {
    if (ctx && typeof ctx === "object") {
      if (!ctx.state || typeof ctx.state !== "object") ctx.state = {}
      ctx.state.own = isOwnRequest(body)
    }
  } catch {
    // 认不出来就当普通请求，onResponse 还会再查一次 ctx.request。
  }
}

// 宿主会丢掉这个函数的返回值，客户端那边的字节已经写完了。这里只把正文放进本机收件箱。
export async function onResponse(reply, ctx) {
  try {
    if (!ctx || ctx.success === false || reply == null || typeof reply !== "object") return
    if (ctx.state?.own || isOwnRequest(ctx.request)) return
    const model = ctx.request?.model ?? ctx.model ?? ""
    const rule = matchRule(ctx.options, { agent: ctx.agent || "", model })
    if (!rule) return
    const extracted = extractUserText(reply, ctx.protocol)
    if (!extracted.text) return
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
    })
  } catch {
    // 旁路失败就没有译文。原回复已经在客户端那边，不受影响。
  }
}
