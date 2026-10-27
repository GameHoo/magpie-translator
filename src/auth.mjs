import fs from "node:fs"
import path from "node:path"
import { dataDir } from "./paths.mjs"
import { writeAtomic } from "./paths.mjs"
import { gatewayKeyFromEnv } from "./translate.mjs"

export function gatewayKeyPath(env = process.env) {
  return path.join(dataDir(env), "gateway.key")
}

export function readGatewayKey(env = process.env) {
  try {
    return fs.readFileSync(gatewayKeyPath(env), "utf8").trim()
  } catch {
    return ""
  }
}

export function writeGatewayKey(key, env = process.env) {
  writeAtomic(gatewayKeyPath(env), `${String(key).trim()}\n`)
}

// 本机回环不带密钥也能过 magpie 的网关。文件里的密钥优先，环境变量只作迁移。
export function gatewayKeyFor(env = process.env) {
  return readGatewayKey(env) || gatewayKeyFromEnv(env)
}
