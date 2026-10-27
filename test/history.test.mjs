import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { parseHistoryLimit } from "../src/config.mjs"
import { addComparison, publicEntry, publicFeed, recordTranslation, replaceTranslation, restoreFeed } from "../src/history.mjs"

test("历史有上限，公开 feed 不含密钥", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-hist-"))
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home }
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
  const feed = JSON.stringify(publicFeed(rows))
  assert.equal(feed.includes("secret-gateway-key"), false)
  assert.equal(feed.includes("masked-one"), false)
  assert.equal(feed.includes("secret prompt"), false)
  assert.equal(feed.includes("127.0.0.1:9"), false)
  assert.match(feed, /<script>/)
  addComparison("new", { id: "cmp", translator: "other/model", translation: "另译", ms: 12 }, env)
  const again = JSON.stringify(publicFeed(JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))))
  assert.match(again, /other\/model/)
  fs.rmSync(home, { recursive: true, force: true })
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

test("log.jsonl 里更早的行会补进 feed，已有历史不重复", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-backfill-"))
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home }
  const lines = []
  for (let i = 0; i < 21; i += 1) {
    lines.push(JSON.stringify({
      at: `2026-10-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      agent: "codex",
      model: "gpt-work",
      translator: "mock/zh",
      language: "简体中文",
      ok: i !== 3,
      original: `original ${i}`,
      translation: i === 3 ? "" : `译文 ${i}`,
      error: i === 3 ? "upstream down" : "",
    }))
  }
  lines.splice(5, 0, "not json")
  fs.writeFileSync(path.join(home, "log.jsonl"), `${lines.join("\n")}\n`)
  recordTranslation({
    id: "already",
    at: "2026-10-01T00:00:05.000Z",
    original: "original 5",
    translation: "译文 5",
    translator: "mock/zh",
    prompt: "secret prompt",
  }, env, 40)
  const rows = restoreFeed(env, 20)
  assert.equal(rows.length, 20)
  assert.equal(rows.some((row) => row.original === "original 0"), false)
  const kept = rows.find((row) => row.original === "original 5")
  assert.equal(kept.id, "already")
  assert.equal(kept.prompt, "secret prompt")
  const failed = rows.find((row) => row.original === "original 3")
  assert.equal(failed.status, "error")
  assert.equal(failed.error, "upstream down")
  const feed = JSON.stringify(publicFeed(rows))
  assert.match(feed, /译文 20/)
  assert.equal(feed.includes("secret prompt"), false)
  assert.equal(feed.includes("original 0"), false)
  const again = restoreFeed(env, 20)
  assert.equal(again.length, 20)
  assert.equal(again.filter((row) => row.original === "original 5").length, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test("不保存时不从日志把历史补回来", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-backfill0-"))
  const env = { ...process.env, MAGPIE_TRANSLATOR_HOME: home, MAGPIE_TRANSLATOR_UI: "" }
  fs.writeFileSync(path.join(home, "log.jsonl"), `${JSON.stringify({ at: "2026-10-02T00:00:00.000Z", ok: true, original: "stay out", translation: "不进" })}\n`)
  const rows = restoreFeed(env, 0)
  assert.deepEqual(rows, [])
  assert.equal(fs.existsSync(path.join(home, "history.json")), false)
  fs.rmSync(home, { recursive: true, force: true })
})
