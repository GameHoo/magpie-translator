import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { modelsFromGateway, parseModelLines } from "../src/models.mjs"
import { findPlugin, normalizeSettings, readPluginList } from "../src/options.mjs"
import { DEFAULT_TASK_TEMPLATE, defaultTask } from "../src/prompt.mjs"

test("模型列表认网关 JSON，也认文本行", () => {
  assert.deepEqual(modelsFromGateway({ data: [{ id: "mock/listed" }, { id: "nope" }, { id: "mock/listed" }] }), ["mock/listed"])
  const lines = parseModelLines("no models yet\nmock/listed    why\nmock/other\n")
  assert.deepEqual(lines, ["mock/listed", "mock/other"])
})

test("路径安装和 github 安装都能对上 plugins.json 里的 spec", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "translator-spec-"))
  const configHome = path.join(root, "config")
  const pkg = path.join(configHome, "magpie", "plugins", "node_modules", "magpie-translator")
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(configHome, "magpie", "plugins", "package.json"), JSON.stringify({
    dependencies: { "magpie-translator": "github:GameHoo/magpie-translator" },
  }))
  const file = path.join(configHome, "magpie", "plugins.json")
  const checkout = path.join(root, "checkout")
  fs.mkdirSync(checkout)
  fs.writeFileSync(file, JSON.stringify({
    plugins: [
      { spec: "github:GameHoo/magpie-translator", options: { language: "Français" } },
      { spec: checkout, options: { language: "English" } },
    ],
  }))
  const env = { XDG_CONFIG_HOME: configHome }
  const { list } = readPluginList(env)
  assert.equal(findPlugin(list, env, { root: pkg }).spec, "github:GameHoo/magpie-translator")
  assert.equal(findPlugin(list, env, { root: checkout }).options.language, "English")
  assert.equal(findPlugin(list, env, { spec: "github:GameHoo/magpie-translator" }).options.language, "Français")
  fs.rmSync(root, { recursive: true, force: true })
})

test("保存删掉本机面板字段，并保留 gateway key", () => {
  const result = normalizeSettings({
    language: "English",
    prompt: "",
    display: ["log"],
    rules: [{ translator: "mock/zh" }],
    localPanel: true,
    panelPort: 44721,
  }, { gatewayKey: "keep", feed: { entries: [] } })
  assert.equal(result.error, undefined)
  assert.equal(result.options.gatewayKey, "keep")
  assert.equal(result.options.localPanel, undefined)
  assert.equal(result.options.panelPort, undefined)
  assert.deepEqual(result.options.feed, { entries: [] })
})

test("过长提示词在写入前被拒绝", () => {
  const result = normalizeSettings({
    language: "English",
    prompt: "x".repeat(4001),
    display: ["log"],
    rules: [],
  }, { gatewayKey: "keep" })
  assert.match(result.error, /4000/)
  assert.equal(result.options, undefined)
})

test("设置页默认任务句和代码里的是同一句", () => {
  assert.equal(defaultTask("English"), "Rewrite the user's text into plain, easy-to-read English. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.")
  assert.equal(defaultTask("English"), DEFAULT_TASK_TEMPLATE.replaceAll("{language}", "English"))
  const app = fs.readFileSync(new URL("../page/app.js", import.meta.url), "utf8")
  assert.equal(app.includes(DEFAULT_TASK_TEMPLATE), true)
  assert.equal(app.includes("你是 {translator}"), false)
})
