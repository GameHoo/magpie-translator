import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { modelsFromGateway, parseModelLines } from "../src/models.mjs"
import { findPlugin, normalizeSettings, readPluginList } from "../src/options.mjs"
import { startPanel } from "../src/panel.mjs"
import { defaultTask } from "../src/prompt.mjs"
import { SETTINGS_PAGE } from "../src/settings-page.mjs"

function request(url, { method = "GET", headers = {}, body = "" } = {}) {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
      headers,
    }, (res) => {
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8")
        let json = null
        try { json = JSON.parse(text) } catch { /* 页面不是 JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    })
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

function seed(configHome, spec) {
  const file = path.join(configHome, "magpie", "plugins.json")
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const list = {
    plugins: [
      {
        spec,
        options: {
          gatewayKey: "secret-gateway-key",
          panelPort: 44721,
          magpieBaseUrl: "http://127.0.0.1:9",
          gatewayTimeoutMs: 2000,
          language: "简体中文",
          display: ["panel", "log"],
          rules: [],
        },
      },
      { spec: "/tmp/other-plugin", off: true, options: { untouched: true } },
    ],
    config: { provider: { keep: true } },
    prefer: { demo: "/tmp/other-plugin" },
  }
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 })
  return file
}

async function openPanel(configHome, spec) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-panel-"))
  const panel = await startPanel({
    home,
    port: 0,
    env: { XDG_CONFIG_HOME: configHome, MAGPIE_TRANSLATOR_PLUGIN: spec },
    listModels: async () => ({ source: "test", models: ["mock/listed"], error: "" }),
  })
  return { panel, home }
}

test("模型列表认网关 JSON，也认 magpie models 的文本行", () => {
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

test("保存只改这一份 options，并拒绝没带令牌或跨站的请求", async () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "translator-cfg-"))
  const spec = "/opt/magpie-translator"
  const file = seed(configHome, spec)
  const { panel, home } = await openPanel(configHome, spec)
  try {
    assert.equal(panel.host, "127.0.0.1")
    const page = await request(`${panel.url}/`)
    assert.equal(page.status, 200)
    assert.match(page.text, /不写进下一轮/)
    assert.match(page.text, /href="\/settings"/)
    const settings = await request(`${panel.url}/settings`)
    assert.match(settings.text, /恢复默认/)
    assert.match(settings.text, /\{language\}/)
    assert.match(settings.text, /\{style\}/)
    assert.match(settings.text, /\{model\}/)
    assert.match(settings.text, /\{translator\}/)
    assert.match(settings.text, /127\.0\.0\.1/)
    assert.equal(settings.text.includes(defaultTask("简体中文").slice(0, 24)), true)
    assert.equal(settings.headers["access-control-allow-origin"], undefined)

    const loaded = await request(`${panel.url}/api/settings`)
    assert.equal(loaded.status, 200)
    assert.equal(loaded.json.found, true)
    assert.equal(loaded.json.spec, spec)
    assert.equal(JSON.stringify(loaded.json).includes("secret-gateway-key"), false)
    assert.ok(loaded.json.preserved.includes("gatewayKey"))
    const token = loaded.json.csrf
    const models = await request(`${panel.url}/api/models`)
    assert.deepEqual(models.json.models, ["mock/listed"])
    assert.equal(JSON.stringify(models.json).includes("secret-gateway-key"), false)

    const next = {
      language: "English",
      prompt: "Rewrite into {language}.",
      style: "short {language}",
      display: ["panel", "log"],
      webhookUrl: "",
      gatewayKey: "stolen",
      panelPort: 1,
      rules: [
        { agent: "codex", model: "work-*", translator: "hand/typed-model", language: "日本語", prompt: "规则 {language}", style: "", display: ["file"] },
        { model: "", translator: "mock/listed", prompt: "" },
      ],
    }
    const headers = {
      "content-type": "application/json",
      "x-magpie-translator-csrf": token,
      origin: panel.url,
    }
    const saved = await request(`${panel.url}/api/settings`, { method: "POST", headers, body: JSON.stringify(next) })
    assert.equal(saved.status, 200, saved.text)
    assert.equal(saved.json.changed, true)
    assert.equal(saved.json.options.prompt, "Rewrite into {language}.")
    assert.equal(saved.json.options.rules[0].translator, "hand/typed-model")
    assert.equal(saved.json.options.rules[0].language, "日本語")
    assert.equal(saved.json.options.rules[1].translator, "mock/listed")
    assert.equal(JSON.stringify(saved.json).includes("secret-gateway-key"), false)
    assert.equal(JSON.stringify(saved.json).includes("stolen"), false)

    const stored = JSON.parse(fs.readFileSync(file, "utf8"))
    assert.equal(stored.plugins[0].options.gatewayKey, "secret-gateway-key")
    assert.equal(stored.plugins[0].options.panelPort, 44721)
    assert.equal(stored.plugins[0].options.magpieBaseUrl, "http://127.0.0.1:9")
    assert.equal(stored.plugins[0].options.gatewayTimeoutMs, 2000)
    assert.equal(stored.plugins[0].options.language, "English")
    assert.equal(stored.plugins[0].options.rules[0].translator, "hand/typed-model")
    assert.deepEqual(stored.plugins[0].options.rules[0].display, ["file"])
    assert.equal(stored.plugins[1].options.untouched, true)
    assert.equal(stored.plugins[1].off, true)
    assert.equal(stored.config.provider.keep, true)
    assert.equal(stored.prefer.demo, "/tmp/other-plugin")
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)

    const again = await request(`${panel.url}/api/settings`, { method: "POST", headers, body: JSON.stringify(saved.json.options) })
    assert.equal(again.status, 200)
    assert.equal(again.json.changed, false)

    const before = fs.readFileSync(file, "utf8")
    const blocked = [
      [{}, "missing token"],
      [{ "x-magpie-translator-csrf": token, origin: "http://evil.example" }, "evil origin"],
      [{ "x-magpie-translator-csrf": token, referer: "http://evil.example/x" }, "evil referer"],
      [{ "x-magpie-translator-csrf": token, "sec-fetch-site": "cross-site" }, "cross site"],
      [{ "x-magpie-translator-csrf": "0".repeat(token.length) }, "wrong token"],
    ]
    for (const [extra, label] of blocked) {
      const res = await request(`${panel.url}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json", ...extra },
        body: JSON.stringify({ ...next, language: "Deutsch" }),
      })
      assert.equal(res.status, 403, label)
      assert.equal(res.headers["access-control-allow-origin"], undefined, label)
      assert.equal(res.json.error, "forbidden")
    }
    const wrongHost = await request(`${panel.url}/api/settings`, {
      method: "POST",
      headers: { ...headers, host: `evil.example:${panel.port}` },
      body: JSON.stringify({ ...next, language: "Deutsch" }),
    })
    assert.equal(wrongHost.status, 403)
    const wrongType = await request(`${panel.url}/api/settings`, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: JSON.stringify(next),
    })
    assert.equal(wrongType.status, 415)
    const optionsReq = await request(`${panel.url}/api/settings`, { method: "OPTIONS" })
    assert.equal(optionsReq.status, 403)
    assert.equal(optionsReq.headers["access-control-allow-origin"], undefined)
    assert.equal(fs.readFileSync(file, "utf8"), before)

    const invalid = await request(`${panel.url}/api/settings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...next, rules: [{ translator: "" }] }),
    })
    assert.equal(invalid.status, 400)
    assert.match(invalid.json.error, /翻译模型/)
    assert.equal(fs.readFileSync(file, "utf8"), before)

    const removed = await request(`${panel.url}/api/settings`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...next, prompt: "", rules: [next.rules[1]] }),
    })
    assert.equal(removed.status, 200)
    const after = JSON.parse(fs.readFileSync(file, "utf8"))
    assert.equal(after.plugins[0].options.prompt, undefined)
    assert.equal(after.plugins[0].options.rules.length, 1)
    assert.equal(after.plugins[0].options.rules[0].translator, "mock/listed")
    assert.equal(after.plugins[0].options.gatewayKey, "secret-gateway-key")
  } finally {
    await panel.close()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(configHome, { recursive: true, force: true })
  }
})

test("没有 plugins.json 时设置页说明要先安装，并且不创建文件", async () => {
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "translator-empty-"))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-panel-"))
  const panel = await startPanel({
    home,
    port: 0,
    env: { XDG_CONFIG_HOME: configHome },
    listModels: async () => ({ source: "test", models: [], error: "" }),
  })
  try {
    const loaded = await request(`${panel.url}/api/settings`)
    assert.equal(loaded.json.found, false)
    assert.match(loaded.json.error, /plugin add/)
    const saved = await request(`${panel.url}/api/settings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-magpie-translator-csrf": loaded.json.csrf,
      },
      body: JSON.stringify({ language: "English", display: ["log"], rules: [] }),
    })
    assert.equal(saved.status, 404)
    assert.equal(fs.existsSync(path.join(configHome, "magpie", "plugins.json")), false)
  } finally {
    await panel.close()
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(configHome, { recursive: true, force: true })
  }
})

test("过长提示词在写入前被拒绝", () => {
  const result = normalizeSettings({
    language: "English",
    prompt: "x".repeat(4001),
    display: ["panel"],
    rules: [],
  }, { gatewayKey: "keep" })
  assert.match(result.error, /4000/)
  assert.equal(result.options, undefined)
})

test("设置页默认任务句和代码里的是同一句", () => {
  assert.match(SETTINGS_PAGE, /Rewrite the user's text into plain, easy-to-read " \+ lang \+ "/)
  assert.equal(defaultTask("English"), "Rewrite the user's text into plain, easy-to-read English. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.")
})
