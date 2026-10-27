import { randomUUID } from "node:crypto"
import { parseFlag, presentation } from "./config.mjs"
import { DEFAULT_GATEWAY_KEY, MAX_MASKED_CHARS } from "./constants.mjs"
import { extractUserText } from "./extract.mjs"
import { addComparison, findHistory, hasSeen, markSeen, publicFeed, readHistory, recordTranslation, replaceTranslation, restoreFeed } from "./history.mjs"
import { sameLanguage } from "./language.mjs"
import { maskCode } from "./mask.mjs"
import { matchRule } from "./match.mjs"
import { listModels } from "./models.mjs"
import { isOwnRequest } from "./own.mjs"
import { publishRuntime } from "./options.mjs"
import { dataDir, magpieBaseUrl } from "./paths.mjs"
import { persistItem } from "./sinks.mjs"
import { translateJob } from "./translate.mjs"
import { skipReason } from "./turn.mjs"

// magpie 要求异步 hook 导出 onRequest。`magpie plugin list` 固定印
// “async gateway hook onRequest”，不看这里还导出了什么。
// 翻译在 onResponse 里当场完成：返回值会被丢掉，客户端字节已经写完。
// 页面读历史、提交对照，都走 magpie.options（plugins.json）。没有别的读接口。

const restored = new Set()
const listedOnce = new Set()

function envOf() {
  return process.env
}

function gatewayCap(options) {
  const n = Number(options?.gatewayTimeoutMs)
  return Number.isInteger(n) && n >= 100 && n <= 10000 ? n : 1000
}

function gatewayKey(options) {
  return typeof options?.gatewayKey === "string" && options.gatewayKey.trim()
    ? options.gatewayKey.trim()
    : DEFAULT_GATEWAY_KEY
}

export async function onRequest(body, ctx) {
  try {
    if (ctx && typeof ctx === "object") {
      if (!ctx.state || typeof ctx.state !== "object") ctx.state = {}
      ctx.state.own = isOwnRequest(body)
      if (!ctx.state.own) await syncFeed(ctx, { restore: true })
    }
  } catch {
    // 认不出来就当普通请求。返回 undefined，宿主保持原字节。
  }
}

export async function onResponse(reply, ctx) {
  try {
    if (!ctx || reply == null || typeof reply !== "object") return
    if (ctx.state?.own || isOwnRequest(ctx.request)) return
    await syncFeed(ctx, { restore: true })
    await translateCurrent(reply, ctx)
    let clearJob = false
    if (!ctx.signal?.aborted && ctx.options?._compare) clearJob = await runCompare(ctx)
    const models = await maybeModels(ctx)
    await syncFeed(ctx, { clearJob, models })
  } catch {
    // 旁路失败就没有译文。原回复已经在客户端那边。
  }
}

async function syncFeed(ctx, { restore = false, clearJob = false, models } = {}) {
  const env = envOf()
  const limit = presentation(ctx?.options || {}).historyLimit
  const key = dataDir(env)
  if (restore && !restored.has(key)) {
    restored.add(key)
    restoreFeed(env, limit)
  }
  const wrote = publishRuntime(env, { feed: publicFeed(readHistory(env)), models, clearJob })
  if (clearJob && ctx?.options) delete ctx.options._compare
  return wrote
}

async function maybeModels(ctx) {
  const options = ctx?.options || {}
  if (Array.isArray(options.models) || ctx.signal?.aborted) return undefined
  const key = dataDir(envOf())
  if (listedOnce.has(key)) return undefined
  listedOnce.add(key)
  const listed = await listModels({
    baseUrl: magpieBaseUrl(options),
    gatewayKey: gatewayKey(options),
    timeoutMs: 800,
    fetchImpl: typeof ctx.fetch === "function" ? ctx.fetch : globalThis.fetch,
  })
  return listed.models.length ? listed.models : undefined
}

async function translateCurrent(reply, ctx) {
  const options = ctx.options || {}
  if (!parseFlag(options.enabled, true)) return
  const model = ctx.request?.model ?? ctx.model ?? ""
  const rule = matchRule(options, { agent: ctx.agent || "", model })
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
  const view = presentation(options, rule)
  if (!view.rewriteSameLanguage && sameLanguage(masked.prose, view.language)) return
  const job = {
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
    truncated,
    magpieBaseUrl: magpieBaseUrl(options),
    gatewayKey: gatewayKey(options),
    translateTimeoutMs: view.translateTimeoutMs,
  }
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    translation = await translateJob(job, { fetchImpl: ctx.fetch, signal: ctx.signal, maxMs: gatewayCap(options) })
  } catch (err) {
    error = String(err?.message || err).slice(0, 500)
  }
  const entry = {
    ...job,
    ms: Date.now() - started,
    translation,
    error,
    status: error ? "error" : "done",
  }
  recordTranslation(entry, envOf(), view.historyLimit)
  await persistItem(envOf(), entry, view.display, view.webhookUrl)
}

// 页面用 magpie.options.set 写入 _compare。宿主因此重载，下一次 onResponse 在这里调用翻译模型。
// 同一个 nonce 只跑一次。replace 为真时覆盖这条译文，否则追加到 comparisons。
export async function runCompare(ctx, env = envOf()) {
  const options = ctx?.options || {}
  const request = options._compare
  if (!request || typeof request !== "object") return false
  const nonce = String(request.nonce || "")
  const entryId = String(request.entryId || "")
  const translator = String(request.translator || "").trim()
  if (!nonce || !entryId || !translator) return true
  if (hasSeen(nonce, env)) return true
  const row = findHistory(entryId, env)
  if (!row) {
    markSeen(nonce, env)
    return true
  }
  markSeen(nonce, env)
  const view = presentation(options)
  const job = {
    translator,
    language: row.language || view.language,
    prompt: row.prompt || "",
    style: row.style || "",
    model: row.model || "",
    masked: row.masked || row.original || "",
    slots: Array.isArray(row.slots) ? row.slots : [],
    magpieBaseUrl: row.magpieBaseUrl || magpieBaseUrl(options),
    gatewayKey: gatewayKey(options),
    translateTimeoutMs: view.translateTimeoutMs,
  }
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    translation = await translateJob(job, { fetchImpl: ctx.fetch, signal: ctx.signal, maxMs: gatewayCap(options) })
  } catch (err) {
    error = String(err?.message || err).slice(0, 500)
  }
  const patch = {
    id: `compare-${nonce}`,
    translator,
    translation,
    error,
    ms: Date.now() - started,
    at: new Date().toISOString(),
  }
  if (request.replace === true) replaceTranslation(entryId, patch, env)
  else addComparison(entryId, patch, env)
  return true
}
