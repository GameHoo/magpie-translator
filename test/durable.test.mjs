import "./preload.mjs"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "bun:test"
import { gatewayKeyPath } from "../src/auth.mjs"
import { FEED_BUDGET, addComparison, findHistory, hasSeen, markSeen, publicFeed, recordTranslation, replaceTranslation, writePublicFeed } from "../src/history.mjs"
import { FEED_MIN_INTERVAL_MS, FEED_QUIET_MS, packageRoot, syncHostSurface } from "../src/options.mjs"
import { enqueue, INBOX_CAP, finishClaim, journalPath, listInbox, processingDir, queueWaitMs, recoverProcessing, replayJournal, takeJob, touchClaim } from "../src/queue.mjs"
import { minimalEnv } from "../src/worker.mjs"
import { alive, parentGone, processCompare, processOnce, refreshWorkerLock, runQueued, shouldExitAfterPublish, sweepDeadLocks, workerLaunch } from "../src/worker.mjs"
import { PUBLISH_RETRY_LIMIT_MS, publishBackoff, workerToken } from "../src/proc.mjs"
import { CONNECT_ATTEMPTS, connectBackoff, connectionFailure } from "../src/translate.mjs"

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
  assert.equal(env.MAGPIE_TRANSLATOR_LOCK_TOKEN, undefined)
  assert.equal(alive(process.pid), true)
  fs.rmSync(home, { recursive: true, force: true })
})

test("收件箱最多留下 100 条，最新的还在", () => {
  const home = tempHome()
  for (let i = 0; i < INBOX_CAP + 5; i += 1) {
    enqueue(job({ id: `n-${String(i).padStart(3, "0")}` }), process.env)
  }
  const names = listInbox(process.env)
  assert.equal(names.length, INBOX_CAP)
  assert.equal(names.includes("n-104.json"), true)
  assert.equal(names.includes("n-000.json"), false)
  const dropped = JSON.parse(fs.readFileSync(path.join(home, "dropped.json"), "utf8"))
  assert.equal(dropped.some((item) => item.id === "n-000"), true)
  const log = fs.readFileSync(path.join(home, "log.jsonl"), "utf8")
  assert.match(log, /"dropped":true/)
  assert.match(log, /n-000/)
  fs.rmSync(home, { recursive: true, force: true })
})

test("父进程退出后，还在等的发布都会退避并在时限后停止", () => {
  const limit = PUBLISH_RETRY_LIMIT_MS
  for (const reason of ["conflict", "debounce", "rate", "error", "read"]) {
    assert.equal(shouldExitAfterPublish({ parentDead: true, reason, retrySince: 1000, now: 1000 + limit - 1 }), false)
    assert.equal(shouldExitAfterPublish({ parentDead: true, reason, retrySince: 1000, now: 1000 + limit }), true)
  }
  assert.equal(shouldExitAfterPublish({ parentDead: true, reason: "conflict", conflictSince: 1000, now: 1000 + limit }), true)
  assert.equal(shouldExitAfterPublish({ parentDead: true, reason: "empty", retrySince: 0, now: 5 }), true)
  assert.equal(shouldExitAfterPublish({ parentDead: false, reason: "debounce", retrySince: 1000, now: 999999 }), false)
  assert.equal(publishBackoff(0), 50)
  assert.equal(publishBackoff(1), 100)
  assert.equal(publishBackoff(2), 200)
  assert.equal(publishBackoff(20), 1000)
  const launch = workerLaunch({ PATH: "/usr/bin", HOME: "/Users/magpie" }, "/Users/magpie/Library/Application Support/magpie-translator", "token")
  assert.equal(launch.options.windowsHide, true)
})

test("plugins.json 在写入前被改过时只合上 feed，新的密钥留着", () => {
  const home = tempHome()
  const file = writePlugins(home, { language: "English", theme: "plain", gatewayKey: "old-key" })
  const list = JSON.parse(fs.readFileSync(file, "utf8"))
  list.plugins.push({ spec: "other-plugin", options: { keep: true } })
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
  recordTranslation({ id: "row-1", original: "Hello there from the model.", translation: "你好", translator: "mock/zh", at: "2026-10-27T00:00:00.000Z" }, process.env, 20)
  const result = syncHostSurface(process.env, {
    debounceMs: 0,
    minIntervalMs: 0,
    now: 10000,
    beforeWrite(target) {
      const latest = JSON.parse(fs.readFileSync(target, "utf8"))
      latest.plugins[0].options.language = "日本語"
      latest.plugins[0].options.theme = "night"
      latest.plugins[0].options.gatewayKey = "new-key"
      latest.plugins[1].options.extra = 1
      fs.writeFileSync(target, `${JSON.stringify(latest, null, 2)}\n`)
    },
  })
  assert.equal(result.wrote, true)
  assert.equal(result.reason, "merged")
  const after = JSON.parse(fs.readFileSync(file, "utf8"))
  assert.equal(after.plugins[0].options.language, "日本語")
  assert.equal(after.plugins[0].options.theme, "night")
  assert.equal(after.plugins[0].options.gatewayKey, "new-key")
  assert.equal(after.plugins[0].options.feed.entries[0].translation, "你好")
  assert.equal(after.plugins[1].options.keep, true)
  assert.equal(after.plugins[1].options.extra, 1)
  assert.equal(fs.readFileSync(gatewayKeyPath(process.env), "utf8").trim(), "old-key")
  fs.rmSync(home, { recursive: true, force: true })
})

test("同一个任务只记一行，webhook 也只发一次", async () => {
  const home = tempHome()
  writePlugins(home, { language: "English" })
  let hooks = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/hook") {
        hooks += 1
        return new Response("ok")
      }
      return new Response("no")
    },
  })
  try {
    const fetchImpl = okFetch("一次")
    const body = job({
      id: "dup-1",
      display: ["webhook"],
      origin: "local",
      webhookUrl: `http://127.0.0.1:${server.port}/hook`,
    })
    enqueue(body, process.env)
    assert.equal(await processOnce(process.env, { fetchImpl }), true)
    enqueue(body, process.env)
    assert.equal(await processOnce(process.env, { fetchImpl }), true)
    assert.equal(fetchImpl.calls, 1)
    assert.equal(hooks, 1)
    const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].translation, "一次")
  } finally {
    server.stop(true)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("父进程已经不在时，手头的任务仍然做完", async () => {
  const home = tempHome()
  writePlugins(home, { language: "English" })
  process.env.MAGPIE_TRANSLATOR_PARENT_PID = "999999"
  try {
    assert.equal(parentGone(process.env), true)
    enqueue(job({ id: "still-done" }), process.env)
    const fetchImpl = okFetch("做完了")
    assert.equal(await processOnce(process.env, { fetchImpl }), true)
    assert.equal(fetchImpl.calls, 1)
    const rows = JSON.parse(fs.readFileSync(path.join(home, "history.json"), "utf8"))
    assert.equal(rows[0].translation, "做完了")
    assert.equal(rows[0].error, "")
  } finally {
    delete process.env.MAGPIE_TRANSLATOR_PARENT_PID
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("同 id 的错误不会盖掉已经成功的记录", () => {
  const home = tempHome()
  recordTranslation({
    id: "keep-ok",
    original: "Hello there from the model.",
    translation: "你好",
    status: "done",
    translator: "mock/zh",
  }, process.env, 20)
  addComparison("keep-ok", { translator: "other", translation: "こんにちは" }, process.env)
  const kept = recordTranslation({
    id: "keep-ok",
    original: "Hello there from the model.",
    translation: "",
    error: "boom",
    status: "error",
  }, process.env, 20)
  assert.equal(kept.translation, "你好")
  assert.equal(kept.error, "")
  assert.equal(kept.status, "done")
  assert.equal(kept.comparisons.length, 1)
  const disk = findHistory("keep-ok", process.env)
  assert.equal(disk.translation, "你好")
  assert.equal(disk.comparisons[0].translation, "こんにちは")
  const replaced = replaceTranslation("keep-ok", { translation: "", error: "nope", ms: 4 }, process.env)
  assert.equal(replaced.translation, "你好")
  assert.equal(replaced.error, "")
  assert.equal(findHistory("keep-ok", process.env).comparisons.length, 1)
  const again = recordTranslation({
    id: "keep-ok",
    original: "Hello there from the model.",
    translation: "新的",
    status: "done",
  }, process.env, 20)
  assert.equal(again.translation, "新的")
  assert.equal(again.error, "")
  fs.rmSync(home, { recursive: true, force: true })
})

test("认领只有 token 是自己的才刷新或完成", () => {
  const home = tempHome()
  const env = { ...process.env }
  delete env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  const dir = processingDir(env)
  fs.mkdirSync(dir, { recursive: true })
  const claim = path.join(dir, "foreign.json")
  const foreign = { id: "foreign", ownerToken: "other", heartbeat: 1, original: "Hello" }
  fs.writeFileSync(claim, `${JSON.stringify(foreign)}\n`)
  const before = fs.readFileSync(claim, "utf8")
  assert.equal(touchClaim(claim, env), false)
  assert.equal(finishClaim(claim, env), false)
  assert.equal(fs.readFileSync(claim, "utf8"), before)
  const bare = path.join(dir, "bare.json")
  fs.writeFileSync(bare, `${JSON.stringify({ id: "bare", heartbeat: 1 })}\n`)
  const bareBefore = fs.readFileSync(bare, "utf8")
  assert.equal(touchClaim(bare, env), false)
  assert.equal(finishClaim(bare, env), false)
  assert.equal(fs.readFileSync(bare, "utf8"), bareBefore)
  assert.equal(JSON.parse(fs.readFileSync(bare, "utf8")).ownerToken, undefined)
  const ours = path.join(dir, "ours.json")
  fs.writeFileSync(ours, `${JSON.stringify({ id: "ours", ownerToken: workerToken(env), heartbeat: 1 })}\n`)
  assert.equal(touchClaim(ours, env), true)
  const touched = JSON.parse(fs.readFileSync(ours, "utf8"))
  assert.ok(touched.heartbeat > 1)
  assert.equal(touched.ownerToken, workerToken(env))
  assert.equal(finishClaim(ours, env), true)
  assert.equal(fs.existsSync(ours), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("锁丢了就中止正在进行的请求，认领还在，不记错误", async () => {
  const home = tempHome()
  const env = { ...process.env }
  delete env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  enqueue(job({ id: "abort-me" }), env)
  const taken = takeJob(env)
  let lost = false
  const fetchImpl = async (_url, init) => {
    lost = true
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("should have aborted")), 3000)
      init.signal.addEventListener("abort", () => {
        clearTimeout(timer)
        const err = new Error("aborted")
        err.name = "AbortError"
        reject(err)
      })
    })
  }
  await assert.rejects(
    () => runQueued(taken, env, { fetchImpl, lockLost: () => lost }),
    (err) => err?.name === "StopWorker",
  )
  assert.equal(fs.existsSync(taken.__claim), true)
  assert.equal(fs.existsSync(path.join(home, "history.json")), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("过期的 worker.lock.dead 会清掉，心跳用临时文件换名", () => {
  const home = tempHome()
  const stale = path.join(home, "worker.lock.dead.old")
  const fresh = path.join(home, "worker.lock.dead.fresh")
  fs.writeFileSync(stale, `${JSON.stringify({ token: "old", heartbeat: 1 })}\n`)
  fs.writeFileSync(fresh, `${JSON.stringify({ token: "fresh", heartbeat: Date.now() })}\n`)
  const bare = path.join(home, "worker.lock.dead.bare")
  fs.writeFileSync(bare, "not-json")
  const old = new Date(Date.now() - 9000)
  fs.utimesSync(bare, old, old)
  const bareFresh = path.join(home, "worker.lock.dead.barefresh")
  fs.writeFileSync(bareFresh, "not-json")
  sweepDeadLocks(home)
  assert.equal(fs.existsSync(stale), false)
  assert.equal(fs.existsSync(bare), false)
  assert.equal(fs.existsSync(fresh), true)
  assert.equal(fs.existsSync(bareFresh), true)
  const lock = path.join(home, "worker.lock")
  fs.writeFileSync(lock, `${JSON.stringify({ token: "mine", heartbeat: 1, hash: "h", parent: 1, pid: 1 })}\n`)
  assert.equal(refreshWorkerLock(home, "other"), false)
  assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).heartbeat, 1)
  assert.equal(refreshWorkerLock(home, "mine"), true)
  const next = JSON.parse(fs.readFileSync(lock, "utf8"))
  assert.ok(next.heartbeat > 1)
  assert.equal(next.token, "mine")
  const names = fs.readdirSync(home)
  assert.equal(names.some((name) => name.includes(".tmp") || name.startsWith("worker.lock.beat.")), false)
  fs.rmSync(home, { recursive: true, force: true })
})

test("进行中的错误赶上已有成功时，不覆盖也不发 webhook", async () => {
  const home = tempHome()
  const env = { ...process.env }
  delete env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  let hooks = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/hook") {
        hooks += 1
        return new Response("ok")
      }
      return new Response("no")
    },
  })
  try {
    enqueue(job({
      id: "race-ok",
      display: ["webhook"],
      origin: "local",
      webhookUrl: `http://127.0.0.1:${server.port}/hook`,
    }), env)
    const taken = takeJob(env)
    const fetchImpl = async () => {
      recordTranslation({
        id: "race-ok",
        original: "Hello there from the model.",
        translation: "你好",
        status: "done",
        translator: "mock/zh",
      }, env, 20)
      throw new Error("late failure")
    }
    const result = await runQueued(taken, env, { fetchImpl })
    assert.equal(result.translation, "你好")
    assert.equal(result.error, "")
    assert.equal(hooks, 0)
    assert.equal(fs.existsSync(taken.__claim), false)
    assert.equal(fs.existsSync(path.join(home, "delivered")), false)
    assert.equal(findHistory("race-ok", env).translation, "你好")
  } finally {
    server.stop(true)
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test("网关还忙着，或者距上次写入太近时，不改 plugins.json", () => {
  assert.equal(FEED_QUIET_MS, 60_000)
  assert.equal(FEED_MIN_INTERVAL_MS, 180_000)
  const home = tempHome()
  const file = writePlugins(home, { language: "English" })
  const before = fileId(file)
  recordTranslation({
    id: "row-1",
    original: "Hello there from the model.",
    translation: "你好",
    status: "done",
    translator: "mock/zh",
    at: "2026-10-27T00:00:00.000Z",
  }, process.env, 20)
  const busy = syncHostSurface(process.env, { now: 100_000, activityAt: 90_000 })
  assert.equal(busy.reason, "debounce")
  assert.equal(fileId(file), before)
  const quiet = syncHostSurface(process.env, { now: 160_000, activityAt: 90_000 })
  assert.equal(quiet.wrote, true)
  assert.equal(quiet.reason, "feed")
  recordTranslation({
    id: "row-2",
    original: "Second sentence from the model.",
    translation: "第二句",
    status: "done",
    translator: "mock/zh",
    at: "2026-10-27T00:00:01.000Z",
  }, process.env, 20)
  const rated = syncHostSurface(process.env, { debounceMs: 0, now: 170_000, activityAt: 0 })
  assert.equal(rated.reason, "rate")
  assert.equal(pluginsText(file).includes("第二句"), false)
  const later = syncHostSurface(process.env, { debounceMs: 0, now: 160_000 + FEED_MIN_INTERVAL_MS, activityAt: 0 })
  assert.equal(later.wrote, true)
  assert.match(pluginsText(file), /第二句/)
  fs.rmSync(home, { recursive: true, force: true })
})

test("收件箱日志能把没写完的任务补回去", () => {
  const home = tempHome()
  const env = { ...process.env }
  delete env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  const body = job({ id: "from-journal" })
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(journalPath(env), `${JSON.stringify({ at: 1, job: body })}\n`)
  assert.equal(replayJournal(env, 10_000), 1)
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "inbox", "from-journal.json"), "utf8")).id, "from-journal")
  assert.equal(fs.existsSync(journalPath(env)), false)
  const young = job({ id: "still-writing" })
  fs.writeFileSync(journalPath(env), `${JSON.stringify({ at: 50_000, job: young })}\n`)
  assert.equal(replayJournal(env, 51_000), 0)
  assert.equal(fs.existsSync(path.join(home, "inbox", "still-writing.json")), false)
  assert.match(fs.readFileSync(journalPath(env), "utf8"), /still-writing/)
  enqueue(job({ id: "queued-ok" }), env)
  assert.match(fs.readFileSync(journalPath(env), "utf8"), /queued-ok/)
  assert.equal(fs.existsSync(path.join(home, "inbox", "queued-ok.json")), true)
  fs.rmSync(home, { recursive: true, force: true })
})

test("连接被掐断会放回收件箱，4xx 只记一次失败", async () => {
  assert.equal(connectionFailure(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })), true)
  assert.equal(connectionFailure(Object.assign(new Error("The socket connection was closed unexpectedly"), { code: "UND_ERR_SOCKET" })), true)
  assert.equal(connectionFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })), true)
  const http = new Error("翻译模型返回 HTTP 400")
  http.status = 400
  assert.equal(connectionFailure(http), false)
  const timeout = new Error("The operation timed out.")
  timeout.name = "TimeoutError"
  assert.equal(connectionFailure(timeout), false)
  assert.equal(connectBackoff(1), 1000)
  assert.equal(connectBackoff(2), 2000)
  assert.equal(connectBackoff(5), 10_000)

  const home = tempHome()
  const env = { ...process.env }
  delete env.MAGPIE_TRANSLATOR_LOCK_TOKEN
  enqueue(job({ id: "reset-1" }), env)
  const taken = takeJob(env)
  let calls = 0
  const reset = async () => {
    calls += 1
    const err = new Error("socket hang up")
    err.code = "ECONNRESET"
    throw err
  }
  const deferred = await runQueued(taken, env, { fetchImpl: reset })
  assert.equal(deferred.requeued, true)
  assert.equal(calls, 1)
  assert.equal(fs.existsSync(path.join(home, "history.json")), false)
  const again = JSON.parse(fs.readFileSync(path.join(home, "inbox", "reset-1.json"), "utf8"))
  assert.equal(again.connAttempts, 1)
  assert.ok(again.notBefore > Date.now())
  assert.equal(takeJob(env), null)
  assert.ok(queueWaitMs(env) > 0)
  again.notBefore = 0
  fs.writeFileSync(path.join(home, "inbox", "reset-1.json"), `${JSON.stringify(again)}\n`)
  const done = await processOnce(env, {
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "恢复了" } }] }), {
      headers: { "content-type": "application/json" },
    }),
  })
  assert.equal(done, true)
  assert.equal(findHistory("reset-1", env).translation, "恢复了")
  assert.equal(findHistory("reset-1", env).error, "")

  enqueue(job({ id: "denied-1" }), env)
  let denied = 0
  await processOnce(env, {
    fetchImpl: async () => {
      denied += 1
      return new Response("no", { status: 400 })
    },
  })
  assert.equal(denied, 1)
  assert.match(findHistory("denied-1", env).error, /HTTP 400/)
  assert.equal(fs.existsSync(path.join(home, "inbox", "denied-1.json")), false)

  enqueue(job({ id: "gave-up", connAttempts: CONNECT_ATTEMPTS - 1 }), env)
  await processOnce(env, { fetchImpl: reset })
  assert.match(findHistory("gave-up", env).error, /socket hang up/)
  assert.equal(fs.existsSync(path.join(home, "inbox", "gave-up.json")), false)
  fs.rmSync(home, { recursive: true, force: true })
})
