import assert from "node:assert/strict"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { onResponse } from "../src/hooks.mjs"
import { startPanel } from "../src/panel.mjs"

function listen(status, body) {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

test("翻译失败时面板留下原文和错误，不抛回调用方", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plain-zh-fail-"))
  process.env.MAGPIE_PLAIN_ZH_HOME = home
  process.env.MAGPIE_PLAIN_ZH_NO_SPAWN = "1"
  const mock = await listen(500, JSON.stringify({ error: { message: "upstream down" } }))
  const panel = await startPanel({ home, port: 0 })
  try {
    const reply = { choices: [{ message: { role: "assistant", content: "The cache invalidates when the file mtime changes." }, finish_reason: "stop" }] }
    await onResponse(reply, {
      success: true,
      protocol: "chat",
      agent: "codex",
      model: "gpt-5.4",
      request: { model: "gpt-5.4" },
      state: {},
      options: {
        magpieBaseUrl: mock.url,
        rules: [{ model: "gpt-5.4", translator: "mock/translator-zh" }],
      },
    })
    let item
    const start = Date.now()
    while (Date.now() - start < 4000) {
      const body = await (await fetch(`${panel.url}/api/items`)).json()
      item = body.items[0]
      if (item?.status === "error") break
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    assert.equal(item.status, "error")
    assert.match(item.error, /HTTP 500/)
    assert.match(item.original, /mtime/)
    assert.equal(item.translation, "")
    const latest = await (await fetch(`${panel.url}/latest.txt`)).text()
    assert.match(latest, /转述失败/)
    assert.match(latest, /mtime/)
    const health = await (await fetch(`${panel.url}/health`)).json()
    assert.equal(health.name, "magpie-plain-zh")
    const page = await (await fetch(`${panel.url}/`)).text()
    assert.match(page, /不写进下一轮/)
  } finally {
    await panel.close()
    await mock.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
