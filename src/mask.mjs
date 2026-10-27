// 代码块、行内代码、以 $ 开头的命令行换成占位符再送去转述，回来后按原样嵌回。

const FENCE = /```[^\n]*\n[\s\S]*?\n```|```[\s\S]*?```/g
const INLINE = /`[^`\n]+`/g
const PROMPT_LINE = /^[ \t]*\$[ \t]+\S.*$/gm

export function maskCode(input) {
  const slots = []
  const take = (raw) => {
    const token = `⟦${slots.length}⟧`
    slots.push(raw)
    return token
  }
  let text = String(input ?? "")
  text = text.replace(FENCE, take)
  const open = text.indexOf("```")
  if (open !== -1) text = text.slice(0, open) + take(text.slice(open))
  text = text.replace(INLINE, take)
  text = text.replace(PROMPT_LINE, take)
  const prose = text.replace(/⟦\d+⟧/g, "").trim()
  return { masked: text, slots, prose }
}

export function restore(translated, slots = []) {
  let out = String(translated ?? "")
  const missing = []
  slots.forEach((slot, i) => {
    const token = `⟦${i}⟧`
    if (out.includes(token)) out = out.split(token).join(slot)
    else missing.push(slot)
  })
  if (missing.length) out = `${out.replace(/\s*$/, "")}\n\n${missing.join("\n\n")}`
  return out
}
