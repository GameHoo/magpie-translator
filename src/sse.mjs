// 测试和设计说明用：从客户端实际收到的 SSE 里，还原它会写入会话的那份正文。
// 插件运行时不解析 SSE。magpie 已经把流收成整段回复再交给 onResponse。

export function parseSSE(raw) {
  const events = []
  const text = String(raw || "").replace(/\r\n/g, "\n")
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue
    let event = ""
    const dataLines = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""))
    }
    if (!dataLines.length) continue
    events.push({ event, data: dataLines.join("\n") })
  }
  return events
}

export function encodeSSE(records) {
  return records.map((record) => {
    const head = record.event ? `event: ${record.event}\n` : ""
    const data = typeof record.data === "string" ? record.data : JSON.stringify(record.data)
    return `${head}data: ${data}\n\n`
  }).join("")
}

function jsonEvents(raw) {
  const out = []
  for (const event of parseSSE(raw)) {
    if (event.data === "[DONE]") {
      out.push({ event: event.event, done: true })
      continue
    }
    try {
      out.push({ event: event.event, json: JSON.parse(event.data) })
    } catch {
      out.push({ event: event.event, bad: true })
    }
  }
  return out
}

export function assembleChat(raw) {
  let content = ""
  let reasoning = ""
  let finish = null
  const tools = new Map()
  let sawContent = false
  for (const event of jsonEvents(raw)) {
    const choice = event.json?.choices?.[0]
    if (!choice) continue
    if (choice.finish_reason) finish = choice.finish_reason
    const delta = choice.delta || {}
    if (typeof delta.content === "string") {
      content += delta.content
      sawContent = true
    }
    if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        const index = call.index ?? 0
        const prev = tools.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } }
        if (call.id) prev.id = call.id
        if (call.type) prev.type = call.type
        if (call.function?.name) prev.function.name += call.function.name
        if (typeof call.function?.arguments === "string") prev.function.arguments += call.function.arguments
        tools.set(index, prev)
      }
    }
  }
  const toolCalls = [...tools.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call)
  const message = { role: "assistant", content: sawContent ? content : null }
  if (reasoning) message.reasoning_content = reasoning
  if (toolCalls.length) message.tool_calls = toolCalls
  const hookReply = {
    id: "chatcmpl-assembled",
    object: "chat.completion",
    choices: [{ index: 0, message, finish_reason: finish || (toolCalls.length ? "tool_calls" : "stop") }],
  }
  return { hookReply, message, content, reasoning, toolCalls }
}

export function assembleAnthropic(raw) {
  const blocks = []
  let id = "msg_assembled"
  let model = ""
  let stop = null
  for (const event of jsonEvents(raw)) {
    const body = event.json
    if (!body) continue
    const type = body.type || event.event
    if (type === "message_start" && body.message) {
      id = body.message.id || id
      model = body.message.model || model
    } else if (type === "content_block_start") {
      blocks[body.index] = structuredClone(body.content_block || { type: "text", text: "" })
    } else if (type === "content_block_delta") {
      const block = blocks[body.index]
      const delta = body.delta || {}
      if (!block) continue
      if (delta.type === "text_delta") block.text = (block.text || "") + (delta.text || "")
      else if (delta.type === "thinking_delta") block.thinking = (block.thinking || "") + (delta.thinking || "")
      else if (delta.type === "signature_delta") block.signature = (block.signature || "") + (delta.signature || "")
      else if (delta.type === "input_json_delta") block.input_json = (block.input_json || "") + (delta.partial_json || "")
    } else if (type === "message_delta") {
      stop = body.delta?.stop_reason ?? stop
    }
  }
  const content = blocks.filter(Boolean).map((block) => {
    if (block.type === "tool_use" && typeof block.input_json === "string") {
      let input = {}
      try { input = block.input_json ? JSON.parse(block.input_json) : {} } catch { input = { _raw: block.input_json } }
      return { type: "tool_use", id: block.id, name: block.name, input }
    }
    const { input_json, ...rest } = block
    return rest
  })
  const hookReply = { id, type: "message", role: "assistant", model, content, stop_reason: stop }
  return { hookReply, content }
}

export function assembleResponses(raw) {
  const items = new Map()
  let completed = null
  for (const event of jsonEvents(raw)) {
    const body = event.json
    if (!body) continue
    const type = body.type || event.event
    if (type === "response.output_item.done" && body.item) items.set(body.output_index ?? items.size, body.item)
    if ((type === "response.completed" || type === "response.incomplete") && body.response) completed = body.response
  }
  const ordered = [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item)
  const output = Array.isArray(completed?.output) && completed.output.length ? completed.output : ordered
  const hookReply = completed ? { ...completed, output } : { id: "resp_assembled", object: "response", status: "completed", output: ordered }
  return { hookReply, items: ordered.length ? ordered : output }
}
