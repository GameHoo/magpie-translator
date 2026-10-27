#!/usr/bin/env node
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseDisplay } from "./config.mjs"
import { DEFAULT_PANEL_PORT } from "./constants.mjs"
import { dataDir, ensureDir, inboxDir, logPath } from "./paths.mjs"
import { persistItem } from "./sinks.mjs"
import { translateJob } from "./translate.mjs"

const MAX_ITEMS = 200

export function startPanel(options = {}) {
  const home = options.home || dataDir()
  const port = options.port ?? Number(process.env.MAGPIE_PLAIN_ZH_PORT || DEFAULT_PANEL_PORT)
  const startupDisplay = parseDisplay(options.display ?? process.env.MAGPIE_PLAIN_ZH_DISPLAY)
  const env = { ...process.env, MAGPIE_PLAIN_ZH_HOME: home }
  const state = { items: [], clients: new Set(), inflight: new Set() }
  ensureDir(home)
  ensureDir(inboxDir(env))
  const server = http.createServer((req, res) => handle(req, res, env, state))
  let listening = null
  let boundPort = null
  function openHttp() {
    if (listening) return listening
    listening = new Promise((resolve, reject) => {
      server.once("error", (err) => {
        listening = null
        reject(err)
      })
      server.listen(port, "127.0.0.1", () => {
        boundPort = server.address().port
        resolve(boundPort)
      })
    })
    return listening
  }
  const tick = () => pump(env, state, openHttp).catch((err) => console.error(err))
  const timer = setInterval(tick, 250)
  timer.unref?.()
  const api = {
    get port() { return boundPort },
    get url() { return boundPort ? `http://127.0.0.1:${boundPort}` : null },
    home,
    close() {
      clearInterval(timer)
      for (const client of state.clients) client.end()
      state.clients.clear()
      if (!boundPort) return Promise.resolve()
      return new Promise((done) => server.close(() => done()))
    },
  }
  if (!startupDisplay.includes("panel")) {
    tick()
    return Promise.resolve(api)
  }
  return openHttp().then(() => {
    tick()
    return api
  })
}

function handle(req, res, env, state) {
  const url = new URL(req.url || "/", "http://127.0.0.1")
  if (req.method === "GET" && url.pathname === "/favicon.ico") {
    res.writeHead(204)
    res.end()
    return
  }
  if (req.method === "GET" && url.pathname === "/") return page(res)
  if (req.method === "GET" && url.pathname === "/health") return sendJson(res, { name: "magpie-plain-zh", ok: true })
  if (req.method === "GET" && url.pathname === "/api/items") return sendJson(res, { items: state.items.map(publicItem) })
  if (req.method === "GET" && url.pathname === "/latest.txt") return sendText(res, latestText(state))
  if (req.method === "GET" && url.pathname === "/events") return events(req, res, state)
  if (req.method === "GET" && url.pathname === "/log.jsonl") return sendText(res, readLog(env))
  sendJson(res, { error: "not found" }, 404)
}

function page(res) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
  res.end(PAGE)
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(body))
}

function sendText(res, body) {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
  res.end(body)
}

function events(req, res, state) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
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
  await show()
  await persistItem(env, item, display, job.webhookUrl || "")
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
  <p>工作模型的原文会原样回到 Codex、Claude Code 和其他客户端的会话里。这里只展示转述。目标语言、提示词和出口由配置决定，默认是通俗中文。转述不写进下一轮发给原模型的请求。</p>
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
