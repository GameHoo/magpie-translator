import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export function dataDir(env = process.env) {
  if (env.MAGPIE_TRANSLATOR_HOME) return env.MAGPIE_TRANSLATOR_HOME
  const xdg = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  return path.join(xdg, "magpie-translator")
}

export function inboxDir(env = process.env) {
  return path.join(dataDir(env), "inbox")
}

export function logPath(env = process.env) {
  return path.join(dataDir(env), "log.jsonl")
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
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
