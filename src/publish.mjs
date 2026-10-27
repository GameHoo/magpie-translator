import fs from "node:fs"
import path from "node:path"
import { packageRoot } from "./options.mjs"

// 页面不能 fetch。记录和模型列表写成插件目录里的 JS，由 <script src> 读。
// 不写进 plugins.json：magpie 看到 options 变化会重启 hook 宿主。

export function uiDir(env = process.env) {
  if (env.MAGPIE_TRANSLATOR_UI) return env.MAGPIE_TRANSLATOR_UI
  if (process.execArgv.includes("--test") || env.NODE_TEST_CONTEXT) return ""
  return path.join(packageRoot(), "ui")
}

export function writeScript(name, globalName, value, env = process.env) {
  const dir = uiDir(env)
  if (!dir) return ""
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
  const json = JSON.stringify(value).replace(/</g, "\\u003c")
  const body = `globalThis.${globalName} = ${json};\n`
  const file = path.join(dir, name)
  try {
    if (fs.readFileSync(file, "utf8") === body) return file
  } catch { /* 第一次写 */ }
  const tmp = path.join(dir, `.${name}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, body, { mode: 0o644 })
  fs.renameSync(tmp, file)
  return file
}

export function writeFeed(feed, env = process.env) {
  return writeScript("feed.js", "MAGPIE_TRANSLATOR_FEED", feed, env)
}

export function writeCatalog(catalog, env = process.env) {
  return writeScript("catalog.js", "MAGPIE_TRANSLATOR_CATALOG", catalog, env)
}
