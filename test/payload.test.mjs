import assert from "node:assert/strict"
import fs from "node:fs"
import vm from "node:vm"
import { test } from "bun:test"

function load() {
  const context = { window: {}, TextEncoder }
  vm.createContext(context)
  vm.runInContext(fs.readFileSync(new URL("../page/payload.js", import.meta.url), "utf8"), context)
  return context.window.translatorPageOptions
}

test("提交 options 时丢掉 feed，按字节拒绝超过 60KiB 的内容", () => {
  const pageOptions = load()
  const current = {
    language: "English",
    gatewayKey: "secret-key",
    feed: { entries: [{ original: "x".repeat(70000) }] },
    models: ["a/b"],
    localPanel: true,
    _compare: { nonce: "old" },
  }
  const saved = pageOptions(current, { language: "日本語" })
  assert.equal(saved.error, undefined)
  assert.equal(saved.options.feed, undefined)
  assert.equal(saved.options.gatewayKey, undefined)
  assert.equal(saved.options.models, undefined)
  assert.equal(saved.options.localPanel, undefined)
  assert.equal(saved.options._compare, undefined)
  assert.equal(saved.options.language, "日本語")
  assert.ok(saved.bytes < 60 * 1024)

  const cjk = "你".repeat(40000)
  assert.ok(cjk.length < 64 * 1024)
  const over = pageOptions({ language: "English" }, { prompt: cjk })
  assert.ok(over.bytes > 60 * 1024)
  assert.match(over.error, /64KiB/)
  assert.equal(over.options, undefined)

  const job = pageOptions(current, null, { nonce: "n", entryId: "e", translator: "m/x", replace: false })
  assert.equal(job.options.feed, undefined)
  assert.equal(JSON.stringify(job.options).includes("secret-key"), false)
  assert.deepEqual(job.options._compare, { nonce: "n", entryId: "e", translator: "m/x", replace: false })
  assert.ok(job.bytes < 60 * 1024)
})
