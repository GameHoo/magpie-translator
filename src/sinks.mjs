import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { dataDir, ensureDir, logPath } from "./paths.mjs"

let notifyMissing = false

export async function persistItem(env, item, display, webhookUrl = "") {
  const modes = new Set(display || [])
  if (modes.has("log")) appendLog(env, item)
  if (modes.has("file")) writeLatest(env, item)
  if (modes.has("stdout")) writeStdout(item)
  if (modes.has("notify")) notify(item)
  if (modes.has("webhook") && webhookUrl) await postWebhook(webhookUrl, item)
}

function appendLog(env, item) {
  const row = {
    at: item.at,
    agent: item.agent,
    model: item.model,
    translator: item.translator,
    language: item.language || "",
    protocol: item.protocol,
    session: item.session,
    ok: item.status === "done",
    original: item.original,
    translation: item.status === "done" ? item.translation : "",
    error: item.error || "",
  }
  try {
    ensureDir(dataDir(env))
    fs.appendFileSync(logPath(env), `${JSON.stringify(row)}\n`, { mode: 0o600 })
  } catch { /* 页面或文件出口还在 */ }
}

function writeLatest(env, item) {
  const body = item.status === "error"
    ? `转述失败：${item.error}\n\n原文：\n${item.original}\n`
    : `${item.translation}\n`
  try {
    ensureDir(dataDir(env))
    fs.writeFileSync(path.join(dataDir(env), "latest.txt"), body, { mode: 0o600 })
  } catch { /* 另一个出口还在 */ }
}

function writeStdout(item) {
  const head = [item.agent, item.model, item.language].filter(Boolean).join(" · ") || "转述"
  const body = item.status === "done" ? item.translation : `转述失败：${item.error}`
  console.log(`\n—— 旁路转述 ${head} ——\n${body}\n`)
}

function notify(item) {
  if (notifyMissing) return
  const body = (item.status === "done" ? item.translation : item.error) || ""
  const child = spawn("notify-send", ["旁路转述", body.slice(0, 240)], { stdio: "ignore" })
  child.on("error", () => { notifyMissing = true })
  child.unref?.()
}

async function postWebhook(url, item) {
  const payload = {
    at: item.at,
    agent: item.agent,
    model: item.model,
    translator: item.translator,
    language: item.language || "",
    protocol: item.protocol,
    session: item.session,
    ok: item.status === "done",
    original: item.original,
    translation: item.status === "done" ? item.translation : "",
    error: item.error || "",
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* 展示失败不反过来影响工作模型 */ }
}
