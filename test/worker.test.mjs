import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { packageRoot, pluginTurnedOff } from "../src/options.mjs"
import { startPanel } from "../src/panel.mjs"
import { ensureWorker, formatPid, isPanelProcess, parsePid, pidAlive, readPid, workerStamp } from "../src/worker.mjs"

function waitFor(fn, ms = 4000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const look = () => {
      let value
      try { value = fn() } catch (err) {
        if (Date.now() - start > ms) reject(err)
        else setTimeout(look, 20)
        return
      }
      if (value) resolve(value)
      else if (Date.now() - start > ms) reject(new Error("timeout"))
      else setTimeout(look, 20)
    }
    look()
  })
}

function killPid(pid) {
  if (!pid) return
  try { process.kill(pid, "SIGKILL") } catch { /* 已经退出 */ }
}

function workerEnv(home) {
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_DATA_HOME: path.join(home, "data"),
    MAGPIE_TRANSLATOR_HOME: path.join(home, "translator"),
    MAGPIE_TRANSLATOR_UI: path.join(home, "ui"),
    MAGPIE_TRANSLATOR_DISPLAY: "panel",
    MAGPIE_TRANSLATOR_LOCAL: "0",
    MAGPIE_TRANSLATOR_PORT: "0",
    MAGPIE_BIN: path.join(home, "missing-magpie"),
    MAGPIE_TRANSLATOR_NO_SPAWN: "",
  }
}

test("pid 文件带上版本和代码哈希，纯数字的旧文件不算同一份代码", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  const stamp = workerStamp()
  assert.match(stamp, new RegExp(`^${pkg.version}:[0-9a-f]{16}:`))
  assert.equal(stamp.endsWith(packageRoot()), true)
  assert.deepEqual(parsePid(formatPid(42, stamp)), { pid: 42, stamp })
  assert.deepEqual(parsePid("4321\n"), { pid: 4321, stamp: "" })
  assert.equal(parsePid("nope"), null)
  assert.equal(parsePid(""), null)
})

test("版本对不上时重启工人，对得上时留着原来的进程", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-worker-"))
  const env = workerEnv(home)
  const pidfile = path.join(env.MAGPIE_TRANSLATOR_HOME, "panel.pid")
  let first = 0
  let second = 0
  try {
    first = ensureWorker(env, { port: "0", display: "panel", local: "0" })
    await waitFor(() => first && pidAlive(first) && isPanelProcess(first))
    const again = ensureWorker(env, { port: "0", display: "panel", local: "0" })
    assert.equal(again, first)
    fs.writeFileSync(pidfile, formatPid(first, "stale"))
    second = ensureWorker(env, { port: "0", display: "panel", local: "0" })
    await waitFor(() => !pidAlive(first) && second && pidAlive(second) && isPanelProcess(second))
    const rec = readPid(pidfile)
    assert.equal(rec.pid, second)
    assert.equal(rec.stamp, workerStamp())
    assert.notEqual(second, first)
  } finally {
    killPid(first)
    killPid(second)
    killPid(readPid(pidfile)?.pid)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("pid 被别的进程占用时不把那个进程杀掉", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-foreign-"))
  const env = workerEnv(home)
  const pidfile = path.join(env.MAGPIE_TRANSLATOR_HOME, "panel.pid")
  fs.mkdirSync(env.MAGPIE_TRANSLATOR_HOME, { recursive: true })
  fs.writeFileSync(pidfile, formatPid(process.pid, "stale"))
  let spawned = 0
  try {
    spawned = ensureWorker(env, { port: "0", display: "panel", local: "0" })
    await waitFor(() => spawned && pidAlive(spawned) && isPanelProcess(spawned))
    assert.equal(pidAlive(process.pid), true)
    assert.notEqual(spawned, process.pid)
  } finally {
    killPid(spawned)
    killPid(readPid(pidfile)?.pid)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("插件关掉时工人停，开着时不停", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-off-"))
  const config = path.join(home, "config")
  fs.mkdirSync(path.join(config, "magpie"), { recursive: true })
  const plugins = path.join(config, "magpie", "plugins.json")
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: config,
    MAGPIE_TRANSLATOR_HOME: path.join(home, "translator"),
    MAGPIE_TRANSLATOR_UI: "",
    MAGPIE_TRANSLATOR_NO_SPAWN: "1",
  }
  fs.writeFileSync(plugins, JSON.stringify({ plugins: [{ spec: packageRoot(), off: false, options: {} }] }))
  assert.equal(pluginTurnedOff(env), false)
  fs.writeFileSync(plugins, JSON.stringify({ plugins: [{ spec: "/tmp/some-other-plugin", off: true, options: {} }] }))
  assert.equal(pluginTurnedOff(env), false)
  fs.writeFileSync(plugins, JSON.stringify({ plugins: [{ spec: packageRoot(), off: true, options: {} }] }))
  assert.equal(pluginTurnedOff(env), true)
  let stopped = 0
  const off = await startPanel({
    home: env.MAGPIE_TRANSLATOR_HOME,
    port: 0,
    display: ["log"],
    env,
    whenOff: () => { stopped += 1 },
    offInterval: 20,
  })
  assert.equal(stopped, 1)
  await off.close()
  fs.writeFileSync(plugins, JSON.stringify({ plugins: [{ spec: packageRoot(), off: false, options: {} }] }))
  let stayed = 0
  const on = await startPanel({
    home: env.MAGPIE_TRANSLATOR_HOME,
    port: 0,
    display: ["log"],
    env,
    whenOff: () => { stayed += 1 },
    offInterval: 20,
  })
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(stayed, 0)
  await on.close()
  fs.rmSync(home, { recursive: true, force: true })
})

test("工人启动时把日志补进新目录的 feed", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "translator-boot-"))
  const ui = path.join(home, "ui")
  const data = path.join(home, "translator")
  fs.mkdirSync(data, { recursive: true })
  fs.writeFileSync(path.join(data, "log.jsonl"), `${JSON.stringify({
    at: "2026-10-03T00:00:00.000Z",
    agent: "codex",
    model: "gpt-work",
    translator: "mock/zh",
    language: "简体中文",
    ok: true,
    original: "The cache invalidates.",
    translation: "缓存会失效。",
  })}\n`)
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(home, "config"),
    MAGPIE_TRANSLATOR_HOME: data,
    MAGPIE_TRANSLATOR_UI: ui,
    MAGPIE_TRANSLATOR_NO_SPAWN: "1",
  }
  const panel = await startPanel({ home: data, port: 0, display: ["log"], env })
  try {
    const feed = fs.readFileSync(path.join(ui, "feed.js"), "utf8")
    assert.match(feed, /缓存会失效/)
    assert.match(feed, /The cache invalidates/)
    const history = JSON.parse(fs.readFileSync(path.join(data, "history.json"), "utf8"))
    assert.equal(history.length, 1)
    assert.equal(history[0].translation, "缓存会失效。")
  } finally {
    await panel.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
