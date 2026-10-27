import { DEFAULT_LANGUAGE } from "./config.mjs"
import { MARKER } from "./constants.mjs"

// 自定义提示词里可以写这四个占位符。翻译请求发出去之前替换一次，不认识的花括号原样留下。
export const PROMPT_TOKENS = ["language", "style", "model", "translator"]

const TASK_TAIL = "Keep the meaning the same as the original. Do not add information that is not in the original. Do not add a preamble or a summary."

// 设置页提示词框在没改过时显示这一句。保存时仍写成空，翻译时再把 {language} 换成语言名。
export const DEFAULT_TASK_TEMPLATE = `Rewrite the user's text into plain, easy-to-read {language}. ${TASK_TAIL}`

// 空 prompt 用这一句。语言名字直接写进句子，不靠占位符。
export function defaultTask(language) {
  const lang = typeof language === "string" && language.trim() ? language.trim() : DEFAULT_LANGUAGE
  return DEFAULT_TASK_TEMPLATE.replaceAll("{language}", lang)
}

export function fillPlaceholders(template, vars = {}) {
  return String(template ?? "").replace(/\{(language|style|model|translator)\}/g, (token, key) => {
    const value = vars[key]
    return typeof value === "string" ? value : token
  })
}

// prompt 只替换任务句。记号和占位符规则始终保留：前者避免翻译请求回环，后者保住代码。
// 任务句和固定规则都用英文写成。自定义任务句里的 {language} 等占位符在这里展开。
export function systemPrompt({ language, prompt, style, model, translator, slots } = {}) {
  const lang = typeof language === "string" && language.trim() ? language.trim() : DEFAULT_LANGUAGE
  const styleRaw = typeof style === "string" ? style.trim() : ""
  const modelId = typeof model === "string" ? model.trim() : ""
  const translatorId = typeof translator === "string" ? translator.trim() : ""
  const styleFilled = fillPlaceholders(styleRaw, {
    language: lang,
    style: styleRaw,
    model: modelId,
    translator: translatorId,
  })
  const vars = { language: lang, style: styleFilled, model: modelId, translator: translatorId }
  const custom = typeof prompt === "string" && prompt.trim() ? prompt.trim() : ""
  const task = custom ? fillPlaceholders(custom, vars) : defaultTask(lang)
  const lines = [MARKER, task]
  if (Array.isArray(slots) && slots.length) {
    lines.push("Placeholders such as ⟦0⟧ and ⟦1⟧ stand for code or commands. Keep each one exactly where it is, including the brackets and the number. Do not translate, delete, or move them.")
  } else {
    lines.push("Keep fenced code blocks, inline code, and lines that start with $ exactly as they are.")
  }
  lines.push("Output only the rewritten text.")
  if (styleFilled) lines.push(styleFilled)
  return lines.join("\n")
}
