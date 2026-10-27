// 跑在 magpie 网关进程里（moejs），不能 fetch，也不能引用 Node。
// 有的 Responses 流把正文只放在 delta 和 output_item.done 里，
// response.completed 的 output 是空的。这里在完成事件上补上已经拼好的正文，
// 让后面的 Bun onResponse 看得到。Codex 读的是 output_item.done，不从 completed 再画一遍。

export function onEvent(ev, ctx) {
  try {
    if (!ev || typeof ev !== "object" || Array.isArray(ev)) return
    if (!ctx.state || typeof ctx.state !== "object") ctx.state = {}
    const state = ctx.state
    if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
      state.text = `${state.text || ""}${ev.delta}`
      return
    }
    if (ev.type === "response.output_item.done" && ev.item && ev.item.type === "message") {
      const text = itemText(ev.item)
      if (text) state.final = text
      return
    }
    if (ev.type !== "response.completed" && ev.type !== "response.incomplete") return
    const response = ev.response
    if (!response || typeof response !== "object") return
    if (hasAssistantText(response)) return
    const text = state.final || state.text
    if (!text) return
    const output = Array.isArray(response.output) ? response.output.slice() : []
    output.push({
      type: "message",
      role: "assistant",
      status: "completed",
      phase: "final_answer",
      content: [{ type: "output_text", text, annotations: [] }],
    })
    return { ...ev, response: { ...response, output } }
  } catch {
    // 补不上就保持原事件。客户端字节不该因为这里失败而改样。
  }
}

function hasAssistantText(response) {
  const output = Array.isArray(response.output) ? response.output : []
  return output.some((item) => item && item.type === "message" && itemText(item).trim())
}

function itemText(item) {
  if (typeof item.content === "string") return item.content
  if (typeof item.text === "string") return item.text
  if (!Array.isArray(item.content)) return ""
  return item.content.map((part) => {
    if (!part || typeof part !== "object") return ""
    if (typeof part.text === "string") return part.text
    if (typeof part.refusal === "string") return part.refusal
    return ""
  }).join("")
}
