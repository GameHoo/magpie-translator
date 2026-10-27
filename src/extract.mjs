// 从 magpie 异步 hook 拿到的整段回复里取出面向用户的正文。
// 工具调用、推理、以及工具轮里的铺垫句都不取。代码仍留在正文里，后面再用占位符保护。

const RESP_REASONING = new Set(["reasoning", "reasoning_summary"])

export function extractUserText(reply, protocol) {
  const proto = normalizeProtocol(protocol) || detectProtocol(reply)
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return { text: "", skip: "empty", protocol: proto }
  }
  const parts = collectParts(reply, proto)
  parts.forEach((part, index) => { part.index = index })
  const texts = pickTexts(parts, proto)
  let text = texts.map((part) => part.text).join("\n\n")
  if (!text.trim() && proto === "responses" && typeof reply.output_text === "string") text = reply.output_text
  if (!text.trim()) {
    const tools = parts.some((part) => part.kind === "tool")
    return { text: "", skip: tools ? "tool_round" : "no_text", protocol: proto }
  }
  return { text, skip: null, protocol: proto }
}

// Responses：有 phase=final 的正文只留那些。没有这标记时，没有工具就留下非铺垫正文；
// 有工具时只留下最后一个工具调用之后的正文。铺垫句在工具前面，最后一条用户可见的回答在工具后面。
function pickTexts(parts, proto) {
  const texts = parts.filter((part) => part.kind === "text" && part.text && part.phase !== "commentary")
  const finals = texts.filter((part) => part.phase === "final")
  if (finals.length) return finals
  const tools = parts.some((part) => part.kind === "tool")
  if (proto !== "responses") return tools ? [] : texts
  if (!tools) return texts
  const lastTool = parts.reduce((at, part, index) => (part.kind === "tool" ? index : at), -1)
  return texts.filter((part) => part.index > lastTool)
}

export function normalizeProtocol(protocol) {
  const name = String(protocol || "").toLowerCase()
  if (name === "chat" || name === "responses" || name === "anthropic" || name === "gemini") return name
  return ""
}

export function detectProtocol(reply) {
  if (!reply || typeof reply !== "object") return ""
  if (Array.isArray(reply.output) || reply.object === "response") return "responses"
  if (Array.isArray(reply.choices)) return "chat"
  if (Array.isArray(reply.candidates)) return "gemini"
  if (reply.type === "message" && Array.isArray(reply.content)) return "anthropic"
  return ""
}

function collectParts(reply, proto) {
  if (proto === "anthropic") return anthropicParts(reply)
  if (proto === "chat") return chatParts(reply)
  if (proto === "responses") return responsesParts(reply)
  if (proto === "gemini") return geminiParts(reply)
  return []
}

function anthropicParts(reply) {
  const out = []
  const blocks = Array.isArray(reply.content) ? reply.content : []
  for (const block of blocks) {
    const type = block?.type
    if (type === "thinking" || type === "redacted_thinking") {
      out.push({ kind: "reasoning" })
      continue
    }
    if (type === "tool_use" || type === "server_tool_use" || type === "mcp_tool_use" || type === "tool_result") {
      out.push({ kind: "tool" })
      continue
    }
    if (type === "text" && typeof block.text === "string") out.push({ kind: "text", text: block.text, phase: "" })
  }
  if (reply.stop_reason === "tool_use" && !out.some((p) => p.kind === "tool")) out.push({ kind: "tool" })
  return out
}

function chatParts(reply) {
  const message = reply.choices?.[0]?.message
  if (!message || typeof message !== "object") return []
  const out = []
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) out.push({ kind: "tool" })
  if (typeof message.reasoning_content === "string" || typeof message.reasoning === "string") {
    out.push({ kind: "reasoning" })
  }
  if (typeof message.content === "string") out.push({ kind: "text", text: message.content, phase: "" })
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue
      if (part.type === "text" && typeof part.text === "string") out.push({ kind: "text", text: part.text, phase: "" })
      else if (part.type === "refusal" && typeof part.refusal === "string") out.push({ kind: "text", text: part.refusal, phase: "" })
      else if (part.type === "reasoning" || part.type === "thinking") out.push({ kind: "reasoning" })
    }
  }
  const finish = reply.choices?.[0]?.finish_reason
  if (finish === "tool_calls" && !out.some((p) => p.kind === "tool")) out.push({ kind: "tool" })
  return out
}

function responsesParts(reply) {
  const output = Array.isArray(reply.output) ? reply.output : []
  const out = []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const type = String(item.type || "")
    if (RESP_REASONING.has(type)) {
      out.push({ kind: "reasoning" })
      continue
    }
    if (type.endsWith("_call")) {
      out.push({ kind: "tool" })
      continue
    }
    if (type !== "message") continue
    const phase = messagePhase(item)
    const text = messageText(item)
    if (text) out.push({ kind: "text", text, phase })
  }
  return out
}

function messagePhase(item) {
  const phase = String(item.phase || "").toLowerCase().replace(/-/g, "_")
  if (phase === "final_answer" || phase === "final") return "final"
  if (phase === "commentary" || phase === "partial_answer") return "commentary"
  return ""
}

function messageText(item) {
  const bits = []
  if (typeof item.content === "string") bits.push(item.content)
  else if (Array.isArray(item.content)) {
    for (const part of item.content) {
      if (!part || typeof part !== "object") continue
      if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") bits.push(part.text)
      else if (part.type === "refusal" && typeof part.refusal === "string") bits.push(part.refusal)
    }
  }
  if (!bits.length && typeof item.text === "string") bits.push(item.text)
  return bits.join("\n\n")
}

function geminiParts(reply) {
  const parts = reply.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return []
  const out = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    if (part.functionCall || part.function_call) {
      out.push({ kind: "tool" })
      continue
    }
    if (part.thought === true) {
      out.push({ kind: "reasoning" })
      continue
    }
    if (typeof part.text === "string") out.push({ kind: "text", text: part.text, phase: "" })
  }
  return out
}
