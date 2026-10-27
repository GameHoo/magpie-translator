// 默认不遮住代码：原文整段送去转述，回来后再把围栏代码块换回原文。
// 打开 mask 时才换成占位符。mermaid 围栏始终留在原文里，里面的行内代码也不抽走。
// 占位符只有单独占一行时才就地嵌回，避免把代码块塞进一句话中间。

const FENCE = /```([^\n]*)\n[\s\S]*?\n```|```[\s\S]*?```/g
const INLINE = /`[^`\n]+`/g
const PROMPT_LINE = /^[ \t]*\$[ \t]+\S.*$/gm

function fenceLang(info) {
  return String(info || "").trim().split(/\s+/)[0].toLowerCase()
}

function holdMermaid(input) {
  const held = []
  const text = String(input ?? "").replace(FENCE, (raw, info) => {
    if (fenceLang(info) !== "mermaid") return raw
    const token = `\u0000M${held.length}\u0000`
    held.push(raw)
    return token
  })
  return { text, held }
}

function putMermaid(text, held) {
  return held.reduce((out, raw, i) => out.split(`\u0000M${i}\u0000`).join(raw), text)
}

export function maskCode(input, enabled = false) {
  const original = String(input ?? "")
  if (!enabled) return { masked: original, slots: [], prose: original.trim() }
  const parked = holdMermaid(original)
  const slots = []
  const take = (raw) => {
    const token = `⟦${slots.length}⟧`
    slots.push(raw)
    return token
  }
  let text = parked.text
  text = text.replace(FENCE, (raw) => take(raw))
  const open = text.indexOf("```")
  if (open !== -1) text = text.slice(0, open) + take(text.slice(open))
  text = text.replace(INLINE, take)
  text = text.replace(PROMPT_LINE, take)
  text = putMermaid(text, parked.held)
  const prose = text.replace(/⟦\d+⟧/g, "").trim()
  return { masked: text, slots, prose }
}

function escapeReg(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function onOwnLine(text, token) {
  return new RegExp(`(^|\\n)[ \\t]*${escapeReg(token)}[ \\t]*(?=\\n|$)`).test(text)
}

export function restore(translated, slots = []) {
  let out = String(translated ?? "")
  const missing = []
  for (let i = 0; i < slots.length; i += 1) {
    const token = `⟦${i}⟧`
    const slot = slots[i]
    if (!out.includes(token) || !onOwnLine(out, token)) {
      missing.push(slot)
      if (out.includes(token)) out = out.split(token).join("")
      continue
    }
    out = out.replace(new RegExp(`(^|\\n)[ \\t]*${escapeReg(token)}[ \\t]*(?=\\n|$)`), (match, lead) => `${lead}${slot}`)
  }
  if (missing.length) out = `${out.replace(/\s*$/, "")}\n\n${missing.join("\n\n")}\n`
  return out
}

export function keepCode(original, translated) {
  const wanted = [...String(original ?? "").matchAll(FENCE)].map((match) => match[0])
  if (!wanted.length) return String(translated ?? "")
  let index = 0
  let out = String(translated ?? "").replace(FENCE, (raw) => (index < wanted.length ? wanted[index++] : raw))
  while (index < wanted.length) out = `${out.replace(/\s*$/, "")}\n\n${wanted[index++]}\n`
  return out
}
