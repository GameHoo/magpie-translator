import { DEFAULT_LANGUAGE } from "./config.mjs"
import { MARKER } from "./constants.mjs"

// prompt 只替换任务句。记号和占位符规则始终保留：前者避免翻译请求回环，后者保住代码。
// 任务句和固定规则都用英文写成，目标语言只作为名字嵌进去，不另写一套中文指令。
export function systemPrompt({ language, prompt, style } = {}) {
  const lang = typeof language === "string" && language.trim() ? language.trim() : DEFAULT_LANGUAGE
  const task = typeof prompt === "string" && prompt.trim()
    ? prompt.trim()
    : `Rewrite the user's text into plain, easy-to-read ${lang}. Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary.`
  const lines = [
    MARKER,
    task,
    "Placeholders such as ⟦0⟧ and ⟦1⟧ stand for code or commands. Keep each one exactly where it is, including the brackets and the number. Do not translate, delete, or move them.",
    "Output only the rewritten text.",
  ]
  if (typeof style === "string" && style.trim()) lines.push(style.trim())
  return lines.join("\n")
}
