#!/usr/bin/env node
// 用本机 magpie 网关走一轮真实请求：客户端看见的流是英文，旁路面板是中文，
// 下一轮经 magpie 转给工作模型的请求体里没有中文译文。
//
// MAGPIE_BIN 指向 magpie 可执行文件，默认 /tmp/magpie-cli。

import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { MARKER } from "../src/constants.mjs"

const MAGPIE = process.env.MAGPIE_BIN || "/tmp/magpie-cli"
const EN1 = "The cache invalidates when the file mtime changes."
const EN2 = "Run that when the entry looks stale."
const CMD = "stat -c %Y file"
const ZH1 = "文件的修改时间一变，缓存就作废。"
const ZH2 = "缓存项看起来过期时，就运行上面的命令。"
const FOLLOWUP = "FOLLOWUP-TOKEN-2"
const ANSWER = `${EN1}\n\n\`\`\`bash\n${CMD}\n\`\`\`\n\n${EN2}`
const TRANSLATION = `${ZH1}\n\n⟦0⟧\n\n${ZH2}`

const children = []
const servers = []

function track(child) {
  children.push(child)
  return child
}

function cleanup() {
  for (const child of children) {
    try { child.kill("SIGTERM") } catch { /* 已经退出 */ }
  }
  for (const server of servers) {
    try { server.close() } catch { /* 已经关闭 */ }
  }
}

process.on("exit", cleanup)
process.on("SIGINT", () => { cleanup(); process.exit(1) })
process.on("SIGTERM", () => { cleanup(); process.exit(1) })

function listen(port, onRequest) {
  const bodies = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString("utf8")
    bodies.push({ method: req.method, url: req.url, body })
    await onRequest(req, res, body)
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({ bodies, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

function chatChunk(content, finish) {
  return {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-work",
    choices: [{ index: 0, delta: content == null ? {} : { content }, finish_reason: finish }],
  }
}

function writeSSE(res, chunks) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write("data: [DONE]\n\n")
  res.end()
}

function startMock(port) {
  return listen(port, async (req, res, body) => {
    if (req.url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-work" }, { id: "translator-zh" }] }))
      return
    }
    let json = {}
    try { json = JSON.parse(body || "{}") } catch { json = {} }
    const raw = body || ""
    const translating = raw.includes(MARKER)
    const text = translating ? TRANSLATION : ANSWER
    const pieces = translating ? [ZH1 + "\n\n", "⟦0⟧\n\n", ZH2] : [EN1 + "\n\n", "```bash\n" + CMD + "\n```\n\n", EN2]
    if (json.stream === false) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({
        id: "chatcmpl-e2e",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      }))
      return
    }
    writeSSE(res, [
      chatChunk("", null),
      ...pieces.map((piece) => chatChunk(piece, null)),
      chatChunk(null, "stop"),
    ])
  })
}

function magpieEnv(home) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    MAGPIE_PLAIN_ZH_HOME: path.join(home, "plain-zh"),
    MAGPIE_PLAIN_ZH_NO_SPAWN: "",
  }
}

function runMagpie(home, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(MAGPIE, args, { env: magpieEnv(home), stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (chunk) => { out += chunk })
    child.stderr.on("data", (chunk) => { out += chunk })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`magpie ${args.join(" ")} 退出 ${code}\n${out}`))
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(fn, ms, label) {
  const start = Date.now()
  let last
  while (Date.now() - start < ms) {
    try {
      const value = await fn()
      if (value) return value
    } catch (err) {
      last = err
    }
    await sleep(200)
  }
  throw new Error(`${label} 超时${last ? `：${last.message}` : ""}`)
}

function collectText(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed)
      const content = json.choices?.[0]?.message?.content
      if (typeof content === "string") return content
    } catch { /* 按 SSE 再试 */ }
  }
  let out = ""
  for (const line of raw.split("\n")) {
    const row = line.trim()
    if (!row.startsWith("data:")) continue
    const data = row.slice(5).trim()
    if (!data || data === "[DONE]") continue
    let json
    try { json = JSON.parse(data) } catch { continue }
    const delta = json.choices?.[0]?.delta?.content
    const full = json.choices?.[0]?.message?.content
    if (typeof delta === "string") out += delta
    else if (typeof full === "string") out = full
    const outputDelta = json.delta
    if (json.type === "response.output_text.delta" && typeof outputDelta === "string") out += outputDelta
    const anthropic = json.delta?.text
    if (json.type === "content_block_delta" && typeof anthropic === "string") out += anthropic
  }
  return out
}

async function postJSON(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer e2e-local", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  const raw = await res.text()
  return { status: res.status, raw, text: collectText(raw), type: res.headers.get("content-type") || "" }
}

function stringsOf(wire) {
  let json
  try { json = JSON.parse(wire) } catch { return wire }
  const out = []
  const walk = (value) => {
    if (typeof value === "string") out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === "object") Object.values(value).forEach(walk)
  }
  walk(json)
  return out.join("\n")
}

async function main() {
  if (!fs.existsSync(MAGPIE)) {
    console.error(`找不到 magpie：${MAGPIE}`)
    process.exit(2)
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "magpie-plain-zh-e2e-"))
  const plainHome = path.join(home, "plain-zh")
  const gwPort = 34671
  const mockPort = 34672
  const panelPort = 44741
  fs.mkdirSync(path.join(home, ".config", "magpie"), { recursive: true })
  fs.writeFileSync(path.join(home, ".config", "magpie", "settings.json"), JSON.stringify({ port: gwPort }))

  const mock = await startMock(mockPort)
  console.log(`mock ${mock.url}`)
  await runMagpie(home, ["provider", "add", "mock", `url=${mock.url}/v1`, "key=sk-test", "models=gpt-work,translator-zh"])
  await runMagpie(home, ["plugin", "add", "/workspace"])
  const options = {
    gatewayTimeoutMs: 8000,
    panelPort,
    language: "LangTokenE2E",
    magpieBaseUrl: `http://127.0.0.1:${gwPort}`,
    gatewayKey: "e2e-local",
    rules: [{ model: "gpt-work", translator: "mock/translator-zh" }],
  }
  await runMagpie(home, ["plugin", "options", "/workspace", JSON.stringify(options)])

  const log = []
  const gw = track(spawn(MAGPIE, ["serve"], { env: magpieEnv(home), stdio: ["ignore", "pipe", "pipe"] }))
  gw.stdout.on("data", (chunk) => log.push(String(chunk)))
  gw.stderr.on("data", (chunk) => log.push(String(chunk)))
  gw.on("exit", (code) => log.push(`\n[magpie serve exit ${code}]\n`))

  const base = `http://127.0.0.1:${gwPort}`
  try {
    await waitFor(async () => {
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(2000) })
      return res.ok ? true : null
    }, 30_000, "magpie 网关")
    console.log(`magpie ${base}/v1`)

    const first = await postJSON(`${base}/v1/chat/completions`, {
      model: "mock/gpt-work",
      stream: true,
      messages: [{ role: "user", content: "Explain the cache rule and include the mtime command." }],
    })
    if (first.status !== 200) throw new Error(`第一轮 HTTP ${first.status}\n${first.raw.slice(0, 800)}`)
    if (!first.text.includes(EN1) || !first.text.includes(CMD)) {
      throw new Error(`客户端没有拿到英文原文：${JSON.stringify(first.text).slice(0, 500)}`)
    }
    if (first.text.includes(ZH1) || first.text.includes(ZH2)) {
      throw new Error("客户端流里出现了译文")
    }
    console.log("第一轮客户端流是英文，不含译文")

    const item = await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${panelPort}/api/items`, { signal: AbortSignal.timeout(2000) })
      if (!res.ok) return null
      const body = await res.json()
      const failed = body.items?.find((entry) => entry.status === "error")
      if (failed) throw new Error(`面板转述失败：${failed.error}`)
      return body.items?.find((entry) => entry.status === "done" && entry.translation.includes(ZH1)) || null
    }, 90_000, "旁路面板")
    if (!item.translation.includes(CMD) || !item.translation.includes(ZH2)) {
      throw new Error(`译文没有嵌回代码：${item.translation}`)
    }
    console.log(`面板 ${item.agent ? `agent=${item.agent} ` : ""}已显示中文，代码块仍是原文`)

    const translatorBodies = mock.bodies.filter((entry) => entry.body.includes(MARKER))
    if (translatorBodies.length !== 1) throw new Error(`翻译请求应只有 1 次，实际 ${translatorBodies.length}`)
    const translatorText = stringsOf(translatorBodies[0].body)
    if (!translatorText.includes(EN1)) throw new Error("翻译请求里没有英文正文")
    if (!translatorText.includes("LangTokenE2E")) throw new Error("翻译请求没有用上配置的目标语言")
    if (translatorText.includes(CMD)) throw new Error("翻译请求里出现了被保护的命令")
    if (!translatorText.includes("⟦0⟧")) throw new Error("翻译请求里没有代码占位符")

    const second = await postJSON(`${base}/v1/chat/completions`, {
      model: "mock/gpt-work",
      stream: true,
      messages: [
        { role: "user", content: "Explain the cache rule and include the mtime command." },
        { role: "assistant", content: first.text },
        { role: "user", content: FOLLOWUP },
      ],
    })
    if (second.status !== 200) throw new Error(`第二轮 HTTP ${second.status}\n${second.raw.slice(0, 800)}`)
    if (second.text.includes(ZH1)) throw new Error("第二轮客户端流出现了译文")

    const follow = mock.bodies.filter((entry) => entry.body.includes(FOLLOWUP) && !entry.body.includes(MARKER))
    if (follow.length !== 1) throw new Error(`发给工作模型的续轮应只有 1 次，实际 ${follow.length}`)
    const followText = stringsOf(follow[0].body)
    for (const leaked of [ZH1, ZH2, MARKER, "e2e-local", "LangTokenE2E"]) {
      if (followText.includes(leaked)) throw new Error(`下一轮工作模型请求含有 ${leaked}`)
    }
    for (const kept of [EN1, EN2, CMD, FOLLOWUP]) {
      if (!followText.includes(kept)) throw new Error(`下一轮工作模型请求缺少 ${kept}`)
    }
    console.log("下一轮发给工作模型的请求不含译文")

    const extras = []
    extras.push(await attempt("responses", () => postJSON(`${base}/v1/responses`, {
      model: "mock/gpt-work",
      stream: true,
      input: "Explain the cache rule.",
    })))
    extras.push(await attempt("anthropic", () => postJSON(`${base}/v1/messages`, {
      model: "mock/gpt-work",
      max_tokens: 256,
      stream: true,
      messages: [{ role: "user", content: "Explain the cache rule." }],
    })))
    console.log(JSON.stringify({
      ok: true,
      client: "english",
      panel: "chinese-with-original-code",
      nextUpstream: "no-translation",
      translatorCalls: translatorBodies.length,
      agentSeen: item.agent || "",
      extras,
      home,
    }, null, 2))
  } catch (err) {
    console.error(err?.stack || err)
    console.error("--- magpie log ---")
    console.error(log.join("").slice(-4000))
    console.error("--- mock urls ---")
    console.error(mock.bodies.map((entry) => entry.url).join("\n"))
    try {
      console.error("--- inbox ---")
      console.error(fs.readdirSync(path.join(plainHome, "inbox")).join("\n"))
    } catch { /* 没有收件箱 */ }
    process.exitCode = 1
  } finally {
    cleanup()
    await sleep(300)
  }
}

async function attempt(name, fn) {
  try {
    const got = await fn()
    const english = got.text.includes(EN1)
    const clean = !got.text.includes(ZH1)
    return { name, status: got.status, english, clean, type: got.type, head: got.raw.slice(0, 180) }
  } catch (err) {
    return { name, error: err.message }
  }
}

main()
