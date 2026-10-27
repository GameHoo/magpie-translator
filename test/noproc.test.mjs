import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"

const root = path.join(import.meta.dir, "..")
const preload = path.join(import.meta.dir, "noproc-preload.mjs")
const { acquireWorkerLock, alive, ensureWorker, parentGone, workerLaunch } = await import("../src/worker.mjs")
const { packageRoot } = await import("../src/options.mjs")
const { processingDir, recoverProcessing } = await import("../src/queue.mjs")
const { beatIsStale } = await import("../src/proc.mjs")

function macHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "Users-"))
  return path.join(home, "Library", "Application Support", "magpie-translator")
}

test("产品代码不读 proc 文件系统，父进程只用 kill 0 判断", async () => {
  for (const name of ["worker.mjs", "queue.mjs", "proc.mjs", "history.mjs", "options.mjs"]) {
    const text = fs.readFileSync(path.join(root, "src", name), "utf8")
    assert.doesNotMatch(text, /\/proc(?:\/|["'])/, name)
  }
  assert.equal(parentGone({ MAGPIE_TRANSLATOR_PARENT_PID: "999999" }), true)
  assert.equal(parentGone({ MAGPIE_TRANSLATOR_PARENT_PID: String(process.pid) }), false)
  assert.equal(alive(process.pid), true)
  const child = spawn(process.execPath, ["--preload", preload, "-e", "process.kill(process.pid, 'SIGTERM')"], { stdio: "ignore" })
  const code = await new Promise((resolve) => child.on("exit", resolve))
  assert.notEqual(code, 0)
})

test("没有 /proc 时三个人抢过期锁，心跳还新的认领不会被拿走", async () => {
  const home = macHome()
  fs.mkdirSync(home, { recursive: true })
  const sleeper = spawn("sleep", ["30"], { stdio: "ignore" })
  fs.writeFileSync(path.join(home, "worker.lock"), `${JSON.stringify({
    pid: sleeper.pid,
    token: "stale",
    heartbeat: 1,
    hash: "old",
    parent: 1,
  })}\n`)
  const helper = path.join(home, "race.mjs")
  const lockFile = path.join(home, "worker.lock")
  fs.writeFileSync(helper, `
import fs from "node:fs"
import { acquireWorkerLock } from ${JSON.stringify(path.join(packageRoot(), "src/worker.mjs"))}
const ok = await acquireWorkerLock(${JSON.stringify(home)}, "hash-race", ${process.pid})
let held = false
if (ok) {
  try {
    held = JSON.parse(fs.readFileSync(${JSON.stringify(lockFile)}, "utf8")).token === process.env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  } catch {}
}
fs.writeFileSync(process.env.RACE_OUT, held ? "yes" : "no")
await new Promise(() => {})
`)
  const tokens = ["mac-a", "mac-b", "mac-c"]
  const children = tokens.map((token, index) => spawn(process.execPath, ["--preload", preload, helper], {
    env: {
      PATH: process.env.PATH || "",
      HOME: home,
      MAGPIE_TRANSLATOR_HOME: home,
      MAGPIE_TRANSLATOR_LOCK_TOKEN: token,
      MAGPIE_TRANSLATOR_NO_PROC: "1",
      RACE_OUT: path.join(home, `out-${index}`),
    },
    stdio: "ignore",
  }))
  try {
    const start = Date.now()
    let results = null
    while (Date.now() - start < 8000) {
      const values = tokens.map((_token, index) => {
        try { return fs.readFileSync(path.join(home, `out-${index}`), "utf8").trim() } catch { return "" }
      })
      if (values.every(Boolean)) { results = values; break }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    assert.deepEqual([...results].sort(), ["no", "no", "yes"])
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"))
    assert.equal(results[tokens.indexOf(lock.token)], "yes")
    assert.equal(beatIsStale(lock.heartbeat), false)
    assert.equal(alive(sleeper.pid), true)
    assert.notEqual(lock.pid, sleeper.pid)

    const dir = processingDir({ MAGPIE_TRANSLATOR_HOME: home })
    fs.mkdirSync(dir, { recursive: true })
    const fresh = path.join(dir, "fresh.json")
    const stale = path.join(dir, "stale.json")
    fs.writeFileSync(fresh, `${JSON.stringify({ id: "fresh", ownerToken: "other", heartbeat: Date.now() })}\n`)
    fs.writeFileSync(stale, `${JSON.stringify({ id: "stale", ownerToken: "other", heartbeat: 1 })}\n`)
    process.env.MAGPIE_TRANSLATOR_HOME = home
    assert.equal(recoverProcessing(process.env), 1)
    assert.equal(fs.existsSync(fresh), true)
    assert.equal(fs.existsSync(path.join(home, "inbox", "stale.json")), true)
    delete process.env.MAGPIE_TRANSLATOR_HOME
  } finally {
    for (const child of children) {
      try { child.kill("SIGTERM") } catch { /* 已经退出 */ }
    }
    try { sleeper.kill("SIGTERM") } catch { /* 已经退出 */ }
    fs.rmSync(path.dirname(path.dirname(path.dirname(home))), { recursive: true, force: true })
  }
})

test("macOS 路径上的工人不靠 /proc 完成任务，心跳还新时不再启动第二个", async () => {
  const home = macHome()
  fs.mkdirSync(path.join(home, "magpie"), { recursive: true })
  fs.writeFileSync(path.join(home, "magpie", "plugins.json"), `${JSON.stringify({ plugins: [{ spec: packageRoot(), options: { language: "English" } }] })}\n`)
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.json({ choices: [{ message: { content: "mac 译文" } }] })
    },
  })
  fs.mkdirSync(path.join(home, "inbox"), { recursive: true })
  fs.writeFileSync(path.join(home, "inbox", "mac-job.json"), `${JSON.stringify({
    id: "mac-job",
    at: "2026-10-27T00:00:00.000Z",
    translator: "mock/zh",
    original: "Hello from a Mac path.",
    masked: "Hello from a Mac path.",
    slots: [],
    magpieBaseUrl: `http://127.0.0.1:${server.port}`,
    translateTimeoutMs: 10000,
    historyLimit: 20,
    display: ["log"],
  })}\n`)
  const prevHome = process.env.MAGPIE_TRANSLATOR_HOME
  const prevConfig = process.env.XDG_CONFIG_HOME
  const prevSpawn = process.env.MAGPIE_TRANSLATOR_NO_SPAWN
  process.env.MAGPIE_TRANSLATOR_HOME = home
  process.env.XDG_CONFIG_HOME = home
  process.env.MAGPIE_TRANSLATOR_NO_PROC = "1"
  process.env.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD = preload
  delete process.env.MAGPIE_TRANSLATOR_NO_SPAWN
  delete process.env.MAGPIE_TRANSLATOR_GATEWAY_KEY
  try {
    const launch = workerLaunch(process.env, home, "preview-token")
    assert.equal(launch.options.windowsHide, true)
    assert.equal(launch.args[0], "--preload")
    assert.equal(ensureWorker(), true)
    const start = Date.now()
    let row = null
    while (Date.now() - start < 10000) {
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
        if (rows[0]?.translation === "mac 译文") { row = rows[0]; break }
      } catch { /* 还没写完 */ }
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    assert.equal(row.translation, "mac 译文")
    const lock = JSON.parse(fs.readFileSync(path.join(home, "worker.lock"), "utf8"))
    assert.equal(alive(lock.pid), true)
    assert.equal(ensureWorker(), false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "worker.lock"), "utf8")).pid, lock.pid)
    try { process.kill(lock.pid, "SIGTERM") } catch { /* 工人可能已经退出 */ }
  } finally {
    process.env.MAGPIE_TRANSLATOR_NO_SPAWN = prevSpawn || "1"
    if (prevHome === undefined) delete process.env.MAGPIE_TRANSLATOR_HOME
    else process.env.MAGPIE_TRANSLATOR_HOME = prevHome
    if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = prevConfig
    delete process.env.MAGPIE_TRANSLATOR_NO_PROC
    delete process.env.MAGPIE_TRANSLATOR_NO_PROC_PRELOAD
    server.stop(true)
    fs.rmSync(path.dirname(path.dirname(path.dirname(home))), { recursive: true, force: true })
  }
}, 20000)

test("过期锁可以被换走，活着的心跳不会", async () => {
  const home = macHome()
  fs.mkdirSync(home, { recursive: true })
  const file = path.join(home, "worker.lock")
  fs.writeFileSync(file, `${JSON.stringify({ token: "old", heartbeat: Date.now(), hash: "same", parent: 1, pid: process.pid })}\n`)
  assert.equal(await acquireWorkerLock(home, "same", process.pid, "new-token"), false)
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, "old")
  const stale = JSON.parse(fs.readFileSync(file, "utf8"))
  stale.heartbeat = 1
  fs.writeFileSync(file, `${JSON.stringify(stale)}\n`)
  assert.equal(await acquireWorkerLock(home, "same", process.pid, "new-token"), true)
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).token, "new-token")
  fs.rmSync(path.dirname(path.dirname(path.dirname(home))), { recursive: true, force: true })
})
