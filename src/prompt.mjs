import { DEFAULT_LANGUAGE } from "./config.mjs"
import { MARKER } from "./constants.mjs"

// prompt 替换默认的转述要求。记号和占位符规则始终保留：前者避免翻译请求回环，后者保住代码。
export function systemPrompt({ language, prompt, style } = {}) {
  const lang = typeof language === "string" && language.trim() ? language.trim() : DEFAULT_LANGUAGE
  const task = typeof prompt === "string" && prompt.trim()
    ? prompt.trim()
    : `把用户给出的文字改写成通俗易懂的${lang}。意思与原文一致，不要补充原文没有的信息，不要写前言或总结。`
  const lines = [
    MARKER,
    task,
    "占位符形如 ⟦0⟧、⟦1⟧，代表代码或命令。必须原样保留，包括括号和数字，不要翻译、不要删改、不要换位置。",
    "Placeholders such as ⟦0⟧ and ⟦1⟧ stand for code or commands. Keep each one exactly where it is.",
    "只输出改写后的正文。",
  ]
  if (typeof style === "string" && style.trim()) lines.push(style.trim())
  return lines.join("\n")
}
