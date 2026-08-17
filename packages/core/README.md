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
import { Context, Effect, Layer, Schema } from "effect"
import { Machine } from "effect-state-machine"

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
    initial: (input) => ({ _tag: "Loading", name: input.name }),
  },
  {
    Loading: greeting.invoke({
      name: "Greeter.greet",
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
    const machine = yield* Machine.run(definition, { name: "Effect" })
    return yield* machine.completion
  }),
).pipe(Effect.provide(GreeterLive))

const result = await Effect.runPromise(program)
```

`Machine.run` infers `Greeter` from the definition; any test, server, or browser application can
provide a different Layer without changing the machine. The handle exposes `snapshot`, `changes`,
`send`, `can`, `completion`, and a metadata-only `inspection` stream.

## Read-only graph

Tooling is an opt-in entry point, not loaded by the core import:

```ts
import { Graph, Mermaid } from "effect-state-machine/devtools"

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
