import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "bun:test"
import { USER_AGENT, translateJob } from "../src/translate.mjs"

test("超时和 400 都只请求一次", async () => {
  let timeouts = 0
  await assert.rejects(async () => {
    await translateJob({
      translator: "mock/zh",
      language: "简体中文",
      masked: "Hello there.",
      slots: [],
      magpieBaseUrl: "http://127.0.0.1:9",
      translateTimeoutMs: 120000,
    }, {
      fetchImpl: async () => {
        timeouts += 1
        const err = new Error("The operation timed out.")
        err.name = "TimeoutError"
        throw err
      },
    })
  }, (err) => {
    assert.equal(String(err.message).includes("已重试一次"), false)
    return true
  })
  assert.equal(timeouts, 1)

  let denied = 0
  await assert.rejects(async () => {
    await translateJob({
      translator: "mock/zh",
      language: "简体中文",
      masked: "Hello there.",
      slots: [],
      magpieBaseUrl: "http://127.0.0.1:9",
    }, {
      fetchImpl: async () => {
        denied += 1
        return new Response("no", { status: 400 })
      },
    })
  }, (err) => {
    assert.equal(err.status, 400)
    assert.equal(String(err.message).includes("已重试一次"), false)
    return true
  })
  assert.equal(denied, 1)
})

test("请求带上包版本，没有密钥就不送 Authorization", async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  let headers
  const text = await translateJob({
    translator: "mock/zh",
    language: "简体中文",
    original: "Hello there.",
    masked: "Hello there.",
    slots: [],
    magpieBaseUrl: "http://127.0.0.1:9",
    gatewayKey: "",
  }, {
    fetchImpl: async (_url, init) => {
      headers = init.headers
      return new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), {
        headers: { "content-type": "application/json" },
      })
    },
  })
  assert.equal(text, "你好")
  assert.equal(headers["user-agent"], `magpie-translator/${pkg.version}`)
  assert.equal(headers["user-agent"], USER_AGENT)
  assert.equal(headers.authorization, undefined)

  let authed
  await translateJob({
    translator: "mock/zh",
    language: "简体中文",
    original: "Hello there.",
    masked: "Hello there.",
    slots: [],
    magpieBaseUrl: "http://127.0.0.1:9",
    gatewayKey: "from-env",
  }, {
    fetchImpl: async (_url, init) => {
      authed = init.headers.authorization
      return new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }] }), {
        headers: { "content-type": "application/json" },
      })
    },
  })
  assert.equal(authed, "Bearer from-env")
})
