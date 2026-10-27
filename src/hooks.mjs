import { randomUUID } from "node:crypto"
import { parseFlag, presentation } from "./config.mjs"
import { MAX_MASKED_CHARS } from "./constants.mjs"
import { extractUserText } from "./extract.mjs"
import { sameLanguage } from "./language.mjs"
import { maskCode } from "./mask.mjs"
import { matchRule } from "./match.mjs"
import { isOwnRequest } from "./own.mjs"
import { magpieBaseUrl } from "./paths.mjs"
import { enqueue } from "./queue.mjs"
import { skipReason } from "./turn.mjs"
import { ensureWorker } from "./worker.mjs"

// magpie 要求异步 hook 导出 onRequest。`magpie plugin list` 固定印
// “async gateway hook onRequest”，不看这里还导出了什么。
// onResponse 只把任务写进数据目录就返回。翻译本身要 12–105 秒，
// 而宿主把 hook 停在 gatewayTimeoutMs（最多 10 秒，host.js）。
// 脱离的工人做完后，把一份有大小上限的摘要写进 options.feed。
// 摘要没变就不碰 plugins.json。hook 自己不写这个文件。

if (process.env.MAGPIE_TRANSLATOR_NO_SPAWN !== "1") ensureWorker()

export async function onRequest(body, ctx) {
  try {
    if (ctx && typeof ctx === "object") {
      if (!ctx.state || typeof ctx.state !== "object") ctx.state = {}
      ctx.state.own = isOwnRequest(body)
    }
  } catch {
    // 认不出来就当普通请求。返回 undefined，宿主保持原字节。
  }
}

export async function onResponse(reply, ctx) {
  try {
    if (!ctx || reply == null || typeof reply !== "object") return
    if (ctx.state?.own || isOwnRequest(ctx.request)) return
    enqueueCurrent(reply, ctx)
    ensureWorker()
  } catch {
    // 入队失败就没有译文。原回复已经在客户端那边。
  }
}

function enqueueCurrent(reply, ctx) {
  const options = ctx.options || {}
  if (!parseFlag(options.enabled, true)) return
  const model = ctx.request?.model ?? ctx.model ?? ""
  const rule = matchRule(options, { agent: ctx.agent || "", model })
  if (!rule) return
  const extracted = extractUserText(reply, ctx.protocol)
  if (!extracted.text) return
  if (skipReason(ctx.request, extracted.text)) return
  const view = presentation(options, rule)
  const masked = maskCode(extracted.text, view.maskCode)
  if (!masked.prose) return
  let text = masked.masked
  let truncated = false
  if (text.length > MAX_MASKED_CHARS) {
    text = text.slice(0, MAX_MASKED_CHARS)
    truncated = true
  }
  if (!view.rewriteSameLanguage && sameLanguage(masked.prose, view.language)) return
  enqueue({
    id: randomUUID(),
    at: new Date().toISOString(),
    agent: ctx.agent || "",
    session: ctx.session || "",
    model,
    translator: rule.translator,
    language: view.language,
    prompt: view.prompt,
    style: view.style,
    protocol: extracted.protocol || ctx.protocol || "",
    original: extracted.text,
    masked: text,
    slots: masked.slots,
    maskCode: view.maskCode,
    truncated,
    magpieBaseUrl: magpieBaseUrl(options),
    translateTimeoutMs: view.translateTimeoutMs,
    historyLimit: view.historyLimit,
    display: view.display,
    webhookUrl: view.webhookUrl,
    origin: typeof ctx.origin === "string" ? ctx.origin : "",
    allowRemoteExport: view.allowRemoteExport,
  })
}
