export const SETTINGS_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>转述设置</title>
<style>
  :root {
    --ink: #1c1915;
    --muted: #6b6258;
    --paper: #f3eee4;
    --card: #fffaf3;
    --line: #e2d8c8;
    --seal: #9c2f2f;
    --ok: #2f6b4f;
    --warn: #8a5a12;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--ink);
    background:
      radial-gradient(1200px 400px at 10% -10%, #f7e7d2 0%, transparent 55%),
      var(--paper);
    font-family: "Iowan Old Style", Palatino, "Palatino Linotype", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif;
    line-height: 1.5;
  }
  header, main, footer { width: min(920px, calc(100% - 32px)); margin: 0 auto; }
  header { padding: 28px 0 8px; }
  a { color: var(--seal); }
  h1 { font-size: 36px; font-weight: 560; margin: 8px 0; letter-spacing: 0.04em; }
  h2 { font-size: 22px; margin: 22px 0 8px; font-weight: 560; }
  header p, .note, footer { color: var(--muted); }
  header p { margin: 0; max-width: 68ch; }
  label { display: block; margin: 12px 0 6px; font-family: ui-sans-serif, "Noto Sans CJK SC", sans-serif; font-size: 13px; }
  input[type="text"], textarea {
    width: 100%;
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 12px;
    padding: 8px 10px;
    font: inherit;
    color: inherit;
  }
  textarea { min-height: 7.5em; resize: vertical; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 12px; }
  [hidden] { display: none !important; }
  .checks { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 6px 0 2px; }
  .checks label { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; }
  button, .linkish {
    border: 1px solid var(--line);
    background: transparent;
    border-radius: 999px;
    padding: 4px 12px;
    font: inherit;
    font-size: 13px;
    font-family: ui-sans-serif, sans-serif;
    cursor: pointer;
    color: inherit;
  }
  button.primary { background: var(--ink); color: #fffaf3; border-color: var(--ink); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  article {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 14px 14px 10px;
    margin: 12px 0;
  }
  .status { min-height: 1.4em; font-family: ui-sans-serif, sans-serif; font-size: 14px; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--seal); }
  code { font-family: ui-monospace, monospace; font-size: 12.5px; }
  footer { margin: 8px auto 36px; font-size: 13px; font-family: ui-sans-serif, sans-serif; }
  @media (max-width: 720px) {
    .grid { grid-template-columns: 1fr; }
    h1 { font-size: 30px; }
  }
</style>
</head>
<body>
<header>
  <a href="/">回到转述</a>
  <h1>设置</h1>
  <p>这里改的是 magpie 的 plugins.json，和命令行 <code>magpie plugin options</code> 同一份。保存后正在运行的 magpie 会在下一轮请求用上新配置，不用重启。已经开始的那一轮仍用旧配置。</p>
</header>
<main>
  <p id="missing" class="status err" hidden></p>
  <form id="form" hidden>
    <p class="note" id="where"></p>
    <h2>全局</h2>
    <label for="language">目标语言</label>
    <input id="language" type="text" autocomplete="off" placeholder="简体中文">
    <p class="note">留空就是默认的简体中文。也可以写成 English、日本語、Français，或任何一个人读得懂的名字。</p>
    <label for="prompt">自定义提示词</label>
    <textarea id="prompt" spellcheck="false"></textarea>
    <div class="actions">
      <button type="button" id="reset-prompt">恢复默认</button>
    </div>
    <p class="note">留空，或点恢复默认，就用下面这句默认任务句。默认句把语言名字直接写进去。</p>
    <p class="note" id="default-task"></p>
    <p class="note">自定义提示词里可以写四个占位符，发给翻译模型前替换一次：<code>{language}</code> 目标语言，<code>{style}</code> 这一轮的 style，<code>{model}</code> 工作模型，<code>{translator}</code> 翻译模型。不认识的花括号原样保留。内部记号、代码占位符那一句，以及 Output only the rewritten text. 这三样始终留着，页面改不掉。</p>
    <label for="style">style</label>
    <textarea id="style" spellcheck="false"></textarea>
    <p class="note">追加在任务句后面的一句口气。最长 4000 字。里面同样可以写上面四个占位符。</p>
    <label>展示方式</label>
    <div class="checks" id="global-display"></div>
    <div id="webhook-wrap">
      <label for="webhook">webhookUrl</label>
      <input id="webhook" type="text" autocomplete="off" placeholder="https://example.invalid/hook">
    </div>
    <h2>规则</h2>
    <p class="note">按从上到下的顺序，第一条命中的生效。agent 留空表示所有客户端，整词、不区分大小写。model 留空表示所有模型；不带星号是整段相等，末尾加 * 才是前缀。翻译模型从 magpie 列出来的 id 里选，也可以直接手填一个列表里没有的 id。</p>
    <p class="note" id="model-note"></p>
    <div id="rules"></div>
    <div class="actions">
      <button type="button" id="add-rule">添加规则</button>
    </div>
    <div class="actions">
      <button type="button" class="primary" id="save">保存</button>
    </div>
    <p class="status" id="status" role="status"></p>
    <p class="note" id="kept"></p>
  </form>
</main>
<footer>只监听 127.0.0.1。别的网站打不开这个保存接口。</footer>
<datalist id="model-list"></datalist>
<script>
const DISPLAYS = [
  ["panel", "本机页面"],
  ["log", "日志"],
  ["file", "latest.txt"],
  ["stdout", "终端输出"],
  ["notify", "桌面通知"],
  ["webhook", "webhook"]
]
let csrf = ""
let draft = null
let models = []

function defaultTask(name) {
  const lang = String(name || "").trim() || "简体中文"
  return "Rewrite the user's text into plain, easy-to-read " + lang + ". Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary."
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]))
}

function checks(selected) {
  return DISPLAYS.map(([name, label]) => {
    const on = selected.includes(name) ? " checked" : ""
    return '<label><input type="checkbox" value="' + name + '"' + on + "> " + label + "</label>"
  }).join("")
}

function blankRule() {
  return { agent: "", model: "", translator: "", language: "", prompt: "", style: "", display: null, webhookUrl: "", extra: {} }
}

function sync() {
  if (!draft) return
  draft.language = document.querySelector("#language").value
  draft.prompt = document.querySelector("#prompt").value
  draft.style = document.querySelector("#style").value
  draft.webhookUrl = document.querySelector("#webhook").value
  draft.display = [...document.querySelectorAll("#global-display input:checked")].map((node) => node.value)
  document.querySelectorAll("article.rule").forEach((node) => {
    const rule = draft.rules[Number(node.dataset.i)]
    if (!rule) return
    for (const key of ["agent", "model", "translator", "language", "prompt", "style", "webhookUrl"]) {
      const field = node.querySelector('[data-k="' + key + '"]')
      if (field) rule[key] = field.value
    }
    const inherit = node.querySelector("[data-k=inherit]").checked
    rule.display = inherit ? null : [...node.querySelectorAll("[data-k=display]:checked")].map((item) => item.value)
  })
}

function paintGlobals() {
  document.querySelector("#language").value = draft.language
  document.querySelector("#prompt").value = draft.prompt
  document.querySelector("#style").value = draft.style
  document.querySelector("#webhook").value = draft.webhookUrl
  document.querySelector("#global-display").innerHTML = checks(draft.display)
  document.querySelector("#where").textContent = (draft.off ? "这条插件目前是关的，保存只会写入配置，magpie 不会跑它。" : "写入 ") + draft.file + " 里的 " + draft.spec
  const kept = draft.preserved && draft.preserved.length ? draft.preserved.join("、") : "没有"
  document.querySelector("#kept").textContent = "保存时原样留下、不在这个表单里的字段：" + kept + "。"
  refreshPreview()
  toggleWebhook()
}

function refreshPreview() {
  const lang = document.querySelector("#language").value
  document.querySelector("#default-task").textContent = "默认任务句：" + defaultTask(lang)
}

function toggleWebhook() {
  const on = [...document.querySelectorAll("#global-display input:checked")].some((node) => node.value === "webhook")
    || draft.rules.some((rule) => Array.isArray(rule.display) && rule.display.includes("webhook"))
  document.querySelector("#webhook-wrap").hidden = !on && !document.querySelector("#webhook").value
}

function renderRules() {
  const root = document.querySelector("#rules")
  root.innerHTML = draft.rules.map((rule, i) => {
    const inherit = rule.display == null
    const selected = inherit ? [] : rule.display
    return '<article class="rule" data-i="' + i + '">'
      + "<h2>规则 " + (i + 1) + "</h2>"
      + '<div class="grid">'
      + field("agent", "agent", rule.agent, "留空表示所有客户端")
      + field("model", "model", rule.model, "留空表示所有模型，末尾 * 表示前缀")
      + field("translator", "翻译模型", rule.translator, "provider/model，可手填", true)
      + "</div>"
      + field("language", "这条规则的目标语言", rule.language, "留空则用全局")
      + area("prompt", "这条规则的提示词", rule.prompt)
      + '<div class="actions"><button type="button" data-act="reset">恢复默认</button></div>'
      + area("style", "这条规则的 style", rule.style)
      + '<label><input type="checkbox" data-k="inherit"' + (inherit ? " checked" : "") + "> 展示方式沿用全局</label>"
      + '<div class="checks" data-displays' + (inherit ? " hidden" : "") + ">" + checks(selected).replaceAll('type="checkbox"', 'type="checkbox" data-k="display"') + "</div>"
      + field("webhookUrl", "这条规则的 webhookUrl", rule.webhookUrl, "留空则用全局")
      + '<div class="actions">'
      + '<button type="button" data-act="up"' + (i === 0 ? " disabled" : "") + ">上移</button>"
      + '<button type="button" data-act="down"' + (i === draft.rules.length - 1 ? " disabled" : "") + ">下移</button>"
      + '<button type="button" data-act="del">删除</button>'
      + "</div></article>"
  }).join("")
  toggleWebhook()
}

function field(key, label, value, placeholder, list) {
  const listAttr = list ? ' list="model-list"' : ""
  return '<label>' + label + '<input data-k="' + key + '" type="text" autocomplete="off"' + listAttr + ' placeholder="' + escapeHtml(placeholder) + '" value="' + escapeHtml(value) + '"></label>'
}

function area(key, label, value) {
  return '<label>' + label + '<textarea data-k="' + key + '" spellcheck="false">' + escapeHtml(value) + "</textarea></label>"
}

function fillModels(error) {
  document.querySelector("#model-list").innerHTML = models.map((id) => '<option value="' + escapeHtml(id) + '"></option>').join("")
  if (error && !models.length) {
    document.querySelector("#model-note").textContent = "模型列表没有取到：" + error + "。翻译模型可以手填。"
    return
  }
  document.querySelector("#model-note").textContent = models.length
    ? "当前可选 " + models.length + " 个模型 id，下拉没有的也可以在翻译模型一栏手填。"
    : "还没有取到 magpie 的模型列表。翻译模型一栏可以直接手填 provider/model。"
}

function payload() {
  sync()
  return {
    language: draft.language,
    prompt: draft.prompt,
    style: draft.style,
    display: draft.display,
    webhookUrl: draft.webhookUrl,
    rules: draft.rules.map((rule) => ({
      ...(rule.extra || {}),
      agent: rule.agent,
      model: rule.model,
      translator: rule.translator,
      language: rule.language,
      prompt: rule.prompt,
      style: rule.style,
      display: rule.display,
      webhookUrl: rule.webhookUrl
    }))
  }
}

function say(text, ok) {
  const node = document.querySelector("#status")
  node.textContent = text
  node.className = "status " + (ok ? "ok" : "err")
}

document.querySelector("#form").addEventListener("input", (ev) => {
  if (ev.target && ev.target.id === "language") refreshPreview()
  if (ev.target && ev.target.dataset && ev.target.dataset.k === "inherit") {
    sync()
    renderRules()
  } else {
    sync()
    toggleWebhook()
  }
})

document.querySelector("#reset-prompt").addEventListener("click", () => {
  document.querySelector("#prompt").value = ""
  sync()
  say("提示词已清空。保存后使用默认任务句。", true)
})

document.querySelector("#add-rule").addEventListener("click", () => {
  sync()
  draft.rules.push(blankRule())
  renderRules()
})

document.querySelector("#rules").addEventListener("click", (ev) => {
  const button = ev.target.closest("button")
  if (!button) return
  const article = button.closest("article")
  if (!article) return
  const index = Number(article.dataset.i)
  sync()
  if (button.dataset.act === "reset") {
    draft.rules[index].prompt = ""
    renderRules()
    return
  }
  if (button.dataset.act === "del") draft.rules.splice(index, 1)
  if (button.dataset.act === "up" && index > 0) {
    const [item] = draft.rules.splice(index, 1)
    draft.rules.splice(index - 1, 0, item)
  }
  if (button.dataset.act === "down" && index < draft.rules.length - 1) {
    const [item] = draft.rules.splice(index, 1)
    draft.rules.splice(index + 1, 0, item)
  }
  renderRules()
})

document.querySelector("#save").addEventListener("click", async () => {
  say("正在保存…", true)
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-magpie-translator-csrf": csrf },
      body: JSON.stringify(payload())
    })
    const body = await res.json()
    if (!res.ok) {
      say(body.error || "没有保存", false)
      return
    }
    draft.preserved = body.preserved || []
    draft.language = body.options.language
    draft.prompt = body.options.prompt
    draft.style = body.options.style
    draft.display = body.options.display
    draft.webhookUrl = body.options.webhookUrl
    draft.rules = body.options.rules
    paintGlobals()
    renderRules()
    const verb = body.changed ? "已写入，下一轮请求生效。" : "和磁盘上的配置一样，没有改文件。"
    say(verb, true)
  } catch (err) {
    say(String(err && err.message || err), false)
  }
})

async function boot() {
  const res = await fetch("/api/settings")
  const body = await res.json()
  csrf = body.csrf || ""
  if (!body.found) {
    const missing = document.querySelector("#missing")
    missing.hidden = false
    missing.textContent = body.error || "没有找到插件配置"
    return
  }
  draft = body.options
  draft.file = body.file
  draft.spec = body.spec
  draft.off = body.off
  draft.rules = (draft.rules || []).map((rule) => ({ ...blankRule(), ...rule, extra: rule.extra || {} }))
  document.querySelector("#form").hidden = false
  paintGlobals()
  renderRules()
  try {
    const listed = await (await fetch("/api/models")).json()
    models = listed.models || []
    fillModels(listed.error || "")
  } catch (err) {
    fillModels(err && err.message || err)
  }
}
boot()
</script>
</body>
</html>
`
