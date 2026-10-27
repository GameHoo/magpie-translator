import assert from "node:assert/strict"
import test from "node:test"
import { matchRule } from "../src/match.mjs"

test("按 agent 和模型命中第一条规则", () => {
  const options = {
    rules: [
      { agent: "codex", model: "gpt-5.4", translator: "deepseek/deepseek-chat" },
      { agent: "claude", model: "claude-*", translator: "gemini/gemini-2.5-flash" },
    ],
  }
  assert.equal(matchRule(options, { agent: "codex", model: "openai/gpt-5.4" }).translator, "deepseek/deepseek-chat")
  assert.equal(matchRule(options, { agent: "Codex", model: "gpt-5.4" }).translator, "deepseek/deepseek-chat")
  assert.equal(matchRule(options, { agent: "claude", model: "anthropic/claude-opus-4-7" }).translator, "gemini/gemini-2.5-flash")
  assert.equal(matchRule(options, { agent: "codex", model: "gpt-5.4-mini" }), null)
  assert.equal(matchRule(options, { agent: "opencode", model: "gpt-5.4" }), null)
})

test("省略 agent 或 model 表示不限制这一维", () => {
  const options = { rules: [{ model: "gpt-5*", translator: "deepseek/deepseek-chat" }] }
  assert.equal(matchRule(options, { agent: "claude", model: "gpt-5.4" }).translator, "deepseek/deepseek-chat")
  assert.equal(matchRule(options, { agent: "codex", model: "openai/gpt-5.4-mini" }).translator, "deepseek/deepseek-chat")
  assert.equal(matchRule({ rules: [{ agent: "codex", translator: "x/y" }] }, { agent: "codex", model: "anything" }).translator, "x/y")
})

test("任意 provider/model 字符串都能当工作模型和翻译模型", () => {
  const options = {
    rules: [
      { model: "grok/grok-4", translator: "community-plugin/brand-new-model" },
      { agent: "opencode", translator: "my-relay/whatever-2099" },
    ],
  }
  assert.equal(matchRule(options, { agent: "codex", model: "grok/grok-4" }).translator, "community-plugin/brand-new-model")
  assert.equal(matchRule(options, { agent: "opencode", model: "not-listed-yet" }).translator, "my-relay/whatever-2099")
})

test("没有规则、规则不是数组、或没有 translator 时不转述", () => {
  assert.equal(matchRule({}, { agent: "codex", model: "gpt-5.4" }), null)
  assert.equal(matchRule({ rules: {} }, { model: "gpt-5.4" }), null)
  assert.equal(matchRule({ rules: [{ model: "gpt-5.4" }] }, { model: "gpt-5.4" }), null)
  assert.equal(matchRule({ rules: [] }, { model: "gpt-5.4" }), null)
})
