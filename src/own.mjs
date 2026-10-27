import { MARKER } from "./constants.mjs"

// 只看 system / instructions / developer。用户正文里偶然出现记号时不当成自己的请求。
export function isOwnRequest(body) {
  if (!body || typeof body !== "object") return false
  return systemChunks(body).some((s) => typeof s === "string" && s.includes(MARKER))
}

function systemChunks(body) {
  const out = []
  if (typeof body.instructions === "string") out.push(body.instructions)
  pushContent(body.system, out)
  const gemini = body.systemInstruction || body.system_instruction
  if (gemini && Array.isArray(gemini.parts)) {
    for (const part of gemini.parts) if (typeof part?.text === "string") out.push(part.text)
  }
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      const role = message?.role
      if (role !== "system" && role !== "developer") continue
      pushContent(message.content, out)
    }
  }
  return out
}

function pushContent(content, out) {
  if (typeof content === "string") out.push(content)
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "string") out.push(block)
      else if (typeof block?.text === "string") out.push(block.text)
    }
  }
}
