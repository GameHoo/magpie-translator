import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { MARKER } from "../src/constants.mjs"
import { extractUserText } from "../src/extract.mjs"
import { onResponse } from "../src/hooks.mjs"
import { startPanel } from "../src/panel.mjs"
import { chatNextRequest, claudeNextRequest, codexNextRequest, geminiNextRequest } from "../src/replay.mjs"
import { assembleAnthropic, assembleChat, assembleResponses, encodeSSE } from "../src/sse.mjs"

const EN1 = "The cache invalidates when the file mtime changes."
const EN2 = "Run that when the entry looks stale."
const CMD = "stat -c %Y file"
const THINK = "Check the inode mtime before trusting the entry."
const SIG = "sig-original-do-not-touch"
const ZH1 = "文件的修改时间一变，缓存就作废。"
const ZH2 = "缓存项看起来过期时，就运行上面的命令。"

function englishAnswer() {
  return `${EN1}\n\n\`\`\`bash\n${CMD}\n\`\`\`\n\n${EN2}`
}

function listen(onRequest) {
  const bodies = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString("utf8")
    bodies.push({ url: req.url, body })
    await onRequest(req, res, body)
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolve({
        bodies,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

function responsesSse(text, { tool = false } = {}) {
  const reasoning = { type: "reasoning", id: "rs_1", content: [{ type: "reasoning_text", text: THINK }] }
  const message = {
    type: "message",
    role: "assistant",
    phase: tool ? "commentary" : "final_answer",
    status: "completed",
    content: [{ type: "output_text", text }],
  }
  const output = [reasoning, message]
  if (tool) output.push({ type: "function_call", name: "bash", call_id: "call_1", arguments: JSON.stringify({ command: CMD }) })
  const response = { id: "resp_1", object: "response", status: "completed", model: "gpt-5.4", output }
  return encodeSSE([
    ...output.map((item, index) => ({ event: "response.output_item.done", data: { type: "response.output_item.done", output_index: index, item } })),
    { event: "response.completed", data: { type: "response.completed", response } },
  ])
}

function chatSse(text, { tool = false } = {}) {
  const events = [
    { data: { choices: [{ index: 0, delta: { role: "assistant", content: text.slice(0, 16) } }] } },
    { data: { choices: [{ index: 0, delta: { content: text.slice(16) } }] } },
    { data: { choices: [{ index: 0, delta: { reasoning_content: THINK }, finish_reason: tool ? null : "stop" }] } },
  ]
  if (tool) {
    events.push({
      data: {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: CMD }) } }] },
          finish_reason: "tool_calls",
        }],
      },
    })
  }
  events.push({ data: "[DONE]" })
  return encodeSSE(events)
}

function anthropicSse(text, { tool = false } = {}) {
  const events = [
    { event: "message_start", data: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-4-7", content: [] } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: THINK } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: SIG } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(0, 24) } } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(24) } } },
    { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
  ]
  if (tool) {
    events.push(
      { event: "content_block_start", data: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "Bash", input: {} } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: CMD }) } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" } } },
    )
  } else {
    events.push({ event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" } } })
  }
  events.push({ event: "message_stop", data: { type: "message_stop" } })
  return encodeSSE(events)
}

test("下一轮发给原模型的请求不含译文", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-proof-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.MAGPIE_TRANSLATOR_NO_SPAWN = "1"
  const translator = await listen((_req, res, body) => {
    const json = JSON.parse(body)
    assert.equal(json.messages[0].content.includes(MARKER), true)
    assert.equal(json.messages[1].content.includes(CMD), false)
    assert.match(json.messages[1].content, /⟦0⟧/)
    const payload = `${ZH1}\n\n⟦0⟧\n\n${ZH2}`
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" })
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: payload } }] })}\n\ndata: [DONE]\n\n`)
  })
  const recorder = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" })
    res.end("{}")
  })
  const panel = await startPanel({ home, port: 0 })
  const options = {
    magpieBaseUrl: translator.url,
    gatewayKey: "secret-gateway-key",
    panelPort: panel.port,
    display: ["panel", "log"],
    rules: [
      { agent: "codex", model: "gpt-5.4", translator: "mock/translator-zh" },
      { agent: "claude", model: "claude-*", translator: "mock/translator-zh" },
    ],
  }
  let doneCount = 0

  async function waitTranslation() {
    const start = Date.now()
    while (Date.now() - start < 6000) {
      const body = await (await fetch(`${panel.url}/api/items`)).json()
      const done = body.items.filter((item) => item.status === "done")
      const failed = body.items.find((item) => item.status === "error")
      if (failed) throw new Error(failed.error)
      if (done.length > doneCount) {
        doneCount = done.length
        return done[0]
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw new Error("转述没有出现在旁路面板")
  }

  async function sendToWorkModel(request, pathName) {
    const res = await fetch(`${recorder.url}${pathName}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
    assert.equal(res.status, 200)
    return recorder.bodies.at(-1).body
  }

  function gathered(wire) {
    const out = []
    const walk = (value) => {
      if (typeof value === "string") out.push(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === "object") Object.values(value).forEach(walk)
    }
    walk(JSON.parse(wire))
    return out.join("\n")
  }

  function assertClean(wire, item) {
    const text = gathered(wire)
    assert.equal(text.includes(ZH1), false)
    assert.equal(text.includes(ZH2), false)
    assert.equal(text.includes(item.translation), false)
    assert.equal(text.includes(MARKER), false)
    assert.equal(text.includes("secret-gateway-key"), false)
    assert.equal(text.includes(EN1), true)
    assert.equal(text.includes(EN2), true)
    assert.equal(text.includes(CMD), true)
    assert.equal(text.includes(THINK), true)
    assert.equal(item.translation.includes(ZH1), true)
    assert.equal(item.translation.includes(ZH2), true)
    assert.equal(item.translation.includes(CMD), true)
    assert.equal(JSON.stringify(item).includes("secret-gateway-key"), false)
  }

  try {
    const answer = englishAnswer()

    const responses = assembleResponses(responsesSse(answer))
    assert.equal(extractUserText(responses.hookReply, "responses").text, answer)
    const responsesReply = structuredClone(responses.hookReply)
    await onResponse(responsesReply, {
      success: true, options, agent: "codex", protocol: "responses", model: "gpt-5.4",
      request: { model: "gpt-5.4", stream: true }, state: {},
    })
    assert.deepEqual(responsesReply, responses.hookReply)
    const responsesItem = await waitTranslation()
    const responsesWire = await sendToWorkModel(codexNextRequest({
      model: "gpt-5.4",
      items: responses.items,
      followup: "继续，用原来的结论。",
    }), "/v1/responses")
    assertClean(responsesWire, responsesItem)

    const claude = assembleAnthropic(anthropicSse(answer))
    assert.equal(extractUserText(claude.hookReply, "anthropic").text, answer)
    assert.equal(claude.content[0].signature, SIG)
    await onResponse(claude.hookReply, {
      success: true, options, agent: "claude", protocol: "anthropic", model: "claude-opus-4-7",
      request: { model: "claude-opus-4-7", stream: true }, state: {},
    })
    const claudeItem = await waitTranslation()
    const claudeWire = await sendToWorkModel(claudeNextRequest({
      model: "claude-opus-4-7",
      content: claude.content,
      followup: "继续，用原来的结论。",
    }), "/v1/messages")
    assertClean(claudeWire, claudeItem)
    assert.equal(claudeWire.includes(SIG), true)

    const chat = assembleChat(chatSse(answer))
    assert.equal(extractUserText(chat.hookReply, "chat").text, answer)
    await onResponse(chat.hookReply, {
      success: true, options, agent: "codex", protocol: "chat", model: "gpt-5.4",
      request: { model: "gpt-5.4", stream: true }, state: {},
    })
    const chatItem = await waitTranslation()
    const chatWire = await sendToWorkModel(chatNextRequest({
      model: "gpt-5.4",
      message: chat.message,
      followup: "继续，用原来的结论。",
    }), "/v1/chat/completions")
    assertClean(chatWire, chatItem)

    const geminiReply = {
      candidates: [{ content: { role: "model", parts: [{ thought: true, text: THINK }, { text: answer }] }, finishReason: "STOP" }],
    }
    await onResponse(geminiReply, {
      success: true, options, agent: "codex", protocol: "gemini", model: "gpt-5.4",
      request: { model: "gpt-5.4" }, state: {},
    })
    const geminiItem = await waitTranslation()
    const geminiWire = await sendToWorkModel(geminiNextRequest({
      model: "gpt-5.4",
      parts: geminiReply.candidates[0].content.parts,
      followup: "继续，用原来的结论。",
    }), "/v1beta/models/gpt-5.4:generateContent")
    assertClean(geminiWire, geminiItem)

    const callsBefore = translator.bodies.length
    const itemsBefore = (await (await fetch(`${panel.url}/api/items`)).json()).items.length
    const toolSse = assembleResponses(responsesSse("I'll check the mtime.", { tool: true }))
    await onResponse(toolSse.hookReply, {
      success: true, options, agent: "codex", protocol: "responses", model: "gpt-5.4",
      request: { model: "gpt-5.4" }, state: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    const after = await (await fetch(`${panel.url}/api/items`)).json()
    assert.equal(after.items.length, itemsBefore)
    assert.equal(translator.bodies.length, callsBefore)
    const toolText = gathered(await sendToWorkModel(codexNextRequest({
      model: "gpt-5.4",
      items: toolSse.items,
      followup: "结果是 1710000000。",
    }), "/v1/responses"))
    assert.equal(toolText.includes(ZH1), false)
    assert.equal(toolText.includes(CMD), true)
    assert.equal(toolText.includes("I'll check the mtime."), true)
  } finally {
    await panel.close()
    await translator.close()
    await recorder.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("如果流里的正文被改成译文，下一轮请求就会带上译文", () => {
  const rewritten = assembleChat(chatSse(ZH1))
  const next = chatNextRequest({ model: "gpt-5.4", message: rewritten.message, followup: "继续" })
  assert.equal(JSON.stringify(next).includes(ZH1), true)

  const responses = assembleResponses(responsesSse(ZH1))
  const codex = codexNextRequest({ model: "gpt-5.4", items: responses.items, followup: "继续" })
  assert.equal(JSON.stringify(codex).includes(ZH1), true)

  const claude = assembleAnthropic(anthropicSse(ZH1))
  const messages = claudeNextRequest({ model: "claude-opus-4-7", content: claude.content, followup: "继续" })
  assert.equal(JSON.stringify(messages).includes(ZH1), true)
})
