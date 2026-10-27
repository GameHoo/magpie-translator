import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_PANEL_PORT } from "./constants.mjs"
import { dataDir, ensureDir, inboxDir } from "./paths.mjs"

const panelPath = fileURLToPath(new URL("./panel.mjs", import.meta.url))

export function deliver(job, env = process.env) {
  const dir = inboxDir(env)
  ensureDir(dir)
  const file = path.join(dir, `${job.id}.json`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(job), { mode: 0o600 })
  fs.renameSync(tmp, file)
  if (env.MAGPIE_TRANSLATOR_NO_SPAWN !== "1") ensurePanel(job, env)
  return file
}

function ensurePanel(job, env) {
  const port = job.panelPort || DEFAULT_PANEL_PORT
  const home = dataDir(env)
  ensureDir(home)
  const pidfile = path.join(home, "panel.pid")
  if (pidAlive(pidfile)) return
  try { fs.unlinkSync(pidfile) } catch { /* 没有旧 pid */ }
  let fd
  try { fd = fs.openSync(pidfile, "wx", 0o600) } catch { return }
  const child = spawn(process.execPath, [panelPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...env,
      MAGPIE_TRANSLATOR_PORT: String(port),
      MAGPIE_TRANSLATOR_HOME: home,
      MAGPIE_TRANSLATOR_DISPLAY: Array.isArray(job.display) ? job.display.join(",") : "",
      MAGPIE_TRANSLATOR_LOCAL: job.localPanel ? "1" : "0",
    },
  })
  fs.writeSync(fd, String(child.pid))
  fs.closeSync(fd)
  child.unref()
  child.on("error", () => {})
}

function pidAlive(pidfile) {
  try {
    const pid = Number(fs.readFileSync(pidfile, "utf8"))
    if (!pid) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
