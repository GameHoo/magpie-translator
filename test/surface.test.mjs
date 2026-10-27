import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

test("magpie 页面和设置面板接到插件清单，页面脚本都在外部文件", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.magpie.hooks, "./src/hooks.mjs")
  assert.equal(pkg.magpie.middleware, "./src/middleware.mjs")
  assert.equal(pkg.magpie.page.file, "ui/history.html")
  assert.equal(pkg.magpie.page.icon, "ui/icon.svg")
  assert.equal(pkg.magpie.panels[0].slot, "settings")
  assert.equal(pkg.magpie.panels[0].file, "ui/settings.html")
  assert.deepEqual(pkg.magpie.permissions, ["providers:list", "usage:summary"])
  assert.equal(pkg.magpie.options.display[0], "log")
  assert.equal(pkg.magpie.options.localPanel, false)
  assert.equal(pkg.magpie.options.rewriteSameLanguage, false)
  assert.equal(pkg.magpie.options.translateTimeoutMs, 120000)
  assert.match(pkg.magpie.icon, /^data:image\/svg\+xml,/)
  for (const file of ["ui/settings.html", "ui/history.html"]) {
    const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.equal(/<script(?![^>]*\bsrc=)/.test(html), false, file)
    assert.equal(html.includes("onclick="), false, file)
  }
  assert.equal(fs.existsSync(new URL("../ui/icon.svg", import.meta.url)), true)
  assert.match(fs.readFileSync(new URL("../src/middleware.mjs", import.meta.url), "utf8"), /^\/\/|^export/m)
  assert.equal(fs.readFileSync(new URL("../src/middleware.mjs", import.meta.url), "utf8").includes("from "), false)
})
