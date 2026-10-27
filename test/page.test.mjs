import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_TASK_TEMPLATE } from "../src/prompt.mjs"

const dir = join(import.meta.dir, "..", "page")
const read = (f) => readFileSync(join(dir, f), "utf8")
const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"))

test("asks only for the reads it declares, and makes no network calls", () => {
  expect(pkg.magpie.permissions).toEqual(["providers:list", "usage:summary"])
  const reads = new Set()
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const source = read(f)
    for (const m of source.matchAll(/magpie\.read\(\s*"([^"]+)"/g)) reads.add(m[1])
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/)
  }
  expect([...reads].sort()).toEqual([...pkg.magpie.permissions].sort())
})

test("is a page magpie serves: files in page/, scripts as files", () => {
  expect(pkg.main).toBeUndefined()
  expect(pkg.exports).toBeUndefined()
  expect(pkg.magpie.page.file).toBe("page/index.html")
  expect(pkg.magpie.page.icon).toBe("page/icon.svg")
  for (const file of ["index.html", "settings.html"]) {
    const html = read(file)
    expect(html).toContain('<script src="_magpie/bridge.js"></script>')
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(m[1]).toMatch(/\ssrc="/)
      expect(m[2].trim()).toBe("")
    }
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (m[1].startsWith("_magpie/") || m[1].startsWith("#")) continue
      expect(m[1]).not.toMatch(/^(?:[a-z]+:|\/|\.\.)/i)
      expect(readdirSync(dir)).toContain(m[1].split("#")[0].split("?")[0])
    }
  }
})

test("the prompt box shows the English default the hook actually uses", () => {
  expect(read("app.js")).toContain(DEFAULT_TASK_TEMPLATE)
  expect(read("app.js")).not.toContain("你是 {translator}")
  expect(read("style.css")).toContain("--magpie-")
})

test("history actions are options writes, and the feed is read from options", () => {
  const app = read("app.js")
  expect(read("payload.js")).toContain("_compare")
  expect(app).toContain("options.get")
  expect(app).toContain("feed")
  expect(app).toMatch(/data-act="retry"|data-act="compare"/)
  expect(app).toContain("JSON.stringify")
  expect(app).toContain("translatorPageOptions")
  expect(app).toContain("jobError")
  expect(app).toContain("plugins.json changed before this save, so nothing was written. Reload this page and save again.")
  expect(app).toContain("The inbox holds 100 jobs.")
  expect(read("index.html")).toContain('id="droppedNotice"')
  expect(app).not.toContain("...cur")
})
