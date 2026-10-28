import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export function dataDir(env = process.env) {
  if (env.MAGPIE_TRANSLATOR_HOME) return env.MAGPIE_TRANSLATOR_HOME
  const xdg = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(xdg, "magpie-translator")
}

export function logPath(env = process.env) {
  return path.join(dataDir(env), "log.jsonl")
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function fsyncDir(dir) {
  let fd
  try { fd = fs.openSync(dir, "r") } catch { return }
  try { fs.fsyncSync(fd) } catch { /* 有的系统不能同步目录 */ }
  finally { try { fs.closeSync(fd) } catch { /* 已经关上 */ } }
}

export function writeAtomic(file, text, mode = 0o600) {
  const dir = path.dirname(file)
  ensureDir(dir)
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  const fd = fs.openSync(tmp, "w", mode)
  try {
    fs.writeFileSync(fd, text)
    fs.fsyncSync(fd)
  } catch (err) {
    try { fs.closeSync(fd) } catch { /* 已经关上 */ }
    try { fs.unlinkSync(tmp) } catch { /* 临时文件可以留着 */ }
    throw err
  }
  fs.closeSync(fd)
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, mode) } catch { /* 新文件已经是这个模式 */ }
  fsyncDir(dir)
}

export function activityPath(env = process.env) {
  return path.join(dataDir(env), "gateway-activity")
}

// 每次网关请求记一笔。写 plugins.json 会让 magpie 换掉 hook 宿主，所以要等它安静下来。
export function noteGatewayActivity(env = process.env, now = new Date()) {
  const file = activityPath(env)
  try {
    ensureDir(path.dirname(file))
    const fd = fs.openSync(file, "a", 0o600)
    try { fs.futimesSync(fd, now, now) } catch { /* 文件已经在了 */ }
    fs.closeSync(fd)
  } catch { /* 没有活动戳也不挡住入队 */ }
}

export function gatewayActivityAt(env = process.env) {
  try { return fs.statSync(activityPath(env)).mtimeMs || 0 } catch { return 0 }
}

export function magpieBaseUrl(options = {}, env = process.env) {
  const fromOpt = typeof options.magpieBaseUrl === "string" ? options.magpieBaseUrl.trim() : ""
  if (fromOpt) return fromOpt.replace(/\/$/, "")
  if (env.MAGPIE_BASE_URL) return env.MAGPIE_BASE_URL.replace(/\/$/, "")
  try {
    const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
    const settings = JSON.parse(fs.readFileSync(path.join(xdg, "magpie", "settings.json"), "utf8"))
    const port = Number(settings.port) || 3425
    return `http://127.0.0.1:${port}`
  } catch {
    return "http://127.0.0.1:3425"
  }
}
