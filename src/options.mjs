import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_DISPLAY, DEFAULT_LANGUAGE, parseDisplay, parseFlag, parseHistoryLimit, parseTimeout } from "./config.mjs"

export const MAX_NOTE = 4000
export const MAX_RULES = 40
export const EDITABLE = ["language", "prompt", "style", "display", "webhookUrl", "rules", "translateTimeoutMs", "rewriteSameLanguage", "localPanel", "historyLimit"]
const RULE_FIELDS = new Set(["agent", "model", "translator", "language", "prompt", "style", "display", "webhookUrl"])
const SKIP_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function magpieConfigDir(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdg, "magpie")
}

export function pluginsFile(env = process.env) {
  return path.join(magpieConfigDir(env), "plugins.json")
}

export function packageRoot() {
  return path.resolve(fileURLToPath(new URL("..", import.meta.url)))
}

export function readPluginList(env = process.env) {
  const file = pluginsFile(env)
  let raw
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (err) {
    if (err?.code === "ENOENT") return { file, list: { plugins: [] }, missing: true }
    const error = new Error("读不到 plugins.json")
    error.status = 500
    throw error
  }
  let list
  try {
    list = JSON.parse(raw)
  } catch {
    const error = new Error("plugins.json 不是合法 JSON")
    error.status = 500
    throw error
  }
  if (!list || typeof list !== "object" || Array.isArray(list)) {
    const error = new Error("plugins.json 不是对象")
    error.status = 500
    throw error
  }
  if (!Array.isArray(list.plugins)) list.plugins = []
  return { file, list, missing: false }
}

function isPathSpec(spec) {
  return spec.startsWith("file://") || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(spec)
}

function real(target) {
  try { return fs.realpathSync(target) } catch { return path.resolve(target) }
}

function dependencyName(spec, env) {
  try {
    const file = path.join(magpieConfigDir(env), "plugins", "package.json")
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
    const deps = pkg?.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {}
    for (const [name, value] of Object.entries(deps)) {
      if (value === spec) return name
    }
  } catch { /* 没有 bun 的安装记录 */ }
  return ""
}

export function resolveSpecTarget(spec, env = process.env) {
  if (typeof spec !== "string" || !spec.trim()) return ""
  if (isPathSpec(spec)) {
    const bare = spec.startsWith("file://") ? spec.slice("file://".length) : spec
    return path.resolve(bare)
  }
  const name = dependencyName(spec, env)
  if (!name) return ""
  return path.join(magpieConfigDir(env), "plugins", "node_modules", ...name.split("/"))
}

export function findPlugin(list, env = process.env, { spec = "", root = "" } = {}) {
  const plugins = Array.isArray(list?.plugins) ? list.plugins : []
  if (spec) {
    const exact = plugins.find((entry) => entry && entry.spec === spec)
    if (exact) return exact
    if (isPathSpec(spec)) {
      const want = real(resolveSpecTarget(spec, env))
      return plugins.find((entry) => entry?.spec && real(resolveSpecTarget(entry.spec, env)) === want) || null
    }
    return null
  }
  const want = real(root || packageRoot())
  return plugins.find((entry) => {
    const target = resolveSpecTarget(entry?.spec, env)
    return target && real(target) === want
  }) || null
}

function cleanLine(value, max, label) {
  if (value == null || value === "") return ""
  if (typeof value !== "string") return { error: `${label}必须是字符串` }
  const text = value.trim()
  if (/[\r\n]/.test(text)) return { error: `${label}不能换行` }
  if (text.length > max) return { error: `${label}最长 ${max} 个字符` }
  return text
}

function cleanBlock(value, max, label) {
  if (value == null || value === "") return ""
  if (typeof value !== "string") return { error: `${label}必须是字符串` }
  const text = value.trim()
  if (text.length > max) return { error: `${label}最长 ${max} 个字符` }
  return text
}

function cleanUrl(value) {
  if (value == null || value === "") return ""
  if (typeof value !== "string") return { error: "webhookUrl 必须是字符串" }
  const text = value.trim()
  if (!text) return ""
  try {
    const url = new URL(text)
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "webhookUrl 只接受 http 或 https" }
    return url.toString()
  } catch {
    return { error: "webhookUrl 不是合法地址" }
  }
}

function cleanDisplay(value, label) {
  if (value == null || value === "") return { inherit: true, value: [] }
  const source = Array.isArray(value) ? value : String(value).split(/[\s,]+/)
  const out = []
  for (const item of source) {
    const name = String(item || "").trim().toLowerCase()
    if (!name) continue
    if (!["panel", "log", "file", "stdout", "notify", "webhook"].includes(name)) {
      return { error: `${label}不认识 ${name}` }
    }
    if (!out.includes(name)) out.push(name)
  }
  if (!out.length) return { error: `${label}至少选一个` }
  return { inherit: false, value: out }
}

function asError(value) {
  return value && typeof value === "object" && typeof value.error === "string" ? value.error : ""
}

function ruleExtra(input) {
  const extra = {}
  for (const [key, value] of Object.entries(input)) {
    if (RULE_FIELDS.has(key) || SKIP_KEYS.has(key)) continue
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") extra[key] = value
  }
  return extra
}

function normalizeRule(input, index) {
  const where = `第 ${index + 1} 条规则`
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: `${where}不是对象` }
  const translator = cleanLine(input.translator, 300, `${where}的翻译模型`)
  if (asError(translator)) return { error: asError(translator) }
  if (!translator) return { error: `${where}要填翻译模型` }
  const agent = cleanLine(input.agent, 200, `${where}的 agent`)
  const model = cleanLine(input.model, 200, `${where}的 model`)
  const language = cleanLine(input.language, 200, `${where}的语言`)
  const prompt = cleanBlock(input.prompt, MAX_NOTE, `${where}的提示词`)
  const style = cleanBlock(input.style, MAX_NOTE, `${where}的 style`)
  const webhook = cleanUrl(input.webhookUrl)
  const display = input.display == null || input.display === "" ? { inherit: true, value: [] } : cleanDisplay(input.display, `${where}的展示方式`)
  for (const item of [agent, model, language, prompt, style, webhook, display]) {
    const error = asError(item)
    if (error) return { error }
  }
  const rule = { ...ruleExtra(input), translator }
  if (agent) rule.agent = agent
  if (model) rule.model = model
  if (language) rule.language = language
  if (prompt) rule.prompt = prompt
  if (style) rule.style = style
  if (!display.inherit) rule.display = display.value
  if (webhook) rule.webhookUrl = webhook
  return { value: rule }
}

export function normalizeSettings(input, previous = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "设置必须是 JSON 对象" }
  const prior = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {}
  const language = cleanLine(input.language, 200, "目标语言")
  const prompt = cleanBlock(input.prompt, MAX_NOTE, "提示词")
  const style = cleanBlock(input.style, MAX_NOTE, "style")
  const webhook = cleanUrl(input.webhookUrl)
  const display = cleanDisplay(input.display, "展示方式")
  for (const item of [language, prompt, style, webhook, display]) {
    const error = asError(item)
    if (error) return { error }
  }
  if (display.inherit) return { error: "展示方式至少选一个" }
  const timeout = input.translateTimeoutMs == null || input.translateTimeoutMs === ""
    ? parseTimeout(prior.translateTimeoutMs)
    : parseTimeout(input.translateTimeoutMs)
  const historyLimit = input.historyLimit == null || input.historyLimit === ""
    ? parseHistoryLimit(prior.historyLimit)
    : parseHistoryLimit(input.historyLimit)
  const rewrite = input.rewriteSameLanguage == null
    ? parseFlag(prior.rewriteSameLanguage, false)
    : parseFlag(input.rewriteSameLanguage, false)
  const localPanel = input.localPanel == null
    ? parseFlag(prior.localPanel, false)
    : parseFlag(input.localPanel, false)
  if (!Array.isArray(input.rules)) return { error: "rules 必须是数组" }
  if (input.rules.length > MAX_RULES) return { error: `规则最多 ${MAX_RULES} 条` }
  const rules = []
  for (let i = 0; i < input.rules.length; i++) {
    const rule = normalizeRule(input.rules[i], i)
    if (rule.error) return { error: rule.error }
    rules.push(rule.value)
  }
  const options = { ...prior }
  for (const key of EDITABLE) delete options[key]
  if (language) options.language = language
  if (prompt) options.prompt = prompt
  if (style) options.style = style
  options.display = display.value
  if (webhook) options.webhookUrl = webhook
  options.rules = rules
  options.translateTimeoutMs = timeout
  options.rewriteSameLanguage = rewrite
  options.localPanel = localPanel
  options.historyLimit = historyLimit
  delete options._compare
  return { options }
}

export function viewOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {}
  const preserved = Object.keys(source).filter((key) => !EDITABLE.includes(key) && !SKIP_KEYS.has(key)).sort()
  const rules = Array.isArray(source.rules) ? source.rules : []
  return {
    language: typeof source.language === "string" ? source.language : "",
    prompt: typeof source.prompt === "string" ? source.prompt : "",
    style: typeof source.style === "string" ? source.style : "",
    display: parseDisplay(source.display),
    webhookUrl: typeof source.webhookUrl === "string" ? source.webhookUrl : "",
    rules: rules.filter((rule) => rule && typeof rule === "object").map(viewRule),
    translateTimeoutMs: parseTimeout(source.translateTimeoutMs),
    rewriteSameLanguage: parseFlag(source.rewriteSameLanguage, false),
    localPanel: parseFlag(source.localPanel, false),
    historyLimit: parseHistoryLimit(source.historyLimit),
    preserved,
  }
}

function viewRule(rule) {
  const view = {
    agent: typeof rule.agent === "string" ? rule.agent : "",
    model: typeof rule.model === "string" ? rule.model : "",
    translator: typeof rule.translator === "string" ? rule.translator : "",
    language: typeof rule.language === "string" ? rule.language : "",
    prompt: typeof rule.prompt === "string" ? rule.prompt : "",
    style: typeof rule.style === "string" ? rule.style : "",
    display: rule.display == null || rule.display === "" ? null : parseDisplay(rule.display),
    webhookUrl: typeof rule.webhookUrl === "string" ? rule.webhookUrl : "",
    extra: ruleExtra(rule),
  }
  return view
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

function sameJson(a, b) {
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null))
}

function writeList(file, list) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `.plugins.json.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* 已经换成新文件 */ }
}

export function loadSettings(env = process.env, locate = {}) {
  const { file, list, missing } = readPluginList(env)
  if (missing) {
    return {
      found: false,
      file,
      spec: "",
      off: false,
      error: "还没有 plugins.json。先运行 magpie plugin add，再打开这一页。",
      options: emptyView(),
    }
  }
  const entry = findPlugin(list, env, locate)
  if (!entry) {
    return {
      found: false,
      file,
      spec: "",
      off: false,
      error: "plugins.json 里没有指向这份插件的条目。先 magpie plugin add。路径安装时 spec 是那个目录；也可以设置 MAGPIE_TRANSLATOR_PLUGIN 为 plugin list 印出的名字。",
      options: emptyView(),
    }
  }
  const view = viewOptions(entry.options || {})
  return { found: true, file, spec: entry.spec, off: entry.off === true, error: "", options: view }
}

function emptyView() {
  return {
    language: "",
    prompt: "",
    style: "",
    display: [...DEFAULT_DISPLAY],
    webhookUrl: "",
    rules: [],
    translateTimeoutMs: parseTimeout(undefined),
    rewriteSameLanguage: false,
    localPanel: false,
    historyLimit: parseHistoryLimit(undefined),
    preserved: [],
  }
}

export function saveSettings(input, env = process.env, locate = {}) {
  const { file, list, missing } = readPluginList(env)
  if (missing) {
    const error = new Error("还没有 plugins.json。先运行 magpie plugin add。")
    error.status = 404
    throw error
  }
  const entry = findPlugin(list, env, locate)
  if (!entry) {
    const error = new Error("plugins.json 里没有这份插件，所以没有写入。")
    error.status = 404
    throw error
  }
  const normalized = normalizeSettings(input, entry.options || {})
  if (normalized.error) {
    const error = new Error(normalized.error)
    error.status = 400
    throw error
  }
  const changed = !sameJson(entry.options || {}, normalized.options)
  if (changed) {
    entry.options = normalized.options
    writeList(file, list)
  }
  const view = viewOptions(normalized.options)
  return { spec: entry.spec, file, changed, options: view, preserved: view.preserved }
}

export const DEFAULTS = { language: DEFAULT_LANGUAGE, display: [...DEFAULT_DISPLAY] }
