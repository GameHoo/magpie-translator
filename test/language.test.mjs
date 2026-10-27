import assert from "node:assert/strict"
import { test } from "bun:test"
import { sameLanguage } from "../src/language.mjs"

test("简体中文和英文能认出来，认不出的语言不跳过", () => {
  assert.equal(sameLanguage("你用的是什么模型？", "简体中文"), true)
  assert.equal(sameLanguage("解释 Raft 线性一致读机制，读到的状态不能更旧。", "简体中文"), true)
  assert.equal(sameLanguage("The cache invalidates when the file mtime changes.", "English"), true)
  assert.equal(sameLanguage("The cache invalidates when the file mtime changes.", "简体中文"), false)
  assert.equal(sameLanguage("Bonjour le monde entier ici aujourd'hui.", "Français"), false)
  assert.equal(sameLanguage("你好", "简体中文"), false)
  assert.equal(sameLanguage("The cache invalidates when the file mtime changes.", "Klingon"), false)
  assert.equal(sameLanguage("這是繁體中文的說明文字。", "繁体中文"), true)
  assert.equal(sameLanguage("这是简体中文的说明文字。", "繁体中文"), false)
})
