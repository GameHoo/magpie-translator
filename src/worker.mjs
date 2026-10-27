import { createHash } from "node:crypto"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { packageRoot } from "./options.mjs"
import { dataDir, ensureDir } from "./paths.mjs"

const panelPath = fileURLToPath(new URL("./panel.mjs", import.meta.url))

// 更新之后旧进程还在写上一份安装目录，新目录里的 feed.js / catalog.js 就一直是空的。
// pid 文件带上版本、源码哈希和安装路径，对不上就换一个进程。
export function workerStamp() {
  return `${readVersion()}:${codeHash()}:${packageRoot()}`
}

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"))
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0"
  } catch {
    return "0"
  }
}

function codeHash() {
  const dir = path.dirname(panelPath)
  const names = fs.readdirSync(dir).filter((name) => name.endsWith(".mjs")).sort()
  const hash = createHash("sha256")
  for (const name of names) {
    hash.update(name)
    hash.update("\0")
    hash.update(fs.readFileSync(path.join(dir, name)))
  }
  return hash.digest("hex").slice(0, 16)
}

export function formatPid(pid, stamp = workerStamp()) {
  return `${JSON.stringify({ pid, stamp })}\n`
}

export function parsePid(text) {
  const raw = String(text ?? "").trim()
  if (!raw) return null
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw)
      const pid = Number(parsed.pid)
      if (!Number.isInteger(pid) || pid <= 0) return null
      return { pid, stamp: typeof parsed.stamp === "string" ? parsed.stamp : "" }
    } catch {
      return null
    }
  }
  const pid = Number(raw.split(/\s+/)[0])
  if (!Number.isInteger(pid) || pid <= 0) return null
  return { pid, stamp: raw.split(/\s+/).slice(1).join(" ") }
}

export function readPid(pidfile) {
  try {
    return parsePid(fs.readFileSync(pidfile, "utf8"))
  } catch {
    return null
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function processCommand(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`).toString("utf8")
  } catch { /* 没有 /proc 时再问 ps */ }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" })
  } catch {
    return ""
  }
}

export function isPanelProcess(pid) {
  return processCommand(pid).includes("panel.mjs")
}

export function releasePidfile(pidfile, pid = process.pid) {
  try {
    const rec = readPid(pidfile)
    if (rec && rec.pid === pid) fs.unlinkSync(pidfile)
  } catch { /* 文件已经没了 */ }
}

function waitDead(pid, ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (!pidAlive(pid)) return true
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 40)"])
  }
  return !pidAlive(pid)
}

function stopPanel(pid) {
  if (!pidAlive(pid) || !isPanelProcess(pid)) return
  try { process.kill(pid, "SIGTERM") } catch { /* 已经退出 */ }
  if (waitDead(pid, 400)) return
  try { process.kill(pid, "SIGKILL") } catch { /* 已经退出 */ }
  waitDead(pid, 200)
}

export function ensureWorker(env = process.env, extra = {}) {
  if (env.MAGPIE_TRANSLATOR_NO_SPAWN === "1") return null
  const home = dataDir(env)
  ensureDir(home)
  const pidfile = path.join(home, "panel.pid")
  const stamp = workerStamp()
  const rec = readPid(pidfile)
  if (rec && pidAlive(rec.pid) && rec.stamp === stamp && isPanelProcess(rec.pid)) return rec.pid
  if (rec && pidAlive(rec.pid)) stopPanel(rec.pid)
  try { fs.unlinkSync(pidfile) } catch { /* 没有旧文件 */ }
  let fd
  try { fd = fs.openSync(pidfile, "wx", 0o600) } catch { return null }
  const child = spawn(process.execPath, [panelPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...env,
      MAGPIE_TRANSLATOR_PORT: String(extra.port || env.MAGPIE_TRANSLATOR_PORT || ""),
      MAGPIE_TRANSLATOR_HOME: home,
      MAGPIE_TRANSLATOR_DISPLAY: extra.display ?? env.MAGPIE_TRANSLATOR_DISPLAY ?? "",
      MAGPIE_TRANSLATOR_LOCAL: extra.local ?? env.MAGPIE_TRANSLATOR_LOCAL ?? "",
    },
  })
  fs.writeSync(fd, formatPid(child.pid, stamp))
  fs.closeSync(fd)
  child.unref()
  child.on("error", () => {})
  return child.pid
}
