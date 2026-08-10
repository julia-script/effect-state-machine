import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import { Protocol } from "@effect-state-machine/studio-client"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Server from "./server/Server.js"

/**
 * `effect-state-machine-studio [--port N] [--editor cmd]` — starts the local
 * Studio server and prints the interface URL. Environment fallbacks:
 * STUDIO_PORT, STUDIO_EDITOR.
 */

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const parsePort = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined
}

const port = parsePort(flag("port")) ?? parsePort(process.env.STUDIO_PORT) ?? Protocol.DEFAULT_PORT
const editor = flag("editor") ?? process.env.STUDIO_EDITOR ?? "cursor"

const uiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "ui")

export const main = Layer.launch(
  Server.layer({
    port,
    editor,
    ...(existsSync(uiRoot) ? { uiRoot } : {}),
  }).pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Console.log(
          `Studio running at http://127.0.0.1:${port} — applications connect to ws://127.0.0.1:${port}${Protocol.APP_PATH}`,
        ),
      ),
    ),
  ),
)

NodeRuntime.runMain(main.pipe(Effect.orDie))
