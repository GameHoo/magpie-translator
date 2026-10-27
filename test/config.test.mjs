import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { parseDisplay, presentation } from "../src/config.mjs"
import { MARKER } from "../src/constants.mjs"
import { onResponse } from "../src/hooks.mjs"
import { defaultTask, systemPrompt } from "../src/prompt.mjs"
import { translateJob } from "../src/translate.mjs"

test("默认提示词带上目标语言，自定义提示词换掉任务句", () => {
  const fallback = systemPrompt({ language: "日本語" })
  assert.match(fallback, /Rewrite the user's text into plain, easy-to-read 日本語\./)
  assert.match(fallback, new RegExp(MARKER))
  assert.match(fallback, /⟦0⟧/)
  assert.equal(/[\u4e00-\u9fff]/.test(fallback.replaceAll("日本語", "")), false)

  const custom = systemPrompt({ prompt: "用我的口吻解释", language: "English", style: "短句。" })
  assert.match(custom, /用我的口吻解释/)
  assert.match(custom, /短句。/)
  assert.equal(custom.includes("Rewrite the user's text into plain, easy-to-read English"), false)
  assert.match(custom, new RegExp(MARKER))
  assert.match(custom, /Output only the rewritten text/)
})

test("自定义提示词里的占位符只替换一次", () => {
  const filled = systemPrompt({
    language: "Français",
    prompt: "Rewrite into {language}. Work model {model}. Translator {translator}. Tone {style}. Keep {tone}.",
    style: "short {language}",
    model: "vendor/work",
    translator: "vendor/helper",
  })
  assert.match(filled, /Rewrite into Français\./)
  assert.match(filled, /Work model vendor\/work\./)
  assert.match(filled, /Translator vendor\/helper\./)
  assert.match(filled, /Tone short Français\./)
  assert.match(filled, /Keep \{tone\}\./)
  assert.match(filled, /short Français/)
  assert.equal(filled.includes("{language}"), false)
  assert.equal(filled.includes("{model}"), false)
  assert.match(filled, new RegExp(MARKER))
  assert.match(filled, /Output only the rewritten text/)
  assert.equal(defaultTask("Français"), systemPrompt({ language: "Français" }).split("\n")[1])
})

test("非中文目标语言写进默认提示词，提示本身不含中文", () => {
  const french = systemPrompt({ language: "Français" })
  assert.match(french, /Rewrite the user's text into plain, easy-to-read Français\./)
  assert.equal(/[\u4e00-\u9fff]/.test(french), false)
  assert.match(french, new RegExp(MARKER))
  assert.match(french, /⟦1⟧/)
  assert.match(french, /Output only the rewritten text/)

  const english = systemPrompt({ language: "English" })
  assert.match(english, /easy-to-read English\./)
  assert.equal(english.includes("简体中文"), false)
})

test("展示出口认别名，不认识的名字退回默认", () => {
  assert.deepEqual(parseDisplay("file, notify"), ["file", "notify"])
  assert.deepEqual(parseDisplay(["webhook", "nope", "webhook"]), ["webhook"])
  assert.deepEqual(parseDisplay(undefined), ["log"])
  assert.deepEqual(parseDisplay(["not-a-sink"]), ["log"])
})

test("规则上的语言、提示词、展示和翻译模型盖过全局", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-cfg-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  const reply = { choices: [{ message: { role: "assistant", content: "Hello from any model." }, finish_reason: "stop" }] }
  const options = {
    models: [],
    language: "简体中文",
    prompt: "全局提示",
    display: ["log"],
    webhookUrl: "http://127.0.0.1/global",
    rules: [{
      translator: "plugin-grok/grok-4",
      language: "English",
      prompt: "rule prompt",
      style: "short",
      display: ["file"],
      webhookUrl: "http://127.0.0.1:9/hook",
    }],
  }
  await onResponse(reply, {
    success: true,
    protocol: "chat",
    model: "any-vendor/some-model",
    request: { model: "any-vendor/some-model" },
    state: {},
    options,
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Hello." } }] }), {
      headers: { "content-type": "application/json" },
    }),
  })
  const [job] = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
  assert.equal(job.model, "any-vendor/some-model")
  assert.equal(job.translator, "plugin-grok/grok-4")
  assert.equal(job.language, "English")
  assert.equal(job.prompt, "rule prompt")
  assert.equal(job.style, "short")
  const view = presentation(options, options.rules[0])
  assert.deepEqual(view.display, ["file"])
  assert.equal(view.webhookUrl, "http://127.0.0.1:9/hook")
  assert.equal(presentation({}, {}).language, "简体中文")
  fs.rmSync(home, { recursive: true, force: true })
})

test("翻译请求原样使用配置里的模型 id", async () => {
  let seen
  const text = await translateJob({
    translator: "community/brand-new-model",
    language: "日本語",
    prompt: "",
    masked: "Hello",
    slots: [],
    magpieBaseUrl: "http://127.0.0.1:9",
  }, {
    fetchImpl: async (_url, init) => {
      seen = JSON.parse(init.body)
      return new Response(JSON.stringify({ choices: [{ message: { content: "こんにちは" } }] }), {
        headers: { "content-type": "application/json" },
      })
    },
  })
  assert.equal(seen.model, "community/brand-new-model")
  assert.match(seen.messages[0].content, /日本語/)
  assert.match(seen.messages[0].content, new RegExp(MARKER))
  assert.equal(text, "こんにちは")
})

test("运行时代码不内置厂商模型表", () => {
  const banned = ["deepseek/", "gpt-5", "grok/", "gemini/"]
  for (const file of ["hooks.mjs", "translate.mjs", "match.mjs", "prompt.mjs", "config.mjs", "extract.mjs"]) {
    const text = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")
    for (const word of banned) assert.equal(text.includes(word), false, `${file} 含有 ${word}`)
  }
})

test("日志、文件和 webhook 在 hook 里写完，不另开本机服务", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-sink-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  const hits = []
  const webhook = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      hits.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      res.writeHead(204)
      res.end()
    })
  })
  const translator = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      assert.equal(body.model, "my-relay/whatever-2099")
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ choices: [{ message: { content: "こんにちは" } }] }))
    })
  })
  await new Promise((resolve) => webhook.listen(0, "127.0.0.1", resolve))
  await new Promise((resolve) => translator.listen(0, "127.0.0.1", resolve))
  try {
    await assert.rejects(fetch("http://127.0.0.1:39991/health", { signal: AbortSignal.timeout(400) }))
    await onResponse({
      choices: [{ message: { role: "assistant", content: "Hello there." }, finish_reason: "stop" }],
    }, {
      success: true,
      protocol: "chat",
      agent: "codex",
      model: "any-vendor/some-model",
      request: { model: "any-vendor/some-model", messages: [{ role: "user", content: "hi" }] },
      state: {},
      options: {
        models: [],
        magpieBaseUrl: `http://127.0.0.1:${translator.address().port}`,
        gatewayKey: "secret-gateway-key",
        display: ["log", "file", "webhook"],
        webhookUrl: `http://127.0.0.1:${webhook.address().port}/hook`,
        rules: [{ translator: "my-relay/whatever-2099", language: "日本語" }],
      },
    })
    const row = fs.readFileSync(path.join(home, "log.jsonl"), "utf8")
    assert.match(row, /こんにちは/)
    assert.equal(row.includes("secret-gateway-key"), false)
    assert.match(fs.readFileSync(path.join(home, "latest.txt"), "utf8"), /こんにちは/)
    assert.equal(hits[0].translation, "こんにちは")
    assert.equal(hits[0].language, "日本語")
    assert.equal(JSON.stringify(hits[0]).includes("secret-gateway-key"), false)
    await assert.rejects(fetch("http://127.0.0.1:39991/health", { signal: AbortSignal.timeout(400) }))
  } finally {
    webhook.close()
    translator.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
