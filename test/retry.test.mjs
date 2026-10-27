import assert from "node:assert/strict"
import test from "node:test"
import { translateJob } from "../src/translate.mjs"

test("超时重试一次，400 不重试", async () => {
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
  }, /已重试一次/)
  assert.equal(timeouts, 2)

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
