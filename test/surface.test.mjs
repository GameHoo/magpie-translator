import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

test("magpie 页面和设置面板接到插件清单，页面脚本都在外部文件", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  assert.equal(pkg.magpie.hooks, "./src/hooks.mjs")
  assert.equal(pkg.magpie.middleware, "./src/middleware.mjs")
  assert.equal(pkg.magpie.page.file, "ui/history.html")
  assert.equal(pkg.magpie.page.titles.zh, "翻译记录")
  assert.equal(pkg.magpie.page.icon, "ui/icon-small.svg")
  assert.equal(pkg.magpie.panels[0].slot, "settings")
  assert.equal(pkg.magpie.panels[0].file, "ui/settings.html")
  assert.equal(pkg.magpie.panels[0].titles.zh, "翻译设置")
  assert.equal(pkg.magpie.panels[0].icon, undefined)
  assert.deepEqual(pkg.magpie.permissions, ["providers:list", "usage:summary"])
  assert.equal(pkg.magpie.options.display[0], "log")
  assert.equal(pkg.magpie.options.localPanel, false)
  assert.equal(pkg.magpie.options.rewriteSameLanguage, false)
  assert.equal(pkg.magpie.options.translateTimeoutMs, 120000)
  assert.match(pkg.magpie.icon, /^data:image\/svg\+xml,/)
  const icon = fs.readFileSync(new URL("../ui/icon.svg", import.meta.url), "utf8")
  assert.equal(decodeURIComponent(pkg.magpie.icon.slice("data:image/svg+xml,".length)), icon.trim())
  assert.equal(fs.readFileSync(new URL("../docs/icon.svg", import.meta.url), "utf8"), icon)
  const small = fs.readFileSync(new URL("../ui/icon-small.svg", import.meta.url), "utf8")
  for (const svg of [icon, small]) {
    assert.match(svg, /viewBox="0 0 64 64"/)
    assert.match(svg, /#5b5bd6/)
    assert.equal(svg.includes("currentColor"), false)
    assert.equal(svg.includes("<text"), false)
  }
  assert.match(fs.readFileSync(new URL("../ui/settings.html", import.meta.url), "utf8"), /<img class="logo" src="icon\.svg"/)
  const app = fs.readFileSync(new URL("../ui/app.js", import.meta.url), "utf8")
  assert.match(app, /providers:list/)
  assert.equal(app.includes("fetch("), false)
  for (const file of ["ui/settings.html", "ui/history.html"]) {
    const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
    assert.equal(/<script(?![^>]*\bsrc=)/.test(html), false, file)
    assert.equal(html.includes("onclick="), false, file)
    assert.equal(html.includes("<form"), false, file)
    assert.match(html, /_magpie\/bridge\.js/)
    assert.match(html, /style\.css/)
    assert.match(html, /app\.js/)
  }
  assert.match(fs.readFileSync(new URL("../ui/settings.html", import.meta.url), "utf8"), new RegExp(`v${pkg.version}`))
  assert.match(fs.readFileSync(new URL("../src/middleware.mjs", import.meta.url), "utf8"), /^\/\/|^export/m)
  assert.equal(fs.readFileSync(new URL("../src/middleware.mjs", import.meta.url), "utf8").includes("from "), false)
})
