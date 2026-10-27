import "./preload.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { MARKER } from "../src/constants.mjs"
import { publicFeed, recordTranslation, writePublicFeed } from "../src/history.mjs"
import { onRequest, onResponse } from "../src/hooks.mjs"
import { packageRoot } from "../src/options.mjs"
import { systemPrompt } from "../src/prompt.mjs"
import { listInbox } from "../src/queue.mjs"
import { timeoutFor } from "../src/translate.mjs"
import { drain, processCompare, processOnce } from "../src/worker.mjs"

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

async function settle(fetchImpl) {
  await drain(process.env, { fetchImpl })
}

const rule = { models: [], rules: [{ agent: "codex", model: "gpt-5.4", translator: "mock/translator" }] }

test("翻译由工人完成，onRequest 只标自己的请求", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  const fetchImpl = okFetch("缓存会失效。")
  const ctx = {
    success: true,
    options: rule,
    agent: "codex",
    protocol: "chat",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", messages: [{ role: "user", content: "explain" }] },
    state: {},
    fetch: fetchImpl,
  }
  await onRequest(ctx.request, ctx)
  assert.equal(ctx.state.own, false)
  assert.equal(rows(home).length, 0)
  await onResponse(reply, ctx)
  assert.equal(rows(home).length, 0)
  await settle(fetchImpl)
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
  const fetchImpl = okFetch()
  const base = { options: rule, model: "gpt-5.4", protocol: "responses", request: { model: "gpt-5.4" }, fetch: fetchImpl }
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
  await onResponse(reply, { success: true, options: { models: [], rules: [{ translator: "mock/translator" }] }, agent: "codex", model: "gpt-5.4", protocol: "responses", request: own, state, fetch: fetchImpl })
  await settle(fetchImpl)
  assert.equal(rows(home).length, 0)
  assert.equal(listInbox().length, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test("onResponse 不改回复对象，历史里留下原文而不是把译文写回", async () => {
  const home = tempHome()
  const reply = {
    output: [{ type: "message", phase: "final_answer", content: [{ type: "output_text", text: "The cache invalidates when the file mtime changes." }] }],
  }
  const snapshot = structuredClone(reply)
  const fetchImpl = okFetch("缓存会失效。")
  const returned = await onResponse(reply, {
    success: true,
    options: { ...rule, magpieBaseUrl: "http://127.0.0.1:9", gatewayKey: "secret-key" },
    agent: "codex",
    protocol: "responses",
    model: "gpt-5.4",
    request: { model: "gpt-5.4" },
    state: {},
    fetch: fetchImpl,
  })
  await settle(fetchImpl)
  assert.equal(returned, undefined)
  assert.deepEqual(reply, snapshot)
  const [row] = rows(home)
  assert.equal(row.original, "The cache invalidates when the file mtime changes.")
  assert.equal(row.translation, "缓存会失效。")
  assert.equal(row.translator, "mock/translator")
  assert.equal(row.language, "简体中文")
  assert.equal(row.gatewayKey, undefined)
  assert.equal(fetchImpl.last.init.headers.authorization, undefined)
  const feed = JSON.stringify(publicFeed(rows(home)))
  assert.equal(feed.includes("secret-key"), false)
  assert.equal(feed.includes("masked"), false)
  assert.equal(JSON.parse(feed).at, undefined)
  fs.rmSync(home, { recursive: true, force: true })
})

test("success 为 false 但回复里仍有正文时仍然翻译", async () => {
  const home = tempHome()
  const reply = {
    status: "incomplete",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The read stays linearizable." }] }],
  }
  const fetchImpl = okFetch("读保持线性一致。")
  await onResponse(reply, {
    success: false,
    options: rule,
    agent: "codex",
    protocol: "responses",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", input: [{ role: "user", content: "explain" }] },
    state: {},
    fetch: fetchImpl,
  })
  await settle(fetchImpl)
  assert.equal(rows(home).length, 1)
  assert.equal(rows(home)[0].status, "done")
  fs.rmSync(home, { recursive: true, force: true })
})

test("原文已经是目标语言时默认跳过，打开改写后仍翻译", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "你用的是什么模型？" }, finish_reason: "stop" }] }
  const request = { model: "gpt-5.4", messages: [{ role: "user", content: "问一下" }] }
  const fetchImpl = okFetch("模型名保持原样。")
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request,
    state: {},
    options: { models: [], language: "简体中文", rules: [{ translator: "mock/zh" }] },
    fetch: fetchImpl,
  })
  await settle(fetchImpl)
  assert.equal(rows(home).length, 0)
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request,
    state: {},
    options: { models: [], language: "简体中文", rewriteSameLanguage: true, rules: [{ translator: "mock/zh" }] },
    fetch: fetchImpl,
  })
  await settle(fetchImpl)
  assert.equal(rows(home).length, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test("enabled 为 false 时不翻译", async () => {
  const home = tempHome()
  const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  const fetchImpl = okFetch()
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", messages: [{ role: "user", content: "explain" }] },
    state: {},
    options: { models: [], enabled: false, rules: [{ translator: "mock/zh" }] },
    fetch: fetchImpl,
  })
  await settle(fetchImpl)
  assert.equal(rows(home).length, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test("对照和重试读 options._compare，不改 plugins.json，也不用里面的密钥", async () => {
  const home = tempHome()
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home, XDG_CONFIG_HOME: home, MAGPIE_TRANSLATOR_GATEWAY_KEY: "env-key" }
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  delete process.env.MAGPIE_TRANSLATOR_GATEWAY_KEY
  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh", masked: "Hello there from the model.", slots: [] }, env, 20)
  const configDir = path.join(home, "magpie")
  fs.mkdirSync(configDir, { recursive: true })
  const pluginsPath = path.join(configDir, "plugins.json")
  const pluginsBody = `${JSON.stringify({ plugins: [{ spec: packageRoot(), options: { language: "English", gatewayKey: "secret-key" } }] }, null, 2)}\n`
  fs.writeFileSync(pluginsPath, pluginsBody)
  const fetchImpl = okFetch("另一份译文")
  const options = { ...rule, gatewayKey: "secret-key", _compare: { nonce: "n1", entryId: "row-1", translator: "other/model", replace: true } }
  assert.equal(await processCompare(env, { fetchImpl, options }), true)
  assert.equal(await processCompare(env, { fetchImpl, options }), false)
  assert.equal(fs.readFileSync(pluginsPath, "utf8"), pluginsBody)
  const [row] = rows(home)
  assert.equal(row.translation, "另一份译文")
  assert.equal(row.status, "done")
  assert.equal(row.comparisons.length, 0)
  const again = { ...rule, gatewayKey: "secret-key", _compare: { nonce: "n2", entryId: "row-1", translator: "other/model", replace: false } }
  const second = okFetch("对比译文")
  assert.equal(await processCompare(env, { fetchImpl: second, options: again }), true)
  assert.equal(await processCompare(env, { fetchImpl: second, options: again }), false)
  const compared = rows(home)[0]
  assert.equal(compared.comparisons.length, 1)
  assert.equal(compared.comparisons[0].translator, "other/model")
  assert.equal(JSON.stringify(publicFeed(rows(home))).includes("secret-key"), false)
  assert.equal(JSON.stringify(rows(home)).includes("env-key"), false)
  assert.equal(fetchImpl.last.init.headers.authorization, "Bearer env-key")
  assert.equal(fs.readFileSync(pluginsPath, "utf8"), pluginsBody)
  fs.rmSync(home, { recursive: true, force: true })
})

test("onResponse 马上返回，转述时限按设置而不是 10 秒，并且不写 plugins.json", async () => {
  const home = tempHome()
  const configDir = path.join(home, "magpie")
  fs.mkdirSync(configDir, { recursive: true })
  const pluginsPath = path.join(configDir, "plugins.json")
  const pluginsBody = `${JSON.stringify({ plugins: [{ spec: packageRoot(), options: { language: "English" } }] }, null, 2)}\n`
  fs.writeFileSync(pluginsPath, pluginsBody)
  const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  const originalTimeout = AbortSignal.timeout
  let duringHook = 0
  AbortSignal.timeout = (ms) => {
    duringHook = ms
    return originalTimeout.call(AbortSignal, ms)
  }
  const started = Date.now()
  await onResponse(reply, {
    success: true,
    options: rule,
    agent: "codex",
    protocol: "chat",
    model: "gpt-5.4",
    request: { model: "gpt-5.4", messages: [{ role: "user", content: "explain" }] },
    state: {},
    origin: "local",
  })
  const elapsed = Date.now() - started
  AbortSignal.timeout = originalTimeout
  assert.ok(elapsed < 300)
  assert.equal(duringHook, 0)
  assert.equal(rows(home).length, 0)
  const pending = listInbox()
  assert.equal(pending.length, 1)
  const job = JSON.parse(fs.readFileSync(path.join(home, "inbox", pending[0]), "utf8"))
  assert.equal(job.gatewayKey, undefined)
  assert.equal(timeoutFor(job), 120000)
  let seen = 0
  AbortSignal.timeout = (ms) => {
    seen = ms
    return originalTimeout.call(AbortSignal, ms)
  }
  try {
    await processOnce(process.env, {
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "好" } }] }), {
        headers: { "content-type": "application/json" },
      }),
    })
  } finally {
    AbortSignal.timeout = originalTimeout
  }
  assert.ok(seen >= 120000)
  assert.equal(rows(home)[0].translation, "好")
  assert.equal(fs.readFileSync(pluginsPath, "utf8"), pluginsBody)
  const first = JSON.stringify(publicFeed(rows(home)))
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(JSON.stringify(publicFeed(rows(home))), first)
  assert.equal(JSON.parse(first).at, undefined)
  const feedFile = path.join(home, "feed.json")
  const written = fs.readFileSync(feedFile, "utf8")
  assert.equal(writePublicFeed(process.env), false)
  assert.equal(fs.readFileSync(feedFile, "utf8"), written)
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
