import "./preload.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { gatewayKeyPath } from "../src/auth.mjs"
import { FEED_BUDGET, hasSeen, markSeen, publicFeed, recordTranslation, writePublicFeed } from "../src/history.mjs"
import { packageRoot, syncHostSurface } from "../src/options.mjs"
import { enqueue, processingDir, recoverProcessing } from "../src/queue.mjs"
import { minimalEnv } from "../src/worker.mjs"
import { alive, processCompare, processOnce } from "../src/worker.mjs"

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-durable-"))
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  delete process.env.MAGPIE_TRANSLATOR_GATEWAY_KEY
  delete process.env.MAGPIE_TRANSLATOR_PARENT_PID
  return home
}

function writePlugins(home, options) {
  const dir = path.join(home, "magpie")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "plugins.json")
  fs.writeFileSync(file, `${JSON.stringify({ plugins: [{ spec: packageRoot(), options }] }, null, 2)}\n`)
  return file
}

function pluginsText(file) {
  return fs.readFileSync(file, "utf8")
}

function fileId(file) {
  return fs.statSync(file).ino
}

function okFetch(text = "译文") {
  const impl = async (url, init) => {
    impl.calls += 1
    impl.last = { url, init: init || {} }
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      headers: { "content-type": "application/json" },
    })
  }
  impl.calls = 0
  return impl
}

function job(extra = {}) {
  return {
    id: "job-1",
    at: "2026-10-27T00:00:00.000Z",
    translator: "mock/zh",
    language: "简体中文",
    original: "Hello there from the model.",
    masked: "Hello there from the model.",
    slots: [],
    magpieBaseUrl: "http://127.0.0.1:9",
    translateTimeoutMs: 10000,
    historyLimit: 20,
    display: ["log"],
    ...extra,
  }
}

test("历史、seen 和 feed 用临时文件换名，写完不留 tmp", () => {
  const home = tempHome()
  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh" }, process.env, 20)
  markSeen("nonce-1", process.env)
  assert.equal(writePublicFeed(process.env), true)
  assert.equal(writePublicFeed(process.env), false)
  const names = fs.readdirSync(home)
  assert.equal(names.some((name) => name.includes(".tmp")), false)
  assert.equal(hasSeen("nonce-1", process.env), true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "feed.json"), "utf8")).at, undefined)
  fs.rmSync(home, { recursive: true, force: true })
})

test("崩溃留下的 processing 任务会在下一轮做完，对照只在成功后记 seen", async () => {
  const home = tempHome()
  const dir = processingDir(process.env)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "job-1.json"), `${JSON.stringify({ ...job(), ownerPid: 1 })}\n`)
  const fetchImpl = okFetch("缓存会失效。")
  assert.equal(await processOnce(process.env, { fetchImpl }), true)
  const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
  assert.equal(rows[0].translation, "缓存会失效。")
  assert.equal(rows[0].ownerPid, undefined)
  assert.equal(fs.existsSync(path.join(dir, "job-1.json")), false)
  assert.equal(fetchImpl.last.init.headers.authorization, undefined)

  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh", masked: "Hello there from the model.", slots: [] }, process.env, 20)
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let calls = 0
  const hanging = async () => {
    calls += 1
    await gate
    return new Response(JSON.stringify({ choices: [{ message: { content: "另一份" } }] }), {
      headers: { "content-type": "application/json" },
    })
  }
  const options = { language: "English", _compare: { nonce: "once", entryId: "row-1", translator: "other/model", replace: false } }
  const first = processCompare(process.env, { fetchImpl: hanging, options })
  const started = Date.now()
  while (calls < 1 && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(calls, 1)
  const second = await processCompare(process.env, { fetchImpl: hanging, options })
  assert.equal(second, false)
  assert.equal(calls, 1)
  assert.equal(hasSeen("once", process.env), false)
  release()
  assert.equal(await first, true)
  assert.equal(hasSeen("once", process.env), true)
  assert.equal(calls, 1)
  const compared = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))[0]
  assert.equal(compared.comparisons.length, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test("模型报错也算做完，死掉的对照认领会再跑一次", async () => {
  const home = tempHome()
  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh", masked: "Hello there from the model.", slots: [] }, process.env, 20)
  const fetchImpl = async (url, init) => {
    fetchImpl.calls += 1
    fetchImpl.last = { url, init }
    return new Response("no", { status: 401 })
  }
  fetchImpl.calls = 0
  const options = { language: "English", _compare: { nonce: "auth", entryId: "row-1", translator: "other/model", replace: true } }
  assert.equal(await processCompare(process.env, { fetchImpl, options }), true)
  assert.equal(await processCompare(process.env, { fetchImpl, options }), false)
  assert.equal(fetchImpl.calls, 1)
  const row = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))[0]
  assert.match(row.error, /HTTP 401/)
  assert.equal(hasSeen("auth", process.env), true)

  const crashed = path.join(processingDir(process.env), "compare-dead.json")
  fs.mkdirSync(path.dirname(crashed), { recursive: true })
  fs.writeFileSync(crashed, `${JSON.stringify({ nonce: "other", pid: 1 })}\n`)
  assert.equal(recoverProcessing(process.env) >= 0, true)
  assert.equal(fs.existsSync(crashed), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("摘要只在变化后写入 plugins.json，相同内容不改 mtime", () => {
  const home = tempHome()
  const file = writePlugins(home, { language: "English" })
  const before = fileId(file)
  const skipped = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 0, now: 1000 })
  assert.equal(skipped.wrote, false)
  assert.equal(skipped.reason, "empty")
  assert.equal(fileId(file), before)

  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh", at: "2026-10-27T00:00:00.000Z" }, process.env, 20)
  const waiting = syncHostSurface(process.env, { debounceMs: 3000, minIntervalMs: 15000, now: 5000 })
  assert.equal(waiting.reason, "debounce")
  assert.equal(fileId(file), before)

  const first = syncHostSurface(process.env, { debounceMs: 3000, minIntervalMs: 15000, now: 8000 })
  assert.equal(first.wrote, true)
  assert.equal(first.reason, "feed")
  assert.ok(first.bytes <= FEED_BUDGET + 32)
  const body = pluginsText(file)
  assert.match(body, /你好/)
  const stamped = fileId(file)
  assert.notEqual(stamped, before)

  const again = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 0, now: 9000 })
  assert.equal(again.reason, "unchanged")
  assert.equal(pluginsText(file), body)
  assert.equal(fileId(file), stamped)

  recordTranslation({ id: "row-2", original: "Second sentence from the model.", translation: "第二句", translator: "mock/zh", at: "2026-10-27T00:00:01.000Z" }, process.env, 20)
  const limited = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 15000, now: 10000 })
  assert.equal(limited.reason, "rate")
  assert.equal(pluginsText(file), body)
  assert.equal(fileId(file), stamped)
  const later = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 15000, now: 8000 + 15000 })
  assert.equal(later.wrote, true)
  assert.match(pluginsText(file), /第二句/)
  fs.rmSync(home, { recursive: true, force: true })
})

test("超长历史的公开摘要有大小上限", () => {
  const home = tempHome()
  const file = writePlugins(home, { language: "English" })
  recordTranslation({
    id: "huge",
    original: "A".repeat(80000),
    translation: "乙".repeat(80000),
    translator: "mock/zh",
    at: "2026-10-27T00:00:00.000Z",
  }, process.env, 20)
  const published = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 0, now: 1000 })
  assert.equal(published.wrote, true)
  const list = JSON.parse(pluginsText(file))
  const feed = list.plugins[0].options.feed
  assert.ok(JSON.stringify(feed).length <= FEED_BUDGET + 64)
  assert.equal(JSON.stringify(publicFeed([])).includes("gatewayKey"), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("网关密钥写到数据目录，401 会出现在摘要里", async () => {
  const home = tempHome()
  const file = writePlugins(home, { language: "English", gatewayKey: "from-options" })
  const moved = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 0, now: 1000 })
  assert.equal(moved.reason, "key")
  assert.equal(pluginsText(file).includes("from-options"), false)
  assert.equal(pluginsText(file).includes("gatewayKey"), false)
  assert.equal(fs.readFileSync(gatewayKeyPath(process.env), "utf8").trim(), "from-options")
  assert.equal(fs.statSync(gatewayKeyPath(process.env)).mode & 0o777, 0o600)
  fs.writeFileSync(gatewayKeyPath(process.env), "from-file\n", { mode: 0o600 })
  enqueue(job(), process.env)
  const fetchImpl = async (_url, init) => {
    fetchImpl.authorization = init.headers.authorization
    return new Response("denied", { status: 401 })
  }
  assert.equal(await processOnce(process.env, { fetchImpl }), true)
  assert.equal(fetchImpl.authorization, "Bearer from-file")
  const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
  assert.match(rows[0].error, /HTTP 401/)
  assert.equal(JSON.stringify(rows).includes("from-file"), false)
  const published = syncHostSurface(process.env, { debounceMs: 0, minIntervalMs: 0, now: 5000 })
  assert.equal(published.wrote, true)
  assert.match(pluginsText(file), /HTTP 401/)
  assert.equal(pluginsText(file).includes("from-file"), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("工人环境只留下路径和父进程号", () => {
  const home = tempHome()
  const env = minimalEnv({
    PATH: "/usr/bin",
    HOME: home,
    XDG_CONFIG_HOME: home,
    MAGPIE_TRANSLATOR_GATEWAY_KEY: "secret-key",
    SENTINEL_SECRET: "nope",
    MAGPIE_TRANSLATOR_NO_SPAWN: "1",
  }, home)
  assert.equal(env.PATH, "/usr/bin")
  assert.equal(env.HOME, home)
  assert.equal(env.XDG_CONFIG_HOME, home)
  assert.equal(env.MAGPIE_TRANSLATOR_HOME, home)
  assert.equal(env.MAGPIE_TRANSLATOR_PARENT_PID, String(process.pid))
  assert.equal(env.MAGPIE_TRANSLATOR_GATEWAY_KEY, undefined)
  assert.equal(env.SENTINEL_SECRET, undefined)
  assert.equal(env.MAGPIE_TRANSLATOR_NO_SPAWN, undefined)
  assert.equal(alive(process.pid), true)
  fs.rmSync(home, { recursive: true, force: true })
})
