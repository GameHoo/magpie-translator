import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { MARKER } from "../src/constants.mjs"
import { onRequest, onResponse, runCompare } from "../src/hooks.mjs"
import { publicFeed, recordTranslation } from "../src/history.mjs"
import { systemPrompt } from "../src/prompt.mjs"

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  return home
}

function rows(home) {
  const file = path.join(home, "history.json")
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function okFetch(text = "译文") {
  const impl = async (url, init) => {
    impl.last = { url, init: init || {} }
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      headers: { "content-type": "application/json" },
    })
  }
  return impl
}

const rule = { models: [], rules: [{ agent: "codex", model: "gpt-5.4", translator: "mock/translator" }] }

test("翻译由 onResponse 完成，onRequest 只标自己的请求", async () => {
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
    fetch: okFetch("缓存会失效。"),
  }
  await onRequest(ctx.request, ctx)
  assert.equal(ctx.state.own, false)
  assert.equal(rows(home).length, 0)
  await onResponse(reply, ctx)
  assert.equal(rows(home).length, 1)
  assert.match(rows(home)[0].original, /mtime/)
  assert.equal(rows(home)[0].translation, "缓存会失效。")
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

test("失败、不匹配、工具轮、以及翻译请求自己，都不写历史", async () => {
  const home = tempHome()
  const reply = {
    output: [{ type: "message", phase: "final_answer", content: [{ type: "output_text", text: "The cache invalidates." }] }],
  }
  const base = { options: rule, model: "gpt-5.4", protocol: "responses", request: { model: "gpt-5.4" }, fetch: okFetch() }
  await onResponse({ status: "failed", output: [] }, { ...base, success: false, agent: "codex", state: {} })
  await onResponse(reply, { ...base, success: true, agent: "claude", state: {} })
  await onResponse({
    output: [{ type: "function_call", name: "bash", arguments: "{}", call_id: "c1" }],
  }, { ...base, success: true, agent: "codex", state: {} })
  const own = {
    model: "gpt-5.4",
    messages: [{ role: "system", content: systemPrompt() }, { role: "user", content: "The cache invalidates." }],
  }
  assert.equal(own.messages[0].content.includes(MARKER), true)
  const state = {}
  await onRequest(own, { state, options: rule })
  assert.equal(state.own, true)
  await onResponse(reply, { success: true, options: { models: [], rules: [{ translator: "mock/translator" }] }, agent: "codex", model: "gpt-5.4", protocol: "responses", request: own, state, fetch: okFetch() })
  assert.equal(rows(home).length, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test("onResponse 不改回复对象，历史里留下原文而不是把译文写回", async () => {
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
    fetch: okFetch("缓存会失效。"),
  })
  assert.equal(returned, undefined)
  assert.deepEqual(reply, snapshot)
  const [row] = rows(home)
  assert.equal(row.original, "The cache invalidates when the file mtime changes.")
  assert.equal(row.translation, "缓存会失效。")
  assert.equal(row.translator, "mock/translator")
  assert.equal(row.language, "简体中文")
  const feed = JSON.stringify(publicFeed(rows(home)))
  assert.equal(feed.includes("secret-key"), false)
  assert.equal(feed.includes("masked"), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("success 为 false 但回复里仍有正文时仍然翻译", async () => {
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
    fetch: okFetch("读保持线性一致。"),
  })
  assert.equal(rows(home).length, 1)
  assert.equal(rows(home)[0].status, "done")
  fs.rmSync(home, { recursive: true, force: true })
})

test("原文已经是目标语言时默认跳过，打开改写后仍翻译", async () => {
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
    options: { models: [], language: "简体中文", rules: [{ translator: "mock/zh" }] },
    fetch: okFetch(),
  })
  assert.equal(rows(home).length, 0)
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request,
    state: {},
    options: { models: [], language: "简体中文", rewriteSameLanguage: true, rules: [{ translator: "mock/zh" }] },
    fetch: okFetch("模型名保持原样。"),
  })
  assert.equal(rows(home).length, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test("enabled 为 false 时不翻译", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", messages: [{ role: "user", content: "explain" }] },
    state: {},
    options: { models: [], enabled: false, rules: [{ translator: "mock/zh" }] },
    fetch: okFetch(),
  })
  assert.equal(rows(home).length, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test("对照和重试走 options._compare，同一个 nonce 只跑一次", async () => {
  const home = tempHome()
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home, XDG_CONFIG_HOME: home }
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh", masked: "Hello there from the model.", slots: [] }, env, 20)
  const fetchImpl = okFetch("另一份译文")
  const ctx = {
    options: { ...rule, gatewayKey: "secret-key", _compare: { nonce: "n1", entryId: "row-1", translator: "other/model", replace: true } },
    fetch: fetchImpl,
  }
  assert.equal(await runCompare(ctx, env), true)
  assert.equal(await runCompare(ctx, env), true)
  const [row] = rows(home)
  assert.equal(row.translation, "另一份译文")
  assert.equal(row.status, "done")
  assert.equal(row.comparisons.length, 0)
  const again = {
    options: { ...rule, gatewayKey: "secret-key", _compare: { nonce: "n2", entryId: "row-1", translator: "other/model", replace: false } },
    fetch: okFetch("对比译文"),
  }
  await runCompare(again, env)
  await runCompare(again, env)
  const compared = rows(home)[0]
  assert.equal(compared.comparisons.length, 1)
  assert.equal(compared.comparisons[0].translator, "other/model")
  assert.equal(JSON.stringify(publicFeed(rows(home))).includes("secret-key"), false)
  assert.match(fetchImpl.last.init.headers.authorization, /secret-key/)
  fs.rmSync(home, { recursive: true, force: true })
})

test("旁路写盘失败时 onResponse 仍然正常返回", async () => {
  const blocker = path.join(os.tmpdir(), `translator-block-${process.pid}`)
  fs.writeFileSync(blocker, "not a directory")
  process.env.MAGPIE_TRANSLATOR_HOME = path.join(blocker, "child")
  process.env.XDG_CONFIG_HOME = path.join(blocker, "config")
  const reply = { choices: [{ message: { role: "assistant", content: "Hello from the model." }, finish_reason: "stop" }] }
  await assert.doesNotReject(() => onResponse(reply, {
    success: true,
    options: { models: [], rules: [{ translator: "mock/translator" }] },
    protocol: "chat",
    model: "gpt-5.4",
    request: { model: "gpt-5.4" },
    state: {},
    fetch: okFetch("你好"),
  }))
  fs.rmSync(blocker, { force: true })
})
