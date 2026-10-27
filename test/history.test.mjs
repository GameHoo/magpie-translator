import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parseHistoryLimit } from "../src/config.mjs"
import { addComparison, publicEntry, recordTranslation, replaceTranslation } from "../src/history.mjs"
import { startPanel } from "../src/panel.mjs"

test("历史有上限，公开脚本不含密钥，并且把 < 转义", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-hist-"))
  const ui = fs.mkdtempSync(path.join(os.tmpdir(), "translator-ui-"))
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home, MAGPIE_TRANSLATOR_UI: ui }
  recordTranslation({ id: "drop", original: "gone", translation: "没" }, env, 20)
  recordTranslation({
    id: "kept",
    original: "one",
    translation: "一",
    gatewayKey: "secret-gateway-key",
    masked: "masked-one",
    slots: ["slot"],
    magpieBaseUrl: "http://127.0.0.1:9",
    prompt: "secret prompt",
  }, env, 20)
  for (let i = 0; i < 18; i += 1) {
    recordTranslation({ id: `n${i}`, original: "x", translation: "y" }, env, 20)
  }
  recordTranslation({ id: "new", original: "<script>", translation: "三" }, env, 20)
  const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
  assert.equal(rows.length, 20)
  assert.equal(rows[0].id, "new")
  assert.equal(rows.some((row) => row.id === "drop"), false)
  const kept = rows.find((row) => row.id === "kept")
  assert.equal(kept.masked, "masked-one")
  assert.equal(publicEntry(kept).masked, undefined)
  const feed = fs.readFileSync(path.join(ui, "feed.js"), "utf8")
  assert.match(feed, /MAGPIE_TRANSLATOR_FEED/)
  assert.match(feed, /\\u003cscript/)
  assert.equal(feed.includes("<script>"), false)
  assert.equal(feed.includes("secret-gateway-key"), false)
  assert.equal(feed.includes("masked-one"), false)
  assert.equal(feed.includes("secret prompt"), false)
  assert.equal(feed.includes("127.0.0.1:9"), false)
  addComparison("new", { id: "cmp", translator: "other/model", translation: "另译", ms: 12 }, env)
  const again = fs.readFileSync(path.join(ui, "feed.js"), "utf8")
  assert.match(again, /other\/model/)
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(ui, { recursive: true, force: true })
})

test("不保存会清空历史，5000 条是上限", () => {
  assert.equal(parseHistoryLimit(0), 0)
  assert.equal(parseHistoryLimit(5000), 5000)
  assert.equal(parseHistoryLimit(9000), 5000)
  assert.equal(parseHistoryLimit(undefined), 500)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-hist0-"))
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home, MAGPIE_TRANSLATOR_UI: "" }
  recordTranslation({ id: "keep", original: "one", translation: "一" }, env, 20)
  const replaced = replaceTranslation("keep", { translation: "改", error: "", ms: 40 }, env)
  assert.equal(replaced.translation, "改")
  assert.equal(replaced.status, "done")
  assert.equal(recordTranslation({ id: "gone", original: "two", translation: "二" }, env, 0), null)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8")), [])
  fs.rmSync(home, { recursive: true, force: true })
})

test("显式只要日志时，localPanel 仍打开本机页", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-local-"))
  const panel = await startPanel({ home, port: 0, display: ["log"], localPanel: true })
  try {
    assert.equal(panel.host, "127.0.0.1")
    assert.match(panel.url, /^http:\/\/127\.0\.0\.1:/)
  } finally {
    await panel.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
