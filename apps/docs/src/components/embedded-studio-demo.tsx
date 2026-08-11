"use client"

import { Studio } from "@effect-state-machine/studio-react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Machine from "effect-state-machine/Machine"
import * as React from "react"

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {} },
  Running: { fields: { speed: Schema.Number } },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number } },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: Input, state: State, event: Event })

const definition = runner.make({
  id: "docs-studio-demo",
  description: "A small repeatable machine for the embedded Studio demo.",
  initial: () => ({ _tag: "Idle" }),
  nodes: [
    runner.state("Idle", {
      on: {
        Start: {
          target: "Running",
          reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
        },
      },
    }),
    runner.state("Running", {
      on: {
        Stop: { target: "Idle", reduce: () => ({ _tag: "Idle" }) },
      },
    }),
  ],
})

type DemoHandle = Machine.MachineHandle<
  Machine.MachineState<typeof definition>,
  Machine.MachineEvent<typeof definition>,
  Machine.MachineCompletion<typeof definition>
>

export function EmbeddedStudioDemo() {
  const [handle, setHandle] = React.useState<DemoHandle | undefined>(undefined)

  React.useEffect(() => {
    const scope = Effect.runSync(Scope.make())
    const nextHandle = Effect.runSync(
      Machine.run(definition, {}).pipe(Effect.provideService(Scope.Scope, scope)),
    )
    setHandle(nextHandle)
    return () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [])

  if (handle === undefined) {
    return (
      <div className="my-6 flex h-40 items-center justify-center rounded-lg border bg-fd-card text-sm text-fd-muted-foreground">
        Starting the demo machine…
      </div>
    )
  }

  return (
    <div className="my-6 overflow-hidden rounded-lg border bg-fd-card p-2 shadow-sm">
      <Studio
        machine={{
          definition,
          handle,
          appName: "Documentation playground",
          quickEvents: [
            {
              id: "start",
              label: "Start at 7",
              event: { _tag: "Start", speed: 7 },
            },
            { id: "stop", label: "Stop", event: { _tag: "Stop" } },
          ],
        }}
        style={{ height: 620 }}
      />
    </div>
  )
}
