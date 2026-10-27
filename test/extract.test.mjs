import assert from "node:assert/strict"
import { test } from "bun:test"
import { extractUserText } from "../src/extract.mjs"
import { maskCode, restore } from "../src/mask.mjs"

const prose = "The cache invalidates when the file mtime changes.\n\n```bash\nstat -c %Y file\n```\n\nRun that when the entry looks stale."

test("Anthropic 最终回复只留文字，思考块不进入转述", () => {
  const got = extractUserText({
    type: "message",
    role: "assistant",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "Check the inode mtime.", signature: "sig-original" },
      { type: "text", text: prose },
    ],
  }, "anthropic")
  assert.equal(got.skip, null)
  assert.equal(got.text, prose)
  assert.equal(got.text.includes("Check the inode"), false)
})

test("带工具调用的一轮不转述，工具参数也不会被抽出来", () => {
  const got = extractUserText({
    type: "message",
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "I'll check the mtime." },
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "stat -c %Y file" } },
    ],
  }, "anthropic")
  assert.equal(got.skip, "tool_round")
  assert.equal(got.text, "")
})

test("Chat 最终回复忽略 reasoning_content，工具轮整段跳过", () => {
  const final = extractUserText({
    choices: [{ message: { role: "assistant", content: prose, reasoning_content: "hidden thought" }, finish_reason: "stop" }],
  }, "chat")
  assert.equal(final.text, prose)
  const tool = extractUserText({
    choices: [{
      finish_reason: "tool_calls",
      message: {
        content: "I'll check the mtime.",
        tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: "{\"command\":\"stat -c %Y file\"}" } }],
      },
    }],
  }, "chat")
  assert.equal(tool.skip, "tool_round")
})

test("Responses 只取 final_answer，推理和工具调用都跳过", () => {
  const reply = {
    object: "response",
    status: "completed",
    output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "hidden thought" }] },
      { type: "function_call", name: "bash", arguments: "{\"command\":\"ls\"}", call_id: "c1" },
      { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Looking now." }] },
      { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: prose }] },
    ],
  }
  const got = extractUserText(reply, "responses")
  assert.equal(got.text, prose)
  assert.equal(got.text.includes("Looking now"), false)
  assert.equal(got.text.includes("hidden thought"), false)
})

test("Codex 主回合：推理条目后面的 message 没有 phase 也要留下", () => {
  const text = "线性一致读要求读到的状态不比已经对外确认的写入更旧。"
  const got = extractUserText({
    object: "response",
    status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "先想清楚 quorum" }] },
      { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] },
    ],
  }, "responses")
  assert.equal(got.text, text)
  assert.equal(got.text.includes("quorum"), false)
})

test("工具调用之后的 Responses 正文留下，工具前面的铺垫丢掉", () => {
  const got = extractUserText({
    output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "hidden" }] },
      { type: "message", phase: "commentary", content: [{ type: "output_text", text: "Looking now." }] },
      { type: "function_call", name: "bash", call_id: "c1", arguments: "{}" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "The read is linearizable." }] },
    ],
  }, "responses")
  assert.equal(got.text, "The read is linearizable.")
  assert.equal(got.text.includes("Looking now"), false)
})

test("只有铺垫句、后面跟着工具时不转述", () => {
  const got = extractUserText({
    output: [
      { type: "message", phase: "commentary", content: [{ type: "output_text", text: "Looking now." }] },
      { type: "function_call", name: "bash", call_id: "c1", arguments: "{}" },
    ],
  }, "responses")
  assert.equal(got.skip, "tool_round")
  assert.equal(got.text, "")
})

test("没有 final_answer 标记、也没有工具时，Responses 正文仍然转述", () => {
  const got = extractUserText({
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Plain answer." }] }],
  }, "responses")
  assert.equal(got.text, "Plain answer.")
})

test("Gemini 跳过 thought，有 functionCall 时不转述", () => {
  const got = extractUserText({
    candidates: [{ content: { parts: [{ thought: true, text: "hidden" }, { text: "可见的回答。" }] }, finishReason: "STOP" }],
  }, "gemini")
  assert.equal(got.text, "可见的回答。")
  const tool = extractUserText({
    candidates: [{ content: { parts: [{ text: "我去看一下。" }, { functionCall: { name: "bash", args: { command: "ls" } } }] } }],
  }, "gemini")
  assert.equal(tool.skip, "tool_round")
})

test("代码块、行内代码和 $ 命令行原样嵌回，模型漏掉占位符时补在末尾", () => {
  const masked = maskCode("See `stat` then\n\n```bash\nstat -c %Y file\n```\n\n$ npm test\n\nDone.")
  assert.equal(masked.masked.includes("stat -c %Y file"), false)
  assert.equal(masked.masked.includes("`stat`"), false)
  assert.equal(masked.masked.includes("$ npm test"), false)
  assert.match(masked.masked, /⟦0⟧/)
  assert.match(masked.prose, /See/)
  const back = restore(`先看 ${masked.slots.map((_, i) => `⟦${i}⟧`).join("，")}，就好。`, masked.slots)
  assert.match(back, /`stat`/)
  assert.match(back, /stat -c %Y file/)
  assert.match(back, /\$ npm test/)
  const dropped = restore("只剩白话。", masked.slots)
  assert.match(dropped, /只剩白话/)
  assert.match(dropped, /stat -c %Y file/)
  assert.match(dropped, /\$ npm test/)
})

test("只有代码时 prose 为空，调用方不应送去转述", () => {
  const masked = maskCode("```js\nconst x = 1\n```")
  assert.equal(masked.prose, "")
})
