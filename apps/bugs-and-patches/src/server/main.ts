import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Config from "./Config.js"
import * as Server from "./Server.js"

const main = Effect.gen(function* () {
  const configuration = yield* Config.fromEnv(process.env)
  const configuredUiRoot = process.env.BUGS_PATCHES_UI_ROOT
  return yield* Layer.launch(
    Server.layer(configuration, {
      host: process.env.BUGS_PATCHES_HOST,
      port:
        process.env.BUGS_PATCHES_PORT === undefined
          ? undefined
          : Number(process.env.BUGS_PATCHES_PORT),
      uiRoot: configuredUiRoot === "" ? undefined : (configuredUiRoot ?? "dist/client"),
    }),
  )
})

NodeRuntime.runMain(main.pipe(Effect.orDie))
