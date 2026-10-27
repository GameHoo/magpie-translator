const $ = (id) => document.getElementById(id)
let entries = []
let models = []
let feedStamp = ""

function loadScript(name) {
  return new Promise((resolve) => {
    const el = document.createElement("script")
    el.src = `${name}?t=${Date.now()}`
    el.onload = () => resolve(true)
    el.onerror = () => resolve(false)
    document.body.appendChild(el)
  })
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]))
}

function rich(text) {
  const fence = "`".repeat(3)
  const parts = String(text ?? "").split(fence)
  let html = ""
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 0) html += escapeHtml(parts[i])
    else {
      const nl = parts[i].indexOf("\n")
      const code = nl === -1 ? parts[i] : parts[i].slice(nl + 1)
      html += `<pre><code>${escapeHtml(code)}</code></pre>`
    }
  }
  return html
}

function when(value) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("zh-CN", { hour12: false })
}

function optionsFrom(values, select) {
  const current = select.value
  const uniq = [...new Set(values.filter(Boolean))]
  select.replaceChildren()
  const all = document.createElement("option")
  all.value = ""
  all.textContent = "全部"
  select.append(all)
  for (const value of uniq) {
    const opt = document.createElement("option")
    opt.value = value
    opt.textContent = value
    select.append(opt)
  }
  if ([...select.options].some((opt) => opt.value === current)) select.value = current
}

function visible() {
  const q = $("q").value.trim().toLowerCase()
  const agent = $("agent").value
  const model = $("model").value
  const translator = $("translator").value
  return entries.filter((entry) => {
    if (agent && entry.agent !== agent) return false
    if (model && entry.model !== model) return false
    if (translator && entry.translator !== translator && !(entry.comparisons || []).some((item) => item.translator === translator)) return false
    if (!q) return true
    const blob = [entry.original, entry.translation, entry.error, entry.agent, entry.model, entry.translator].join("\n").toLowerCase()
    return blob.includes(q)
  })
}

function pane(title, text, error) {
  const wrap = document.createElement("div")
  const heading = document.createElement("p")
  heading.className = "meta"
  heading.textContent = title
  const body = document.createElement("div")
  body.className = "pane"
  if (error) {
    const err = document.createElement("p")
    err.className = "err"
    err.textContent = error
    body.append(err)
  }
  body.insertAdjacentHTML("beforeend", rich(text || ""))
  wrap.append(heading, body)
  return { wrap, body }
}

function bindScroll(panes) {
  let lock = false
  for (const paneNode of panes) {
    paneNode.addEventListener("scroll", () => {
      if (lock) return
      lock = true
      const max = paneNode.scrollHeight - paneNode.clientHeight
      const ratio = max > 0 ? paneNode.scrollTop / max : 0
      for (const other of panes) {
        if (other === paneNode) continue
        const otherMax = other.scrollHeight - other.clientHeight
        other.scrollTop = ratio * otherMax
      }
      lock = false
    })
  }
}

function render() {
  optionsFrom(entries.map((entry) => entry.agent), $("agent"))
  optionsFrom(entries.map((entry) => entry.model), $("model"))
  optionsFrom(entries.flatMap((entry) => [entry.translator, ...(entry.comparisons || []).map((item) => item.translator)]), $("translator"))
  const list = $("list")
  list.replaceChildren()
  const rows = visible()
  if (!rows.length) {
    const empty = document.createElement("p")
    empty.className = "note"
    empty.textContent = entries.length ? "没有符合筛选的记录。" : "还没有转述。命中规则的最终回复会出现在这里。"
    list.append(empty)
    return
  }
  for (const entry of rows) {
    const card = document.createElement("article")
    card.className = "card"
    const meta = document.createElement("p")
    meta.className = "meta"
    const bits = [entry.agent, entry.model, entry.translator, entry.language, entry.ms ? `${entry.ms} ms` : "", when(entry.at), entry.status].filter(Boolean)
    meta.textContent = bits.join(" · ")
    const columns = document.createElement("div")
    columns.className = "pair"
    const left = pane("原文", entry.original, "")
    const right = pane(entry.translator || "译文", entry.translation, entry.error)
    const panes = [left.body, right.body]
    columns.append(left.wrap, right.wrap)
    const extras = entry.comparisons || []
    for (const item of extras) {
      const col = pane(`${item.translator || "对照"} · ${item.ms || 0} ms`, item.translation, item.error)
      columns.append(col.wrap)
      panes.push(col.body)
    }
    if (extras.length) columns.style.gridTemplateColumns = `repeat(${extras.length + 2}, minmax(16rem, 1fr))`
    bindScroll(panes)
    const bar = document.createElement("div")
    bar.className = "row"
    const select = document.createElement("select")
    const blank = document.createElement("option")
    blank.value = ""
    blank.textContent = "换一个模型再译"
    select.append(blank)
    for (const id of models) {
      if (id === entry.translator) continue
      const opt = document.createElement("option")
      opt.value = id
      opt.textContent = id
      select.append(opt)
    }
    const custom = document.createElement("option")
    custom.value = "custom"
    custom.textContent = "自己填一个 id"
    select.append(custom)
    const customInput = document.createElement("input")
    customInput.type = "text"
    customInput.hidden = true
    customInput.placeholder = "provider/model"
    select.addEventListener("change", () => { customInput.hidden = select.value !== "custom" })
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = "对照翻译"
    button.addEventListener("click", () => compare(entry, select.value === "custom" ? customInput.value.trim() : select.value, button))
    bar.append(select, customInput, button)
    card.append(meta, columns, bar)
    list.append(card)
  }
}

async function compare(entry, translator, button) {
  if (!translator) return
  if (!globalThis.magpie?.options) {
    button.textContent = "要在 magpie 里才能再译"
    return
  }
  button.disabled = true
  try {
    const current = await globalThis.magpie.options.get()
    const next = current && typeof current === "object" ? { ...current } : {}
    next._compare = {
      nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      entryId: entry.id,
      translator,
    }
    await globalThis.magpie.options.set(next)
    button.textContent = "已提交，钩子重载后开始"
  } catch (err) {
    button.disabled = false
    button.textContent = `没有提交：${err?.message || err}`
  }
}

function exportVisible() {
  const box = $("export")
  box.hidden = false
  box.value = JSON.stringify(visible(), null, 2)
}

async function refresh() {
  await loadScript("feed.js")
  await loadScript("catalog.js")
  const feed = globalThis.MAGPIE_TRANSLATOR_FEED
  entries = Array.isArray(feed?.entries) ? feed.entries : []
  const cat = globalThis.MAGPIE_TRANSLATOR_CATALOG
  models = Array.isArray(cat?.models) ? cat.models.filter((id) => typeof id === "string" && !id.includes("*")) : []
  $("tools").hidden = false
  $("status").textContent = feed?.at ? `更新于 ${when(feed.at)}` : ""
  const stamp = JSON.stringify(entries)
  if (stamp !== feedStamp) {
    feedStamp = stamp
    render()
  }
}

$("q").addEventListener("input", render)
$("agent").addEventListener("change", render)
$("model").addEventListener("change", render)
$("translator").addEventListener("change", render)
$("exportBtn").addEventListener("click", exportVisible)

async function main() {
  if (!globalThis.magpie) $("status").textContent = "这一页要在 magpie 里打开。记录文件还没生成时，这里是空的。"
  else {
    try { await globalThis.magpie.ready } catch { /* 桥还没好也继续读文件 */ }
  }
  await refresh()
  setInterval(() => { refresh() }, 4000)
}

main()
