import assert from "node:assert/strict"
import test from "node:test"
import { extractUserText } from "../src/extract.mjs"
import { onEvent } from "../src/middleware.mjs"

const ANSWER = "线性一致读要求读到的状态不比已经对外确认的写入更旧。Raft 用任期和日志下标来判断。"

test("空的 response.completed 用已经拼好的正文补上，提取器能读到", () => {
  const ctx = { state: {} }
  onEvent({ type: "response.output_item.added", item: { type: "reasoning" } }, ctx)
  onEvent({ type: "response.output_text.delta", delta: ANSWER.slice(0, 12) }, ctx)
  onEvent({ type: "response.output_text.delta", delta: ANSWER.slice(12) }, ctx)
  onEvent({
    type: "response.output_item.done",
    item: { type: "message", role: "assistant", content: [{ type: "output_text", text: ANSWER }] },
  }, ctx)
  const patched = onEvent({
    type: "response.completed",
    response: { id: "resp_1", object: "response", status: "completed", output: [] },
  }, ctx)
  assert.equal(patched.response.output.at(-1).content[0].text, ANSWER)
  const got = extractUserText(patched.response, "responses")
  assert.equal(got.text, ANSWER)
})

test("completed 里已经有正文时不改事件", () => {
  const ctx = { state: { text: "delta only" } }
  const ev = {
    type: "response.completed",
    response: {
      output: [{ type: "message", content: [{ type: "output_text", text: ANSWER }] }],
    },
  }
  assert.equal(onEvent(ev, ctx), undefined)
})
