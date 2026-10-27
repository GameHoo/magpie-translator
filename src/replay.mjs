// 客户端下一轮会发给原模型的请求。只使用它从上一轮流里记下的内容。
// Codex：record_completed_response_item 把 ResponseItem 写入会话，之后整段 input 再发出
// （ChatGPT 后端还会丢掉 previous_response_id，见 magpie chatgpt_api.go）。
// Claude Code：把 assistant 的 content 块写入会话 JSONL，下一轮放进 messages。
// Chat：把 delta 拼成的 assistant message 放进 messages。

export function codexNextRequest({ model, items, followup, firstUser = "请解释这段行为。" }) {
  return {
    model,
    stream: true,
    store: false,
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: firstUser }] },
      ...items,
      { type: "message", role: "user", content: [{ type: "input_text", text: followup }] },
    ],
  }
}

export function claudeNextRequest({ model, content, followup, firstUser = "请解释这段行为。" }) {
  return {
    model,
    stream: true,
    max_tokens: 1024,
    messages: [
      { role: "user", content: firstUser },
      { role: "assistant", content },
      { role: "user", content: followup },
    ],
  }
}

export function chatNextRequest({ model, message, followup, firstUser = "请解释这段行为。", toolResult }) {
  const messages = [
    { role: "user", content: firstUser },
    message,
  ]
  if (toolResult) messages.push(toolResult)
  messages.push({ role: "user", content: followup })
  return { model, stream: true, messages }
}

export function geminiNextRequest({ model, parts, followup, firstUser = "请解释这段行为。" }) {
  return {
    model,
    contents: [
      { role: "user", parts: [{ text: firstUser }] },
      { role: "model", parts },
      { role: "user", parts: [{ text: followup }] },
    ],
  }
}
