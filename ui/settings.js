const LANGUAGES = ["简体中文", "繁体中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español", "Português", "Русский", "العربية", "ไทย", "हिन्दी"]
const STYLES = [
  ["", "不附加语气"],
  ["Use short sentences.", "短句"],
  ["Keep a formal tone.", "正式"],
  ["Keep a casual tone.", "口语"],
  ["Explain terms a general reader may not know, in the target language.", "顺带解释术语"],
]
const TIMEOUTS = [[30000, "30 秒"], [60000, "60 秒"], [120000, "120 秒"], [180000, "180 秒"], [300000, "300 秒"]]
const LIMITS = [100, 200, 500, 1000]
const SINKS = ["panel", "log", "file", "stdout", "notify", "webhook"]
const AGENTS = [["", "全部 agent"], ["codex", "codex"], ["claude", "claude"], ["pi", "pi"], ["opencode", "opencode"], ["cursor", "cursor"]]

const $ = (id) => document.getElementById(id)
let rules = []
let modelIds = []
let providers = []

function text(value) {
  return typeof value === "string" ? value : ""
}

function loadScript(name) {
  return new Promise((resolve) => {
    const el = document.createElement("script")
    el.src = `${name}?t=${Date.now()}`
    el.onload = () => resolve(true)
    el.onerror = () => resolve(false)
    document.body.appendChild(el)
  })
}

function fillSelect(select, pairs, current) {
  const list = pairs.slice()
  const values = new Set(list.map((pair) => String(pair[0])))
  if (current != null && !values.has(String(current))) list.push([current, String(current)])
  select.replaceChildren()
  for (const [value, label] of list) {
    const opt = document.createElement("option")
    opt.value = String(value)
    opt.textContent = label
    select.append(opt)
  }
  select.value = current == null ? "" : String(current)
}

function knownModels() {
  const cat = globalThis.MAGPIE_TRANSLATOR_CATALOG
  const fromFile = Array.isArray(cat?.models) ? cat.models : []
  const out = []
  for (const id of [...fromFile, ...modelIds]) {
    if (typeof id === "string" && id && !id.includes("*") && !out.includes(id)) out.push(id)
  }
  return out
}

function modelPairs() {
  const pairs = [["", "全部模型"]]
  for (const id of providers) pairs.push([`${id}/*`, `${id} 的全部`])
  for (const id of knownModels()) pairs.push([id, id])
  return pairs
}

function translatorPairs() {
  return knownModels().map((id) => [id, id])
}

async function readLists() {
  const magpie = globalThis.magpie
  if (!magpie?.read) return
  try {
    const listed = await magpie.read("providers:list")
    const rows = Array.isArray(listed) ? listed : []
    providers = rows.map((row) => text(row?.id)).filter(Boolean)
  } catch { /* 目录文件仍可用 */ }
  try {
    const usage = await magpie.read("usage:summary", { period: "30d" })
    const rows = Array.isArray(usage?.models) ? usage.models : []
    for (const row of rows) {
      const id = text(row?.model)
      if (id && !modelIds.includes(id)) modelIds.push(id)
    }
  } catch { /* 没有用量时只用来源目录 */ }
}

function renderDisplay(selected) {
  const box = $("display")
  box.replaceChildren()
  for (const name of SINKS) {
    const label = document.createElement("label")
    const input = document.createElement("input")
    input.type = "checkbox"
    input.value = name
    input.checked = selected.includes(name)
    label.append(input, document.createTextNode(` ${name}`))
    box.append(label)
  }
}

function checkedDisplay() {
  return [...$("display").querySelectorAll("input:checked")].map((el) => el.value)
}

function applyStyle(value) {
  const known = STYLES.some(([id]) => id === value)
  const pairs = STYLES.concat([["custom", "自定义"]])
  fillSelect($("stylePreset"), pairs, known || !value ? value || "" : "custom")
  $("styleCustomWrap").hidden = $("stylePreset").value !== "custom"
  $("styleCustom").value = known || !value ? "" : value
}

function styleValue() {
  if ($("stylePreset").value === "custom") return $("styleCustom").value.trim()
  return $("stylePreset").value
}

function choice(labelText, pairs, value, onChange) {
  const wrap = document.createElement("label")
  wrap.className = "field"
  wrap.append(document.createTextNode(labelText))
  const select = document.createElement("select")
  const input = document.createElement("input")
  input.type = "text"
  const list = pairs.slice()
  if (!list.some(([id]) => id === "custom")) list.push(["custom", "自己填"])
  const known = value == null || value === "" || list.some(([id]) => id === value)
  for (const [id, name] of list) {
    const opt = document.createElement("option")
    opt.value = id
    opt.textContent = name
    select.append(opt)
  }
  select.value = known ? (value || "") : "custom"
  input.value = known ? "" : value
  input.hidden = select.value !== "custom"
  input.placeholder = "自己填"
  const emit = () => onChange(select.value === "custom" ? input.value.trim() : select.value)
  select.addEventListener("change", () => {
    input.hidden = select.value !== "custom"
    emit()
  })
  input.addEventListener("input", emit)
  wrap.append(select, input)
  return wrap
}

function plain(labelText, value, onChange, multiline) {
  const wrap = document.createElement("label")
  wrap.className = "field"
  wrap.append(document.createTextNode(labelText))
  const input = document.createElement(multiline ? "textarea" : "input")
  if (!multiline) input.type = "text"
  input.value = value || ""
  input.addEventListener("input", () => onChange(input.value))
  wrap.append(input)
  return wrap
}

function renderRules() {
  const root = $("rules")
  root.replaceChildren()
  rules.forEach((rule, index) => {
    const card = document.createElement("div")
    card.className = "card"
    const title = document.createElement("p")
    title.textContent = `规则 ${index + 1}`
    card.append(title)
    card.append(choice("Agent", AGENTS, rule.agent || "", (value) => { rule.agent = value }))
    card.append(choice("来源模型", modelPairs(), rule.model || "", (value) => { rule.model = value }))
    card.append(choice("翻译模型", translatorPairs(), rule.translator || "", (value) => { rule.translator = value }))
    const langs = [["", "跟随全局"], ...LANGUAGES.map((name) => [name, name])]
    card.append(choice("语言", langs, rule.language || "", (value) => { rule.language = value }))
    const rewrite = document.createElement("label")
    rewrite.className = "field"
    rewrite.append(document.createTextNode("同语言也改写"))
    const rewriteSelect = document.createElement("select")
    for (const [id, name] of [["", "跟随全局"], ["true", "开"], ["false", "关"]]) {
      const opt = document.createElement("option")
      opt.value = id
      opt.textContent = name
      rewriteSelect.append(opt)
    }
    if (rule.rewriteSameLanguage === true) rewriteSelect.value = "true"
    else if (rule.rewriteSameLanguage === false) rewriteSelect.value = "false"
    rewriteSelect.addEventListener("change", () => {
      if (rewriteSelect.value === "") delete rule.rewriteSameLanguage
      else rule.rewriteSameLanguage = rewriteSelect.value === "true"
    })
    rewrite.append(rewriteSelect)
    card.append(rewrite)
    card.append(plain("这条规则的提示词", rule.prompt || "", (value) => { rule.prompt = value }, true))
    const actions = document.createElement("div")
    const up = document.createElement("button")
    up.type = "button"
    up.textContent = "上移"
    up.disabled = index === 0
    up.addEventListener("click", () => move(index, -1))
    const down = document.createElement("button")
    down.type = "button"
    down.textContent = "下移"
    down.disabled = index === rules.length - 1
    down.addEventListener("click", () => move(index, 1))
    const remove = document.createElement("button")
    remove.type = "button"
    remove.textContent = "删除"
    remove.addEventListener("click", () => {
      rules.splice(index, 1)
      renderRules()
    })
    actions.append(up, down, remove)
    card.append(actions)
    root.append(card)
  })
  if (!rules.length) {
    const empty = document.createElement("p")
    empty.className = "note"
    empty.textContent = "还没有规则。没有规则时什么都不翻译。"
    root.append(empty)
  }
}

function move(index, delta) {
  const next = index + delta
  if (next < 0 || next >= rules.length) return
  const [row] = rules.splice(index, 1)
  rules.splice(next, 0, row)
  renderRules()
}

function cleanRule(rule) {
  const translator = text(rule.translator).trim()
  const out = { translator }
  if (text(rule.agent).trim()) out.agent = rule.agent.trim()
  if (text(rule.model).trim()) out.model = rule.model.trim()
  if (text(rule.language).trim()) out.language = rule.language.trim()
  if (text(rule.prompt).trim()) out.prompt = rule.prompt.trim()
  if (rule.rewriteSameLanguage === true || rule.rewriteSameLanguage === false) out.rewriteSameLanguage = rule.rewriteSameLanguage
  return out
}

function show(options) {
  const language = text(options.language) || "简体中文"
  fillSelect($("language"), LANGUAGES.map((name) => [name, name]), language)
  applyStyle(text(options.style))
  const timeout = Number(options.translateTimeoutMs) || 120000
  fillSelect($("timeout"), TIMEOUTS, timeout)
  const limit = Number(options.historyLimit) || 500
  fillSelect($("historyLimit"), LIMITS.map((n) => [n, String(n)]), limit)
  $("rewrite").checked = options.rewriteSameLanguage === true
  $("localPanel").checked = options.localPanel === true
  const display = Array.isArray(options.display) && options.display.length ? options.display : ["log"]
  renderDisplay(display)
  $("prompt").value = text(options.prompt)
  rules = (Array.isArray(options.rules) ? options.rules : []).map((rule) => ({ ...rule }))
  for (const rule of rules) {
    if (rule.translator && !modelIds.includes(rule.translator)) modelIds.push(rule.translator)
    if (rule.model && !rule.model.includes("*") && rule.model.includes("/") && !modelIds.includes(rule.model)) modelIds.push(rule.model)
  }
  renderRules()
  $("form").hidden = false
}

async function save() {
  const status = $("saveStatus")
  const display = checkedDisplay()
  if (!display.length) {
    status.textContent = "展示至少选一个。"
    return
  }
  const cleaned = rules.map(cleanRule)
  if (cleaned.some((rule) => !rule.translator)) {
    status.textContent = "每条规则都要有翻译模型。"
    return
  }
  const current = await globalThis.magpie.options.get()
  const next = current && typeof current === "object" ? { ...current } : {}
  next.language = $("language").value
  next.prompt = $("prompt").value.trim()
  next.style = styleValue()
  next.display = display
  next.translateTimeoutMs = Number($("timeout").value)
  next.historyLimit = Number($("historyLimit").value)
  next.rewriteSameLanguage = $("rewrite").checked
  next.localPanel = $("localPanel").checked
  next.rules = cleaned
  if (!next.prompt) delete next.prompt
  if (!next.style) delete next.style
  delete next._compare
  $("save").disabled = true
  try {
    await globalThis.magpie.options.set(next)
    status.textContent = "已保存。下一条命中的回复会用新设置。保存会让钩子重载一次。"
  } catch (err) {
    status.textContent = `没有保存：${err?.message || err}`
  } finally {
    setTimeout(() => { $("save").disabled = false }, 1100)
  }
}

async function main() {
  const status = $("status")
  if (!globalThis.magpie) {
    status.textContent = "这一页要在 magpie 里打开。单独用浏览器打开时读不到设置。"
    return
  }
  try {
    await globalThis.magpie.ready
    await loadScript("catalog.js")
    await readLists()
    const options = await globalThis.magpie.options.get()
    show(options && typeof options === "object" ? options : {})
    status.textContent = ""
  } catch (err) {
    status.textContent = `读不到设置：${err?.message || err}`
  }
}

$("stylePreset").addEventListener("change", () => {
  $("styleCustomWrap").hidden = $("stylePreset").value !== "custom"
})
$("resetPrompt").addEventListener("click", () => { $("prompt").value = "" })
$("addRule").addEventListener("click", () => {
  rules.push({ translator: knownModels()[0] || "" })
  renderRules()
})
$("save").addEventListener("click", () => { save() })
main()
