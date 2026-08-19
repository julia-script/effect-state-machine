import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with ${signal ?? `code ${code ?? 1}`}`))
      }
    })
  })

await run(pnpm, ["run", "build:server"])

const vite = spawn(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" },
)
const server = spawn(process.execPath, ["--env-file=.env.local", "dist/server/main.js"], {
  cwd: root,
  stdio: "inherit",
})
const children = new Set([vite, server])
let shuttingDown = false

const stop = (signal, exitCode) => {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error)
    stop("SIGTERM", 1)
  })
  child.once("exit", (code, signal) => {
    children.delete(child)
    if (!shuttingDown) stop("SIGTERM", code ?? (signal === "SIGINT" ? 130 : 1))
  })
}

process.once("SIGINT", () => stop("SIGINT", 130))
process.once("SIGTERM", () => stop("SIGTERM", 143))
