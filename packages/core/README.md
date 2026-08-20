# effect-state-machine

A small code-first state-machine library built with Effect, for Effect users.

Orchestration stays explicit in ordinary TypeScript, and the same executable definition projects
into a read-only graph for review and tooling. The library preserves Effect's model: dependencies
remain services supplied by Layers, expected failures stay typed, cancellation uses Scope and
fibers, retry uses native Schedule, and every runtime operation remains an Effect. No global
runtime, no Promise methods, no framework bindings.

## Install

The v0 line targets the Effect beta used to design and verify its semantics:

```sh
pnpm add effect-state-machine effect
```

## Quick start

```ts
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Machine from "effect-state-machine/Machine"
import * as MachineEngine from "effect-state-machine/MachineEngine"

class GreetFailed extends Schema.TaggedError<GreetFailed>()("GreetFailed", {
  message: Schema.String,
}) {}

class Greeter extends Context.Service<
  Greeter,
  Readonly<{ greet: (name: string) => Effect.Effect<string, GreetFailed> }>
>()("app/Greeter") {}

const Input = Schema.Struct({ name: Schema.String })
const State = Machine.taggedUnion({
  Loading: { fields: { name: Schema.String } },
  Done: { fields: { message: Schema.String } },
  Failed: { fields: { message: Schema.String } },
})
const Event = Schema.Union([Schema.TaggedStruct("Cancel", {})])

const greeting = Machine.builder({ input: Input, state: State, event: Event })

export const definition = greeting.define(
  {
    id: "greeting",
    idempotencyKey: (input) => input.name,
    initial: (input) => ({ _tag: "Loading", name: input.name }),
  },
  {
    Loading: greeting.invoke({
      name: "Greeter.greet",
      success: Schema.String,
      error: GreetFailed,
      effect: (state) => Effect.flatMap(Greeter, ({ greet }) => greet(state.name)),
      onSuccess: { target: "Done", reduce: ({ value }) => ({ message: value }) },
      onFailure: { target: "Failed", reduce: ({ error }) => ({ message: error.message }) },
    }),
    Done: greeting.final(),
    Failed: greeting.final(),
  },
)

const GreeterLive = Layer.succeed(
  Greeter,
  Greeter.of({ greet: (name) => Effect.succeed(`Hello, ${name}!`) }),
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const machine = yield* definition.run({ name: "Effect" })
    return yield* machine.completion
  }),
).pipe(Effect.provide(GreeterLive), Effect.provide(MachineEngine.layerMemory()))

const result = await Effect.runPromise(program)
```

`definition.run` infers `Greeter` from the definition; any test, server, or browser application can
provide a different Layer without changing the machine. The handle exposes `snapshot`, `changes`,
`send`, `can`, `completion`, and a metadata-only `inspection` stream.

## Restart-capable execution

Every definition runs through `MachineEngine`. The definition derives its stable identity from its
own `id` and `idempotencyKey`; the supplied `MachineStore` owns the complete revisioned aggregate:

```ts
import * as Effect from "effect/Effect"
import * as MachineEngine from "effect-state-machine/MachineEngine"

const handle = yield* definition.run({ name: "Ada" }).pipe(
  Effect.provide(MachineEngine.layerMemory()),
)

yield* handle.send({ _tag: "Cancel" }, { idempotencyKey: "cancel-request-42" })
```

An `after` duration is resolved once on entry and stored with an absolute deadline from the store's
clock. If the process stops 30 seconds into a 60-second timer, resumption waits the remaining 30
seconds; if it resumes after the deadline, the overdue timer is immediately eligible ahead of
newer events. Stay updates preserve the entry and deadline, while explicit self-transitions create
a new entry and timer.

Invoked work is delivered at least once until its encoded outcome is committed. Every invocation
receives a required `WorkExecution`; pass `execution.id` to Effect Workflow, an external task queue, or your
own idempotency table when the side effect itself must be durable:

```ts
effect: (state, execution) =>
  ExternalTasks.submit({
    idempotencyKey: execution.id,
    payload: state.request,
  })
```

The library makes the activity command and outcome durable, but cannot promise exactly-once
external side effects. Operational `Effect.Schedule` retry progress may restart after process loss;
the execution key does not change. Scope closure, owner exit, and lease loss interrupt local work
without encoding interruption as an authored failure or durable defect, leaving an uncommitted
command eligible for fenced redelivery.

Production adapters implement the minimal `MachineStore` load/time/compare-and-set contract and
run `MachineStoreConformance`. Queueing, claims, timers, fencing, activities, migrations, and child
machines remain engine behavior and are covered by `MachineEngineConformance`.

## Read-only graph

Tooling is an opt-in entry point, not loaded by the core import:

```ts
import * as Graph from "effect-state-machine/Graph"
import * as Mermaid from "effect-state-machine/Mermaid"

const graph = Graph.fromDefinition(definition)
const mermaid = Mermaid.render(graph)
```

## Devtools

- [`@effect-state-machine/studio`](https://github.com/julia-script/effect-state-machine/tree/main/packages/studio) — the standalone Studio devtool (CLI + browser interface).
- [`@effect-state-machine/studio-client`](https://github.com/julia-script/effect-state-machine/tree/main/packages/studio-client) — connects running machines to Studio.
- [`@effect-state-machine/studio-react`](https://github.com/julia-script/effect-state-machine/tree/main/packages/studio-react) — embed Studio in a React app.

## Documentation

See the [repository](https://github.com/julia-script/effect-state-machine) for the full README, guides, and
the executable capability matrix behind v0's boundary.
