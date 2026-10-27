import "./preload.mjs"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { packageRoot } from "../src/options.mjs"
import { enqueue } from "../src/queue.mjs"
import { recordTranslation } from "../src/history.mjs"
import { alive, ensureWorker } from "../src/worker.mjs"

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "translator-spawn-"))
}

function writePlugins(home, options, extra = {}) {
  const dir = path.join(home, "magpie")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "plugins.json")
  fs.writeFileSync(file, `${JSON.stringify({ plugins: [{ spec: packageRoot(), options, ...extra }] }, null, 2)}\n`)
  return file
}

function useHome(home) {
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  delete process.env.MAGPIE_TRANSLATOR_GATEWAY_KEY
  delete process.env.MAGPIE_TRANSLATOR_PARENT_PID
}

function liveWorkers(home) {
  const pids = []
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue
    let cmd = ""
    try { cmd = fs.readFileSync(`/proc/${name}/cmdline`, "utf8") } catch { continue }
    if (!cmd.includes("worker.mjs")) continue
    let env = ""
    try { env = fs.readFileSync(`/proc/${name}/environ`).toString("utf8") } catch { continue }
    if (env.includes(`MAGPIE_TRANSLATOR_HOME=${home}`)) pids.push(Number(name))
  }
  return pids
}

function killHome(home) {
  for (const pid of liveWorkers(home)) {
    try { process.kill(pid, "SIGTERM") } catch { /* 已经退出 */ }
  }
}

async function waitFor(fn, ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const value = fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  return null
}

function spawnWorker() {
  const prev = process.env.MAGPIE_TRANSLATOR_NO_SPAWN
  delete process.env.MAGPIE_TRANSLATOR_NO_SPAWN
  try {
    return ensureWorker()
  } finally {
    process.env.MAGPIE_TRANSLATOR_NO_SPAWN = prev || "1"
  }
}

test("真实工人进程做完一条任务，第二个 ensureWorker 不再另起进程", async () => {
  const home = tempHome()
  useHome(home)
  const hits = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      hits.push(req.headers.get("authorization"))
      return Response.json({ choices: [{ message: { content: "工人译文" } }] })
    },
  })
  try {
    process.env.SENTINEL_SECRET = "do-not-pass"
    writePlugins(home, { language: "English" })
    enqueue({
      id: "spawn-1",
      at: "2026-10-27T00:00:00.000Z",
      translator: "mock/zh",
      language: "简体中文",
      original: "Hello from the spawned worker.",
      masked: "Hello from the spawned worker.",
      slots: [],
      magpieBaseUrl: `http://127.0.0.1:${server.port}`,
      translateTimeoutMs: 10000,
      historyLimit: 20,
      display: ["log"],
    }, process.env)
    assert.equal(spawnWorker(), true)
    const lock = await waitFor(() => {
      try { return JSON.parse(fs.readFileSync(path.join(home, "worker.lock"), "utf8")) } catch { return null }
    })
    assert.ok(lock?.pid)
    assert.equal(alive(lock.pid), true)
    const environ = fs.readFileSync(`/proc/${lock.pid}/environ`).toString("utf8")
    assert.equal(environ.includes("SENTINEL_SECRET"), false)
    assert.equal(environ.includes("MAGPIE_TRANSLATOR_GATEWAY_KEY"), false)
    assert.match(environ, new RegExp(`MAGPIE_TRANSLATOR_PARENT_PID=${process.pid}`))
    assert.equal(spawnWorker(), false)
    const again = JSON.parse(fs.readFileSync(path.join(home, "worker.lock"), "utf8"))
    assert.equal(again.pid, lock.pid)
    const row = await waitFor(() => {
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
        return rows[0]?.translation === "工人译文" ? rows[0] : null
      } catch { return null }
    })
    assert.equal(row.translation, "工人译文")
    assert.deepEqual(hits, [null])
    const published = await waitFor(() => {
      try {
        const list = JSON.parse(fs.readFileSync(path.join(home, "magpie", "plugins.json"), "utf8"))
        const feed = list.plugins[0].options.feed
        return feed?.entries?.[0]?.translation === "工人译文" ? feed : null
      } catch { return null }
    }, 10000)
    assert.equal(published.entries[0].translation, "工人译文")
    const settled = await waitFor(() => liveWorkers(home).length === 1 ? liveWorkers(home) : null)
    assert.deepEqual(settled, [lock.pid])
  } finally {
    delete process.env.SENTINEL_SECRET
    killHome(home)
    server.stop(true)
    fs.rmSync(home, { recursive: true, force: true })
  }
}, 20000)

test("父进程退出后工人也退出", async () => {
  const home = tempHome()
  writePlugins(home, { language: "English" })
  const ready = path.join(home, "ready")
  const helper = path.join(home, "parent.mjs")
  fs.writeFileSync(helper, `
import fs from "node:fs"
import { ensureWorker } from ${JSON.stringify(path.join(packageRoot(), "src/worker.mjs"))}
ensureWorker()
const deadline = Date.now() + 5000
let pid = 0
while (Date.now() < deadline) {
  try {
    pid = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(home, "worker.lock"))}, "utf8")).pid
    if (pid) break
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 20))
}
fs.writeFileSync(${JSON.stringify(ready)}, String(pid))
await new Promise(() => {})
`)
  const child = spawn(process.execPath, [helper], {
    env: {
      PATH: process.env.PATH || "",
      HOME: home,
      MAGPIE_TRANSLATOR_HOME: home,
      XDG_CONFIG_HOME: home,
    },
    stdio: "ignore",
  })
  try {
    const appeared = await waitFor(() => {
      try { return fs.readFileSync(ready, "utf8").trim() } catch { return "" }
    })
    const pid = Number(appeared)
    assert.ok(pid > 0)
    assert.equal(alive(pid), true)
    child.kill("SIGTERM")
    const gone = await waitFor(() => !alive(pid) && liveWorkers(home).length === 0 ? true : null, 4000)
    assert.equal(gone, true)
  } finally {
    try { child.kill("SIGTERM") } catch { /* 父进程已经退出 */ }
    killHome(home)
    fs.rmSync(home, { recursive: true, force: true })
  }
}, 15000)

test("插件关掉或卸掉时工人退出，不拿走收件箱里的任务", async () => {
  const home = tempHome()
  useHome(home)
  writePlugins(home, { language: "English" }, { off: true })
  enqueue({
    id: "left-behind",
    at: "2026-10-27T00:00:00.000Z",
    translator: "mock/zh",
    original: "This should stay queued.",
    masked: "This should stay queued.",
    slots: [],
    magpieBaseUrl: "http://127.0.0.1:9",
    translateTimeoutMs: 10000,
    historyLimit: 20,
    display: [],
  }, process.env)
  try {
    assert.equal(spawnWorker(), true)
    const started = Date.now()
    let seen = false
    while (Date.now() - started < 4000) {
      if (liveWorkers(home).length > 0) seen = true
      if (seen && liveWorkers(home).length === 0) break
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(seen, true)
    assert.equal(liveWorkers(home).length, 0)
    assert.equal(fs.existsSync(path.join(home, "inbox", "left-behind.json")), true)
    assert.equal(fs.existsSync(path.join(home, "history.json")), false)

    const home2 = tempHome()
    useHome(home2)
    const dir = path.join(home2, "magpie")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "plugins.json"), `${JSON.stringify({ plugins: [{ spec: "/tmp/not-the-translator", options: {} }] })}\n`)
    enqueue({
      id: "uninstalled",
      at: "2026-10-27T00:00:00.000Z",
      translator: "mock/zh",
      original: "Still queued after uninstall.",
      masked: "Still queued after uninstall.",
      slots: [],
      magpieBaseUrl: "http://127.0.0.1:9",
      translateTimeoutMs: 10000,
      historyLimit: 20,
      display: [],
    }, process.env)
    assert.equal(spawnWorker(), true)
    const started2 = Date.now()
    let seen2 = false
    while (Date.now() - started2 < 4000) {
      if (liveWorkers(home2).length > 0) seen2 = true
      if (seen2 && liveWorkers(home2).length === 0) break
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(seen2, true)
    assert.equal(liveWorkers(home2).length, 0)
    assert.equal(fs.existsSync(path.join(home2, "inbox", "uninstalled.json")), true)
    killHome(home2)
    fs.rmSync(home2, { recursive: true, force: true })
  } finally {
    killHome(home)
    fs.rmSync(home, { recursive: true, force: true })
  }
}, 10000)

test("对照由工人直接做，不必再等下一条回复", async () => {
  const home = tempHome()
  useHome(home)
  let calls = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls += 1
      return Response.json({ choices: [{ message: { content: "对比译文" } }] })
    },
  })
  try {
    writePlugins(home, {
      language: "English",
      magpieBaseUrl: `http://127.0.0.1:${server.port}`,
      _compare: { nonce: "spawn-compare", entryId: "row-1", translator: "other/model", replace: false },
    })
    recordTranslation({
      id: "row-1",
      original: "Hello there from the model.",
      translation: "你好",
      translator: "mock/zh",
      masked: "Hello there from the model.",
      slots: [],
    }, process.env, 20)
    assert.equal(spawnWorker(), true)
    const row = await waitFor(() => {
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
        return rows[0]?.comparisons?.length === 1 ? rows[0] : null
      } catch { return null }
    })
    assert.equal(row.comparisons[0].translation, "对比译文")
    assert.equal(calls, 1)
    const seen = JSON.parse(fs.readFileSync(path.join(home, "compare-seen.json"), "utf8"))
    assert.equal(seen.includes("spawn-compare"), true)
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(calls, 1)
  } finally {
    killHome(home)
    server.stop(true)
    fs.rmSync(home, { recursive: true, force: true })
  }
}, 15000)
