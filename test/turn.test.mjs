import "./preload.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { onResponse } from "../src/hooks.mjs"
import { drain } from "../src/worker.mjs"
import { skipReason } from "../src/turn.mjs"

test("纯 JSON、结构化输出、标题请求和没有用户轮次的请求都跳过", () => {
  assert.equal(skipReason({ model: "x" }, '{"suggestion":"你用的是什么模型？"}'), "pure_json")
  assert.equal(skipReason({ model: "x" }, "```json\n{\"title\":\"解释 Raft\"}\n```"), "pure_json")
  assert.equal(skipReason({ model: "x" }, "这是一段正常的回答，不是 JSON。"), "")
  assert.equal(skipReason({
    model: "x",
    text: { format: { type: "json_schema", name: "thread_title" } },
    input: [{ role: "user", content: "hi" }],
  }, "A title"), "structured_output")
  assert.equal(skipReason({
    model: "x",
    metadata: { thread_source: "thread_title" },
    input: [{ role: "user", content: "hi" }],
  }, "hello there friend"), "helper")
  assert.equal(skipReason({
    model: "x",
    instructions: "Generate a short title for this conversation.",
    input: [{ role: "user", content: "hi" }],
  }, "Raft reads"), "helper")
  assert.equal(skipReason({
    model: "x",
    messages: [{ role: "assistant", content: "only the model" }],
  }, "some prose answer"), "no_turn")
  assert.equal(skipReason({ model: "x" }, "some prose answer that is long enough"), "")
})

test("建议 JSON 不会进收件箱，普通回复会", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-skip-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  const options = { models: [], rules: [{ translator: "mock/zh" }] }
  const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "译文" } }] }), {
    headers: { "content-type": "application/json" },
  })
  const suggestion = { choices: [{ message: { content: '{"suggestion":"你用的是什么模型？"}' }, finish_reason: "stop" }] }
  await onResponse(suggestion, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "work/model",
    request: { model: "work/model", messages: [{ role: "user", content: "hi" }] },
    state: {},
    options,
    fetch,
  })
  const prose = { choices: [{ message: { content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
  await onResponse(prose, {
    success: true,
    protocol: "chat",
    agent: "codex",
    model: "work/model",
    request: { model: "work/model", messages: [{ role: "user", content: "hi" }] },
    state: {},
    options,
    fetch,
  })
  await drain(process.env, { fetchImpl: fetch })
  const saved = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
  assert.equal(saved.length, 1)
  assert.match(saved[0].original, /mtime/)
  fs.rmSync(home, { recursive: true, force: true })
})
