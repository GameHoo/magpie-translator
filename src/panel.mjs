#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseDisplay, parseFlag } from "./config.mjs"
import { DEFAULT_GATEWAY_KEY, DEFAULT_PANEL_PORT } from "./constants.mjs"
import { noteCompare } from "./hooks.mjs"
import { addComparison, recordTranslation } from "./history.mjs"
import { listModels } from "./models.mjs"
import { findPlugin, loadSettings, packageRoot, readPluginList, saveSettings } from "./options.mjs"
import { dataDir, ensureDir, inboxDir, logPath, magpieBaseUrl } from "./paths.mjs"
import { writeCatalog } from "./publish.mjs"
import { SETTINGS_PAGE } from "./settings-page.mjs"
import { persistItem } from "./sinks.mjs"
import { translateJob } from "./translate.mjs"

const MAX_ITEMS = 200

export function startPanel(options = {}) {
  const home = options.home || dataDir()
  const port = options.port ?? Number(process.env.MAGPIE_TRANSLATOR_PORT || DEFAULT_PANEL_PORT)
  const env = { ...process.env, ...options.env, MAGPIE_TRANSLATOR_HOME: home }
  const state = { items: [], clients: new Set(), inflight: new Set() }
  const session = {
    csrf: options.csrfToken || randomBytes(32).toString("hex"),
    maxBody: options.maxBody || 256 * 1024,
    locate: {
      spec: options.pluginSpec || env.MAGPIE_TRANSLATOR_PLUGIN || "",
      root: packageRoot(),
    },
    listModels: options.listModels,
    port: 0,
  }
  ensureDir(home)
  ensureDir(inboxDir(env))
  const server = http.createServer((req, res) => {
    Promise.resolve(handle(req, res, env, state, session)).catch((err) => {
      if (!res.headersSent) sendJson(res, { error: "面板内部错误" }, 500)
      console.error(err)
    })
  })
  let listening = null
  let boundPort = null
  let boundHost = null
  function openHttp() {
    if (listening) return listening
    listening = new Promise((resolve, reject) => {
      server.once("error", (err) => {
        listening = null
        reject(err)
      })
      server.listen(port, "127.0.0.1", () => {
        const info = server.address()
        boundPort = info.port
        boundHost = info.address
        session.port = boundPort
        resolve(boundPort)
      })
    })
    return listening
  }
  const timers = []
  const every = (fn, ms) => {
    const id = setInterval(fn, ms)
    id.unref?.()
    timers.push(id)
  }
  const tick = () => pump(env, state, openHttp).catch((err) => console.error(err))
  every(tick, 250)
  if (backgroundWork(env)) {
    every(() => noteCompare(pluginOptions(env, session.locate), env), 2000)
    every(() => { refreshCatalog(env, session).catch((err) => console.error(err)) }, 60_000)
    refreshCatalog(env, session).catch((err) => console.error(err))
  }
  const api = {
    get port() { return boundPort },
    get host() { return boundHost },
    get url() { return boundPort ? `http://127.0.0.1:${boundPort}` : null },
    home,
    close() {
      for (const id of timers) clearInterval(id)
      for (const client of state.clients) client.end()
      state.clients.clear()
      if (!boundPort) return Promise.resolve()
      return new Promise((done) => server.close(() => done()))
    },
  }
  if (!httpRequested(options)) {
    tick()
    return Promise.resolve(api)
  }
  return openHttp().then(() => {
    tick()
    return api
  })
}

function httpRequested(options) {
  const displayGiven = options.display !== undefined
    || (process.env.MAGPIE_TRANSLATOR_DISPLAY != null && process.env.MAGPIE_TRANSLATOR_DISPLAY !== "")
  const display = parseDisplay(options.display ?? process.env.MAGPIE_TRANSLATOR_DISPLAY)
  const local = parseFlag(
    options.localPanel !== undefined ? options.localPanel : process.env.MAGPIE_TRANSLATOR_LOCAL,
    false,
  )
  if (!displayGiven) return true
  return display.includes("panel") || local
}

function backgroundWork(env) {
  if (process.execArgv.includes("--test") || env.NODE_TEST_CONTEXT) return false
  return true
}

function pluginOptions(env, locate) {
  try {
    const { list, missing } = readPluginList(env)
    if (missing) return null
    return findPlugin(list, env, locate)?.options || null
  } catch {
    return null
  }
}

async function refreshCatalog(env, session) {
  let listed = { source: "none", models: [], error: "" }
  try {
    listed = await listConfiguredModels(env, session)
  } catch (err) {
    listed = { source: "none", models: [], error: String(err?.message || err).slice(0, 180) }
  }
  writeCatalog({
    at: new Date().toISOString(),
    source: listed.source || "none",
    models: Array.isArray(listed.models) ? listed.models : [],
    error: listed.error || "",
  }, env)
}

async function handle(req, res, env, state, guard) {
  const url = new URL(req.url || "/", "http://127.0.0.1")
  if (!boundHostOk(req, guard)) return sendJson(res, { error: "forbidden" }, 403)
  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204, safeHeaders())
    res.end()
    return
  }
  if (req.method === "GET" && url.pathname === "/") return page(res)
  if (req.method === "GET" && url.pathname === "/settings") return settingsPage(res)
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, { name: "magpie-translator", ok: true })
  if (req.method === "GET" && url.pathname === "/api/items") return sendJson(res, { items: state.items.map(publicItem) })
  if (req.method === "GET" && url.pathname === "/api/settings") return sendJson(res, settingsBody(env, guard))
  if (req.method === "GET" && url.pathname === "/api/models") return sendJson(res, await modelBody(env, guard))
  if (url.pathname === "/api/settings" && req.method === "POST") return saveBody(req, res, env, guard)
  if (url.pathname === "/api/settings") return sendJson(res, { error: "forbidden" }, 403)
  if (req.method === "GET" && url.pathname === "/latest.txt") return sendText(res, latestText(state))
  if (req.method === "GET" && url.pathname === "/events") return events(req, res, state)
  if (req.method === "GET" && url.pathname === "/log.jsonl") return sendText(res, readLog(env))
  sendJson(res, { error: "not found" }, 404)
}

function boundHostOk(req, guard) {
  const host = String(req.headers.host || "").toLowerCase()
  const port = String(guard.port || "")
  if (!port) return false
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`
}

function page(res) {
  res.writeHead(200, { ...safeHeaders(), "content-type": "text/html; charset=utf-8" })
  res.end(PAGE)
}

function settingsPage(res) {
  res.writeHead(200, { ...safeHeaders(), "content-type": "text/html; charset=utf-8" })
  res.end(SETTINGS_PAGE)
}

function safeHeaders() {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  }
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { ...safeHeaders(), "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

function sendText(res, body) {
  res.writeHead(200, { ...safeHeaders(), "content-type": "text/plain; charset=utf-8" })
  res.end(body)
}

function settingsBody(env, session) {
  const loaded = loadSettings(env, session.locate)
  return {
    csrf: session.csrf,
    found: loaded.found,
    file: loaded.file,
    spec: loaded.spec,
    off: loaded.off,
    error: loaded.error,
    options: loaded.options,
    preserved: loaded.options.preserved,
    displays: ["panel", "log", "file", "stdout", "notify", "webhook"],
    placeholders: ["{language}", "{style}", "{model}", "{translator}"],
  }
}

async function modelBody(env, session) {
  try {
    if (session.listModels) return await session.listModels()
    return await listConfiguredModels(env, session)
  } catch (err) {
    return { source: "none", models: [], error: String(err?.message || err).slice(0, 180) }
  }
}

async function listConfiguredModels(env, session) {
  let baseUrl = magpieBaseUrl({}, env)
  let gatewayKey = DEFAULT_GATEWAY_KEY
  try {
    const { list } = readPluginList(env)
    const entry = findPlugin(list, env, session.locate)
    const raw = entry?.options || {}
    baseUrl = magpieBaseUrl(raw, env)
    if (typeof raw.gatewayKey === "string" && raw.gatewayKey.trim()) gatewayKey = raw.gatewayKey.trim()
  } catch { /* 没有配置文件时仍试本机网关 */ }
  const listed = await listModels({
    baseUrl,
    gatewayKey,
    bin: env.MAGPIE_BIN || "magpie",
    env,
  })
  return { source: listed.source, models: listed.models, error: listed.error || "" }
}

async function saveBody(req, res, env, session) {
  if (!mutationOk(req, res, session)) return
  let input
  try {
    input = JSON.parse(await readBody(req, session.maxBody))
  } catch (err) {
    const status = err.status || 400
    sendJson(res, { error: status === 413 ? "请求太大" : "设置不是合法 JSON" }, status)
    return
  }
  try {
    const saved = saveSettings(input, env, session.locate)
    sendJson(res, {
      ok: true,
      changed: saved.changed,
      spec: saved.spec,
      file: saved.file,
      options: saved.options,
      preserved: saved.preserved,
    })
  } catch (err) {
    sendJson(res, { error: err.message || "没有保存" }, err.status || 500)
  }
}

function mutationOk(req, res, session) {
  if (!originOk(req, session.port)) return deny(res)
  if (!refererOk(req, session.port)) return deny(res)
  const site = req.headers["sec-fetch-site"]
  if (site && site !== "same-origin" && site !== "none") return deny(res)
  if (!csrfOk(req, session.csrf)) return deny(res)
  const type = String(req.headers["content-type"] || "").toLowerCase()
  if (!type.includes("application/json")) {
    sendJson(res, { error: "content-type 必须是 application/json" }, 415)
    return false
  }
  return true
}

function deny(res) {
  sendJson(res, { error: "forbidden" }, 403)
  return false
}

function originOk(req, port) {
  const origin = req.headers.origin
  if (!origin) return true
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`
}

function refererOk(req, port) {
  const referer = req.headers.referer || req.headers.referrer
  if (!referer) return true
  try {
    const url = new URL(referer)
    const host = url.hostname.toLowerCase()
    return (host === "127.0.0.1" || host === "localhost") && url.port === String(port)
  } catch {
    return false
  }
}

function csrfOk(req, token) {
  const got = req.headers["x-magpie-translator-csrf"]
  if (typeof got !== "string" || Buffer.byteLength(got) !== Buffer.byteLength(token)) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(token))
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on("data", (chunk) => {
      if (failed) return
      size += chunk.length
      if (size > limit) {
        failed = true
        const error = new Error("too large")
        error.status = 413
        reject(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks).toString("utf8")) })
    req.on("error", (err) => { if (!failed) reject(err) })
  })
}

function events(req, res, state) {
  res.writeHead(200, {
    ...safeHeaders(),
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
  })
  res.write(`data: ${JSON.stringify({ type: "snapshot", items: state.items.map(publicItem) })}\n\n`)
  state.clients.add(res)
  req.on("close", () => state.clients.delete(res))
}

function broadcast(state, message) {
  const line = `data: ${JSON.stringify(message)}\n\n`
  for (const client of state.clients) client.write(line)
}

function publicItem(item) {
  return {
    id: item.id,
    at: item.at,
    agent: item.agent,
    session: item.session,
    model: item.model,
    translator: item.translator,
    protocol: item.protocol,
    language: item.language || "",
    status: item.status,
    original: item.original,
    translation: item.translation || "",
    error: item.error || "",
    truncated: !!item.truncated,
  }
}

function latestText(state) {
  const item = state.items.find((entry) => entry.status === "done" || entry.status === "error")
  if (!item) return "还没有转述。\n"
  if (item.status === "error") return `转述失败：${item.error}\n\n原文：\n${item.original}\n`
  return `${item.translation}\n`
}

function readLog(env) {
  try { return fs.readFileSync(logPath(env), "utf8") } catch { return "" }
}

async function pump(env, state, openHttp) {
  const dir = inboxDir(env)
  let names = []
  try { names = fs.readdirSync(dir) } catch { return }
  for (const name of names.filter((file) => file.endsWith(".json")).sort()) {
    if (state.inflight.has(name)) continue
    state.inflight.add(name)
    const file = path.join(dir, name)
    try {
      const job = JSON.parse(fs.readFileSync(file, "utf8"))
      fs.unlinkSync(file)
      await runJob(job, env, state, openHttp)
    } catch (err) {
      try { fs.unlinkSync(file) } catch { /* 已经取走 */ }
      console.error(err)
    } finally {
      state.inflight.delete(name)
    }
  }
}

async function runJob(job, env, state, openHttp) {
  if (job.kind === "compare") {
    await runCompare(job, env)
    return
  }
  const display = parseDisplay(job.display)
  const item = {
    id: job.id,
    at: job.at || new Date().toISOString(),
    agent: job.agent || "",
    session: job.session || "",
    model: job.model || "",
    translator: job.translator || "",
    language: job.language || "",
    protocol: job.protocol || "",
    original: job.original || job.masked || "",
    translation: "",
    status: "translating",
    error: "",
    truncated: !!job.truncated,
  }
  let shown = false
  let gate = Promise.resolve()
  const show = () => {
    gate = gate.then(async () => {
      if (!display.includes("panel") || item.panelError) return
      try { await openHttp() } catch (err) {
        item.panelError = err.message
        return
      }
      if (!shown) {
        state.items.unshift(item)
        if (state.items.length > MAX_ITEMS) state.items.pop()
        shown = true
      }
      broadcast(state, { type: "upsert", item: publicItem(item) })
    }).catch(() => {})
    return gate
  }
  await show()
  let lastSend = 0
  const started = Date.now()
  try {
    item.translation = await translateJob(job, {
      onDelta(text) {
        item.translation = text
        const now = Date.now()
        if (now - lastSend > 80) {
          lastSend = now
          show()
        }
      },
    })
    item.status = "done"
    item.error = ""
  } catch (err) {
    item.status = "error"
    item.error = err?.message || String(err)
  }
  item.ms = Date.now() - started
  await show()
  try {
    recordTranslation({
      id: item.id,
      at: item.at,
      agent: item.agent,
      model: item.model,
      translator: item.translator,
      language: item.language,
      ms: item.ms,
      original: item.original,
      translation: item.translation,
      error: item.error,
      status: item.status,
      prompt: job.prompt || "",
      style: job.style || "",
      masked: job.masked || "",
      slots: job.slots || [],
      magpieBaseUrl: job.magpieBaseUrl || "",
    }, env, job.historyLimit)
  } catch (err) {
    console.error(err)
  }
  await persistItem(env, item, display, job.webhookUrl || "")
}

async function runCompare(job, env) {
  const started = Date.now()
  let translation = ""
  let error = ""
  try {
    translation = await translateJob(job)
  } catch (err) {
    error = err?.message || String(err)
  }
  addComparison(job.entryId, {
    id: job.id,
    translator: job.translator || "",
    translation,
    error,
    ms: Date.now() - started,
  }, env)
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>旁路转述</title>
<style>
  :root {
    --ink: #1c1915;
    --muted: #6b6258;
    --paper: #f3eee4;
    --card: #fffaf3;
    --line: #e2d8c8;
    --seal: #9c2f2f;
    --ok: #2f6b4f;
    --warn: #8a5a12;
    --code: #efe6d6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--ink);
    background:
      radial-gradient(1200px 400px at 10% -10%, #f7e7d2 0%, transparent 55%),
      var(--paper);
    font-family: "Iowan Old Style", Palatino, "Palatino Linotype", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
    line-height: 1.55;
  }
  header, main, footer { width: min(880px, calc(100% - 32px)); margin: 0 auto; }
  header { padding: 36px 0 8px; }
  .seal {
    display: inline-block;
    color: var(--seal);
    border: 1px solid var(--seal);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 12px;
    letter-spacing: 0.12em;
    font-family: ui-sans-serif, "Noto Sans CJK SC", sans-serif;
  }
  h1 { font-size: 40px; font-weight: 560; margin: 12px 0 8px; letter-spacing: 0.04em; }
  header p, footer { color: var(--muted); }
  header p { margin: 0; max-width: 64ch; }
  nav { margin-top: 14px; font-family: ui-sans-serif, "Noto Sans CJK SC", sans-serif; font-size: 14px; }
  nav a { color: var(--seal); }
  .empty {
    margin: 28px 0;
    padding: 28px;
    border: 1px dashed var(--line);
    border-radius: 18px;
    background: rgba(255,250,243,0.7);
  }
  article {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px 18px 14px;
    margin: 16px 0;
    box-shadow: 0 10px 30px rgba(60, 40, 10, 0.04);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    color: var(--muted);
    font-size: 13px;
    font-family: ui-sans-serif, "Noto Sans CJK SC", sans-serif;
  }
  .status { color: var(--warn); }
  .status.done { color: var(--ok); }
  .status.error { color: var(--seal); }
  h2 { font-size: 15px; margin: 16px 0 8px; font-weight: 600; }
  .body { font-size: 18px; white-space: pre-wrap; word-break: break-word; }
  pre {
    margin: 10px 0;
    padding: 12px 14px;
    background: var(--code);
    border-radius: 12px;
    overflow: auto;
    font-family: ui-monospace, "Source Code Pro", monospace;
    font-size: 13.5px;
    line-height: 1.45;
    white-space: pre;
  }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: var(--muted); font-family: ui-sans-serif, sans-serif; font-size: 13px; }
  button {
    margin-top: 10px;
    border: 1px solid var(--line);
    background: transparent;
    border-radius: 999px;
    padding: 4px 12px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  footer { margin-bottom: 40px; font-size: 13px; font-family: ui-sans-serif, sans-serif; }
  code { font-family: ui-monospace, monospace; font-size: 12.5px; }
</style>
</head>
<body>
<header>
  <span class="seal">旁路</span>
  <h1>转述</h1>
  <p>工作模型的原文会原样回到 Codex、Claude Code 和其他客户端的会话里。这里只展示译文。目标语言由 language 决定，默认是简体中文，可以写成 English、日本語、Français 这类任意名字。译文不写进下一轮发给原模型的请求。</p>
  <nav><a href="/settings">设置</a></nav>
</header>
<main>
  <div class="empty" id="empty">还没有转述。命中规则的工作模型说完一轮最终回复后，转述会出现在这里。</div>
  <div id="list"></div>
</main>
<footer>终端里看最新一条：<code id="latest"></code></footer>
<script>
document.querySelector("#latest").textContent = "curl -s http://127.0.0.1:" + location.port + "/latest.txt"
const list = document.querySelector("#list")
const empty = document.querySelector("#empty")
const byId = new Map()

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]))
}

function rich(text) {
  const fence = String.fromCharCode(96).repeat(3)
  const parts = String(text ?? "").split(fence)
  let html = ""
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) html += '<div class="body">' + escapeHtml(parts[i]) + "</div>"
    } else {
      const nl = parts[i].indexOf(String.fromCharCode(10))
      const code = nl === -1 ? parts[i] : parts[i].slice(nl + 1)
      html += "<pre><code>" + escapeHtml(code) + "</code></pre>"
    }
  }
  return html
}

function card(item) {
  const who = [item.agent, item.model].filter(Boolean).join(" · ") || "未命名会话"
  const status = item.status === "done" ? "已转述" : item.status === "error" ? "转述失败" : "正在转述"
  const when = item.at ? new Date(item.at).toLocaleString("zh-CN", { hour12: false }) : ""
  const note = item.truncated ? '<p class="status">原文后半被截断，这次只转述了前面一部分。</p>' : ""
  const body = item.status === "error"
    ? '<p class="status error">' + escapeHtml(item.error || "转述失败") + "</p>" + note + rich(item.original)
    : note + rich(item.translation || (item.status === "translating" ? "…" : ""))
  const lang = item.language ? '<span>' + escapeHtml(item.language) + "</span>" : ""
  return '<article data-id="' + escapeHtml(item.id) + '">'
    + '<div class="meta"><span>' + escapeHtml(who) + "</span>" + lang + '<span>→ ' + escapeHtml(item.translator || "") + '</span>'
    + '<span class="status ' + escapeHtml(item.status) + '">' + status + '</span><span>' + escapeHtml(when) + '</span></div>'
    + "<h2>转述</h2>" + body
    + "<details><summary>原文</summary>" + rich(item.original) + "</details>"
    + '<button type="button" data-copy="' + escapeHtml(item.id) + '">复制转述</button></article>'
}

function render() {
  const rows = [...byId.values()]
  empty.hidden = rows.length > 0
  list.innerHTML = rows.map(card).join("")
}

function remember(item) {
  if (!byId.has(item.id)) {
    const next = new Map([[item.id, item]])
    for (const [key, value] of byId) next.set(key, value)
    byId.clear()
    for (const [key, value] of next) byId.set(key, value)
  } else {
    byId.set(item.id, item)
  }
  render()
}

document.body.addEventListener("click", async (ev) => {
  const id = ev.target && ev.target.dataset ? ev.target.dataset.copy : ""
  if (!id) return
  const item = byId.get(id)
  const text = item && item.status === "done" ? item.translation : (item && item.original) || ""
  try { await navigator.clipboard.writeText(text) }
  catch {
    const area = document.createElement("textarea")
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand("copy")
    area.remove()
  }
  ev.target.textContent = "已复制"
  setTimeout(() => { ev.target.textContent = "复制转述" }, 1200)
})

const source = new EventSource("/events")
source.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.type === "snapshot") {
    byId.clear()
    for (const item of msg.items || []) byId.set(item.id, item)
    render()
  } else if (msg.type === "upsert" && msg.item) {
    remember(msg.item)
  }
}
</script>
</body>
</html>
`

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const pidfile = path.join(dataDir(), "panel.pid")
  try {
    ensureDir(dataDir())
    fs.writeFileSync(pidfile, String(process.pid), { mode: 0o600 })
  } catch { /* 面板仍可手动打开 */ }
  startPanel().then((panel) => {
    console.log(panel.url || panel.home)
  }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
