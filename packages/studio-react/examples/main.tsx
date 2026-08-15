import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import { Machine } from "effect-state-machine"
import { createRoot } from "react-dom/client"
import { Studio } from "../src/index.js"

declare const __PROJECT_ROOT__: string

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {} },
  Running: { fields: { speed: Schema.Number } },
  Done: { fields: {} },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number } },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: Input, state: State, event: Event })
const definition = runner.define(
  {
    id: "embedded-runner-example",
    initial: () => ({ _tag: "Idle" }),
  },
  {
    Idle: runner.state({
      Start: {
        target: "Running",
        reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
      },
    }),
    Running: runner.state({
      Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) },
    }),
    Done: runner.final(),
  },
)

const scope = Effect.runSync(Scope.make())
const handle = Effect.runSync(
  Machine.run(definition, {}).pipe(Effect.provideService(Scope.Scope, scope)),
)
const rootElement = document.getElementById("root")
if (rootElement === null) throw new Error("example root element is missing")

createRoot(rootElement).render(
  <Studio
    machine={{
      definition,
      handle,
      projectRoot: __PROJECT_ROOT__,
      quickEvents: [
        { id: "start", label: "Start at 7", event: { _tag: "Start", speed: 7 } },
        { id: "stop", label: "Stop", event: { _tag: "Stop" } },
      ],
    }}
    style={{ height: 640 }}
  />,
)

window.addEventListener("beforeunload", () => {
  Effect.runFork(Scope.close(scope, Exit.void))
})
