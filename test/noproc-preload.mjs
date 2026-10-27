import fs from "node:fs"

function blocked(target) {
  const text = String(target?.path || target || "")
  return text === "/proc" || text.startsWith("/proc/")
}

function deny() {
  const err = new Error("proc is disabled")
  err.code = "ENOENT"
  throw err
}

function wrap(object, name) {
  const orig = object[name]
  if (typeof orig !== "function") return
  object[name] = function wrapped(target, ...args) {
    if (blocked(target)) deny()
    return orig.call(this, target, ...args)
  }
}

for (const name of ["accessSync", "lstatSync", "openSync", "readFileSync", "readlinkSync", "readdirSync", "realpathSync", "statSync"]) {
  wrap(fs, name)
}
for (const name of ["readFile", "readdir", "stat", "lstat", "access", "open", "realpath"]) {
  if (fs.promises) wrap(fs.promises, name)
}

const origKill = process.kill.bind(process)
process.kill = (pid, signal = 0) => {
  if (signal !== 0 && signal !== "SIG0") {
    const err = new Error(`signal ${signal} is disabled`)
    err.code = "ESIGNAL"
    throw err
  }
  return origKill(pid, 0)
}
