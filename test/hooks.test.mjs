import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { MARKER } from "../src/constants.mjs"
import { onRequest, onResponse } from "../src/hooks.mjs"
import { systemPrompt } from "../src/prompt.mjs"

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plain-zh-"))
  process.env.MAGPIE_PLAIN_ZH_HOME = home
  process.env.MAGPIE_PLAIN_ZH_NO_SPAWN = "1"
  return home
}

function jobs(home) {
  const dir = path.join(home, "inbox")
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
}

const rule = { rules: [{ agent: "codex", model: "gpt-5.4", translator: "deepseek/deepseek-chat" }] }

test("onRequest 不改请求体", async () => {
  const body = { model: "gpt-5.4", stream: true, input: [{ role: "user", content: "hi" }] }
  const snapshot = structuredClone(body)
  const ctx = { state: {}, options: rule, agent: "codex", model: "gpt-5.4", protocol: "responses" }
  const returned = await onRequest(body, ctx)
  assert.equal(returned, undefined)
  assert.deepEqual(body, snapshot)
})

test("失败、不匹配、工具轮、以及翻译请求自己，都不写收件箱", async () => {
  const home = tempHome()
  const reply = {
    output: [{ type: "message", phase: "final_answer", content: [{ type: "output_text", text: "The cache invalidates." }] }],
  }
  await onResponse(reply, { success: false, options: rule, agent: "codex", model: "gpt-5.4", protocol: "responses", request: { model: "gpt-5.4" }, state: {} })
  await onResponse(reply, { success: true, options: rule, agent: "claude", model: "gpt-5.4", protocol: "responses", request: { model: "gpt-5.4" }, state: {} })
  await onResponse({
    output: [{ type: "function_call", name: "bash", arguments: "{}", call_id: "c1" }],
  }, { success: true, options: rule, agent: "codex", model: "gpt-5.4", protocol: "responses", request: { model: "gpt-5.4" }, state: {} })
  const own = {
    model: "gpt-5.4",
    messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: "The cache invalidates." }],
  }
  assert.equal(own.messages[0].content.includes(MARKER), true)
  const state = {}
  await onRequest(own, { state })
  assert.equal(state.own, true)
  await onResponse(reply, { success: true, options: { rules: [{ translator: "deepseek/deepseek-chat" }] }, agent: "codex", model: "gpt-5.4", protocol: "responses", request: own, state })
  assert.equal(jobs(home).length, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test("onResponse 不改回复对象，收件箱里是原文而不是译文", async () => {
  const home = tempHome()
  const reply = {
    output: [{ type: "message", phase: "final_answer", content: [{ type: "output_text", text: "The cache invalidates when the file mtime changes." }] }],
  }
  const snapshot = structuredClone(reply)
  const returned = await onResponse(reply, {
    success: true,
    options: { ...rule, magpieBaseUrl: "http://127.0.0.1:9", gatewayKey: "secret-key" },
    agent: "codex",
    protocol: "responses",
    model: "gpt-5.4",
    request: { model: "gpt-5.4" },
    state: {},
  })
  assert.equal(returned, undefined)
  assert.deepEqual(reply, snapshot)
  const [job] = jobs(home)
  assert.equal(job.original, "The cache invalidates when the file mtime changes.")
  assert.equal(job.translator, "deepseek/deepseek-chat")
  assert.equal(job.language, "简体中文")
  assert.deepEqual(job.display, ["panel", "log"])
  assert.equal(job.masked.includes("文件"), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("旁路写盘失败时 onResponse 仍然正常返回", async () => {
  const blocker = path.join(os.tmpdir(), `plain-zh-block-${process.pid}`)
  fs.writeFileSync(blocker, "not a directory")
  process.env.MAGPIE_PLAIN_ZH_HOME = path.join(blocker, "child")
  process.env.MAGPIE_PLAIN_ZH_NO_SPAWN = "1"
  const reply = { choices: [{ message: { role: "assistant", content: "Hello from the model." }, finish_reason: "stop" }] }
  await assert.doesNotReject(() => onResponse(reply, {
    success: true,
    options: { rules: [{ translator: "deepseek/deepseek-chat" }] },
    protocol: "chat",
    model: "gpt-5.4",
    request: { model: "gpt-5.4" },
    state: {},
  }))
  fs.rmSync(blocker, { force: true })
})
