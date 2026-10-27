import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { MARKER } from "../src/constants.mjs"
import { noteCompare, onRequest, onResponse } from "../src/hooks.mjs"
import { recordTranslation } from "../src/history.mjs"
import { systemPrompt } from "../src/prompt.mjs"

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.MAGPIE_TRANSLATOR_NO_SPAWN = "1"
  return home
}

function jobs(home) {
  const dir = path.join(home, "inbox")
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
}

const rule = { rules: [{ agent: "codex", model: "gpt-5.4", translator: "deepseek/deepseek-chat" }] }

test("翻译由 onResponse 入队，onRequest 只标自己的请求", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  const ctx = {
    success: true,
    options: rule,
    agent: "codex",
    protocol: "chat",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", messages: [{ role: "user", content: "explain" }] },
    state: {},
  }
  await onRequest(ctx.request, ctx)
  assert.equal(ctx.state.own, false)
  assert.equal(jobs(home).length, 0)
  await onResponse(reply, ctx)
  assert.equal(jobs(home).length, 1)
  assert.equal(jobs(home)[0].original.includes("mtime"), true)
  fs.rmSync(home, { recursive: true, force: true })
})

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
  await onResponse({ status: "failed", output: [] }, { success: false, options: rule, agent: "codex", model: "gpt-5.4", protocol: "responses", request: { model: "gpt-5.4" }, state: {} })
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
  assert.deepEqual(job.display, ["log"])
  assert.equal(job.masked.includes("文件"), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("success 为 false 但回复里仍有正文时入队", async () => {
  const home = tempHome()
  const reply = {
    status: "incomplete",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The read stays linearizable." }] }],
  }
  await onResponse(reply, {
    success: false,
    options: rule,
    agent: "codex",
    protocol: "responses",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", input: [{ role: "user", content: "explain" }] },
    state: {},
  })
  assert.equal(jobs(home).length, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test("原文已经是目标语言时默认跳过，打开改写后仍入队", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "你用的是什么模型？" }, finish_reason: "stop" }] }
  const request = { model: "gpt-5.4", messages: [{ role: "user", content: "问一下" }] }
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request,
    state: {},
    options: { language: "简体中文", rules: [{ translator: "mock/zh" }] },
  })
  assert.equal(jobs(home).length, 0)
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request,
    state: {},
    options: { language: "简体中文", rewriteSameLanguage: true, rules: [{ translator: "mock/zh" }] },
  })
  assert.equal(jobs(home).length, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test("enabled 为 false 时不入队", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", messages: [{ role: "user", content: "explain" }] },
    state: {},
    options: { enabled: false, rules: [{ translator: "mock/zh" }] },
  })
  assert.equal(jobs(home).length, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test("对照请求入队一次，重试带上 replace", () => {
  const home = tempHome()
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home, MAGPIE_TRANSLATOR_NO_SPAWN: "1" }
  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh" }, env, 20)
  noteCompare({ _compare: { nonce: "n1", entryId: "row-1", translator: "other/model", replace: true }, gatewayKey: "secret-key" }, env)
  noteCompare({ _compare: { nonce: "n1", entryId: "row-1", translator: "other/model", replace: true }, gatewayKey: "secret-key" }, env)
  const queued = jobs(home)
  assert.equal(queued.length, 1)
  assert.equal(queued[0].kind, "compare")
  assert.equal(queued[0].replace, true)
  assert.equal(queued[0].translator, "other/model")
  assert.equal(JSON.stringify(queued[0]).includes("secret-key"), true)
  fs.rmSync(home, { recursive: true, force: true })
})

test("旁路写盘失败时 onResponse 仍然正常返回", async () => {
  const blocker = path.join(os.tmpdir(), `translator-block-${process.pid}`)
  fs.writeFileSync(blocker, "not a directory")
  process.env.MAGPIE_TRANSLATOR_HOME = path.join(blocker, "child")
  process.env.MAGPIE_TRANSLATOR_NO_SPAWN = "1"
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
