"use client"

import { Studio, type StudioMachine } from "@effect-state-machine/studio-react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import type * as Machine from "effect-state-machine/Machine"
import * as React from "react"
import {
  childDefinition,
  childQuickEvents,
  childStart,
  classifierDefinition,
  classifierQuickEvents,
  classifierStart,
  counterDefinition,
  counterQuickEvents,
  counterStart,
  parallelDefinition,
  parallelQuickEvents,
  parallelStart,
  profileDefinition,
  profileQuickEvents,
  profileStart,
  retryDefinition,
  retryQuickEvents,
  retryStart,
  runnerDefinition,
  runnerQuickEvents,
  runnerStart,
} from "./studio-example-machines"

interface Tagged {
  readonly _tag: string
}

interface ScopedStudioProps<State extends Tagged, Event extends Tagged, Completion extends State> {
  readonly start: Effect.Effect<Machine.MachineHandle<State, Event, Completion>, never, Scope.Scope>
  readonly machine: Omit<StudioMachine<State, Event>, "handle">
  readonly loadingLabel: string
}

function ScopedStudio<State extends Tagged, Event extends Tagged, Completion extends State>({
  start,
  machine,
  loadingLabel,
}: ScopedStudioProps<State, Event, Completion>) {
  const [handle, setHandle] = React.useState<
    Machine.MachineHandle<State, Event, Completion> | undefined
  >(undefined)

  React.useEffect(() => {
    const scope = Effect.runSync(Scope.make())
    const nextHandle = Effect.runSync(start.pipe(Effect.provideService(Scope.Scope, scope)))
    setHandle(nextHandle)
    return () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    }
  }, [start])

  if (handle === undefined) {
    return (
      <div className="my-6 flex h-40 items-center justify-center rounded-lg border bg-fd-card text-sm text-fd-muted-foreground">
        {loadingLabel}
      </div>
    )
  }

  return (
    <div className="my-6 overflow-hidden rounded-lg border bg-fd-card p-2 shadow-sm">
      <Studio
        machine={{
          ...machine,
          handle,
        }}
        style={{ height: 620 }}
      />
    </div>
  )
}

export type StudioExample =
  | "runner"
  | "counter"
  | "guards"
  | "invoke"
  | "retry"
  | "child"
  | "parallel"

export function MachineStudioDemo({ example }: { readonly example: StudioExample }) {
  switch (example) {
    case "runner":
      return (
        <ScopedStudio
          start={runnerStart}
          machine={{
            definition: runnerDefinition,
            appName: "Embedded Studio tutorial",
            quickEvents: runnerQuickEvents,
          }}
          loadingLabel="Starting the runner machine…"
        />
      )
    case "counter":
      return (
        <ScopedStudio
          start={counterStart}
          machine={{
            definition: counterDefinition,
            appName: "Counter tutorial",
            quickEvents: counterQuickEvents,
          }}
          loadingLabel="Starting the counter machine…"
        />
      )
    case "guards":
      return (
        <ScopedStudio
          start={classifierStart}
          machine={{
            definition: classifierDefinition,
            appName: "Guarded classifier guide",
            quickEvents: classifierQuickEvents,
          }}
          loadingLabel="Starting the classifier machine…"
        />
      )
    case "invoke":
      return (
        <ScopedStudio
          start={profileStart}
          machine={{
            definition: profileDefinition,
            appName: "Invoked Effect guide",
            quickEvents: profileQuickEvents,
          }}
          loadingLabel="Starting the profile machine…"
        />
      )
    case "retry":
      return (
        <ScopedStudio
          start={retryStart}
          machine={{
            definition: retryDefinition,
            appName: "Retry guide",
            quickEvents: retryQuickEvents,
          }}
          loadingLabel="Starting the retry machine…"
        />
      )
    case "child":
      return (
        <ScopedStudio
          start={childStart}
          machine={{
            definition: childDefinition,
            appName: "Child machine guide",
            quickEvents: childQuickEvents,
          }}
          loadingLabel="Starting the parent and child machines…"
        />
      )
    case "parallel":
      return (
        <ScopedStudio
          start={parallelStart}
          machine={{
            definition: parallelDefinition,
            appName: "Parallel regions guide",
            quickEvents: parallelQuickEvents,
          }}
          loadingLabel="Starting the parallel player machine…"
        />
      )
  }
}

export function EmbeddedStudioDemo() {
  return <MachineStudioDemo example="runner" />
}
