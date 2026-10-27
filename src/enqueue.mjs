import path from "node:path"
import fs from "node:fs"
import { DEFAULT_PANEL_PORT } from "./constants.mjs"
import { dataDir, ensureDir, inboxDir } from "./paths.mjs"
import { ensureWorker } from "./worker.mjs"

export function deliver(job, env = process.env) {
  const dir = inboxDir(env)
  ensureDir(dir)
  const file = path.join(dir, `${job.id}.json`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(job), { mode: 0o600 })
  fs.renameSync(tmp, file)
  if (env.MAGPIE_TRANSLATOR_NO_SPAWN !== "1") {
    ensureWorker(env, {
      port: String(job.panelPort || DEFAULT_PANEL_PORT),
      display: Array.isArray(job.display) ? job.display.join(",") : "",
      local: job.localPanel ? "1" : "0",
    })
  }
  return file
}
