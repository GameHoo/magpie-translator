#!/usr/bin/env node
// 本机演示：假的翻译模型 + 旁路面板。不需要 magpie，也不需要厂商密钥。
// 页面停在 127.0.0.1:44721，进程保持运行。

import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { MARKER } from "../src/constants.mjs"
import { maskCode } from "../src/mask.mjs"
import { startPanel } from "../src/panel.mjs"

const PORT = Number(process.env.MAGPIE_PLAIN_ZH_PORT || 44721)
const HOME = process.env.MAGPIE_PLAIN_ZH_HOME || "/tmp/magpie-plain-zh-demo"

const EN1 = "The cache invalidates when the file mtime changes."
const EN2 = "Run that when the entry looks stale."
const CMD = "stat -c %Y file"
const ORIGINAL = `${EN1}\n\n\`\`\`bash\n${CMD}\n\`\`\`\n\n${EN2}`
const ZH1 = "文件的修改时间一变，缓存就作废。"
const ZH2 = "缓存项看起来过期时，就运行上面的命令。"

function listen(onRequest) {
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    await onRequest(req, res, Buffer.concat(chunks).toString("utf8"))
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }))
  })
}

function writeSSE(res, pieces) {
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" })
  let i = 0
  const timer = setInterval(() => {
    if (i < pieces.length) {
      const chunk = {
        choices: [{ index: 0, delta: { content: pieces[i] }, finish_reason: null }],
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      i += 1
      return
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
    res.write("data: [DONE]\n\n")
    res.end()
    clearInterval(timer)
  }, 120)
}

const masked = maskCode(ORIGINAL)
const mock = await listen(async (_req, res, body) => {
  if (!body.includes(MARKER)) {
    res.writeHead(400, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: { message: "demo translator expected the sidecar marker" } }))
    return
  }
  writeSSE(res, [ZH1 + "\n\n", "⟦0⟧\n\n", ZH2])
})

fs.rmSync(HOME, { recursive: true, force: true })
fs.mkdirSync(HOME, { recursive: true })
const panel = await startPanel({ home: HOME, port: PORT })
const inbox = path.join(HOME, "inbox")
fs.mkdirSync(inbox, { recursive: true })

function writeJob(job) {
  const file = path.join(inbox, `${job.id}.json`)
  fs.writeFileSync(file, JSON.stringify(job), { mode: 0o600 })
}

writeJob({
  id: "demo-cache",
  at: new Date().toISOString(),
  agent: "codex",
  session: "demo",
  model: "openai/gpt-5.4",
  translator: "deepseek/deepseek-chat",
  language: "简体中文",
  display: ["panel", "log"],
  protocol: "responses",
  original: ORIGINAL,
  masked: masked.masked,
  slots: masked.slots,
  truncated: false,
  magpieBaseUrl: `http://127.0.0.1:${mock.port}`,
  gatewayKey: "demo-not-a-vendor-key",
  panelPort: panel.port,
  style: "用短句。",
})

const failAt = new Date(Date.now() + 1000).toISOString()
setTimeout(() => {
  writeJob({
    id: "demo-failed",
    at: failAt,
    agent: "claude",
    session: "demo",
    model: "claude-opus-4-7",
    translator: "gemini/gemini-2.5-flash",
    language: "简体中文",
    display: ["panel", "log"],
    protocol: "anthropic",
    original: "The retry budget is three attempts, then the call fails open.",
    masked: "The retry budget is three attempts, then the call fails open.",
    slots: [],
    truncated: false,
    magpieBaseUrl: "http://127.0.0.1:9",
    gatewayKey: "demo-not-a-vendor-key",
    panelPort: panel.port,
    style: "",
  })
}, 800)

console.log(panel.url)
console.log(`home ${HOME}`)
