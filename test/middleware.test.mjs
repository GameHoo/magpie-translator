import assert from "node:assert/strict"
import fs from "node:fs"
import { test } from "bun:test"

test("没有 middleware，回复字节不被改写", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.magpie.middleware, undefined)
  assert.equal(fs.existsSync(new URL("../src/middleware.mjs", import.meta.url)), false)
})
