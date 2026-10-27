// 旁路只转述面向用户的最终回复。Codex 的标题、建议、摘要这类侧请求，
// 以及整段就是 JSON 的结构化输出，不进收件箱。

const HELPER_NAME = /title|summary|suggestion|description|prediction|follow[_-]?up|thread_name/i
const HELPER_SOURCE = /^(thread_title|thread_title_reconsideration|thread_description|thread_summary|composer_predictions|guardian_review|memory_consolidation|compact|memgen)$/i
const HELPER_TEXT = [
  /\b(thread|conversation|session)\s+(title|summary|description)\b/i,
  /\bgenerate\s+(a\s+)?(short\s+)?(title|summary|suggestion|description)\b/i,
  /\bsuggest(?:ed|ion)?\s+(a\s+)?(follow[- ]?up|prompt)\b/i,
  /\bcomposer predictions?\b/i,
  /生成.{0,12}(标题|摘要|建议|描述)/,
  /(会话|对话|线程).{0,8}(标题|摘要|描述)/,
  /追问建议/,
]

export function skipReason(request, text) {
  if (requestsStructured(request)) return "structured_output"
  if (isHelperRequest(request)) return "helper"
  if (isPureJson(text)) return "pure_json"
  if (requestHasShape(request) && !hasConversationalTurn(request)) return "no_turn"
  return ""
}

export function isPureJson(text) {
  let raw = String(text || "").trim()
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) raw = fence[1].trim()
  if (!raw.startsWith("{") && !raw.startsWith("[")) return false
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === "object"
  } catch {
    return false
  }
}

function requestsStructured(request) {
  if (!request || typeof request !== "object") return false
  const formats = [
    request.response_format,
    request.responseFormat,
    request.text?.format,
    request.output_format,
    request.output_config?.format,
  ]
  for (const format of formats) {
    if (!format || typeof format !== "object") continue
    const type = String(format.type || "")
    if (type === "json_schema" || type === "json_object") return true
    if (format.json_schema || format.schema) return true
  }
  const gen = request.generationConfig || request.generation_config
  if (gen && typeof gen === "object") {
    const mime = gen.responseMimeType || gen.response_mime_type
    if (mime === "application/json" || gen.responseSchema || gen.response_schema) return true
  }
  return false
}

function isHelperRequest(request) {
  if (!request || typeof request !== "object") return false
  const source = request.metadata?.thread_source || request.metadata?.threadSource || ""
  if (HELPER_SOURCE.test(String(source))) return true
  for (const name of schemaNames(request)) {
    if (HELPER_NAME.test(name)) return true
  }
  return instructionBlocks(request).some((block) => block.length <= 2000 && HELPER_TEXT.some((re) => re.test(block)))
}

function schemaNames(request) {
  const names = []
  const push = (value) => {
    if (typeof value === "string" && value.trim()) names.push(value.trim())
  }
  push(request.text?.format?.name)
  push(request.response_format?.json_schema?.name)
  push(request.response_format?.name)
  push(request.output_format?.name)
  return names
}

function instructionBlocks(request) {
  const out = []
  const push = (value) => {
    if (typeof value === "string" && value.trim()) out.push(value.trim())
    else if (Array.isArray(value)) {
      for (const block of value) {
        if (typeof block === "string") out.push(block)
        else if (typeof block?.text === "string") out.push(block.text)
      }
    }
  }
  push(request.instructions)
  push(request.system)
  if (Array.isArray(request.messages)) {
    for (const message of request.messages) {
      const role = message?.role
      if (role === "system" || role === "developer") push(message.content)
    }
  }
  if (Array.isArray(request.input)) {
    for (const item of request.input) {
      const role = item?.role
      if (role === "system" || role === "developer") push(item.content)
    }
  }
  return out
}

function requestHasShape(request) {
  if (!request || typeof request !== "object") return false
  return request.input != null || request.messages != null || request.contents != null
    || request.instructions != null || request.system != null
}

function hasConversationalTurn(request) {
  if (typeof request.input === "string" && request.input.trim()) return true
  if (Array.isArray(request.input) && request.input.some(isUserItem)) return true
  if (Array.isArray(request.messages) && request.messages.some(isUserItem)) return true
  if (Array.isArray(request.contents) && request.contents.some(isUserItem)) return true
  return false
}

function isUserItem(item) {
  if (!item || typeof item !== "object") return false
  const role = String(item.role || "").toLowerCase()
  if (role !== "user" && role !== "human") return false
  const text = itemText(item.content ?? item.parts ?? item.text)
  return text.trim().length > 0
}

function itemText(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map((part) => {
    if (typeof part === "string") return part
    if (typeof part?.text === "string") return part.text
    return ""
  }).join("")
}
