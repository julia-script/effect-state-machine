# effect-state-machine

A small code-first state-machine library built with Effect for Effect users.

Agentic coding makes code cheap to produce, but it can make an application harder for its own
developer to explain. `effect-state-machine` keeps orchestration explicit in ordinary TypeScript
and projects the same executable definition into a read-only graph. The graph is for you—the
developer navigating and reviewing the code—not a second editable source of truth.

The library preserves Effect's model: dependencies remain services supplied by Layers, expected
failures stay typed, cancellation uses Scope and fibers, retry uses native Schedule, and every
runtime operation remains an Effect. The library creates no global runtime and exposes no Promise
methods or framework bindings.

## Install

The v0 line currently targets the Effect beta used to design and verify its semantics:

```sh
pnpm add effect-state-machine effect@4.0.0-beta.106
```

## Quick start

Define input, complete machine states, and events with Effect Schema. An invoked Effect can require
an application service; its Layer is selected only when the machine runs.

```ts
import { Context, Data, Effect, Layer, Schema } from "effect"
import { Machine } from "effect-state-machine"

class GreetFailed extends Data.TaggedError("GreetFailed")<{
  readonly message: string
}> {}

class Greeter extends Context.Service<
  Greeter,
  Readonly<{
    greet: (name: string) => Effect.Effect<string, GreetFailed>
  }>
>()("app/Greeter") {}

const Input = Schema.Struct({ name: Schema.String })
const Loading = Schema.TaggedStruct("Loading", { name: Schema.String })
const Done = Schema.TaggedStruct("Done", { message: Schema.String })
const Failed = Schema.TaggedStruct("Failed", { message: Schema.String })
const State = Schema.Union([Loading, Done, Failed]).pipe(Schema.toTaggedUnion("_tag"))
const Cancel = Schema.TaggedStruct("Cancel", {})
const Event = Schema.Union([Cancel]).pipe(Schema.toTaggedUnion("_tag"))

const greeting = Machine.builder({ input: Input, state: State, event: Event })

export const definition = greeting.make({
  id: "greeting",
  initial: (input) => ({ _tag: "Loading", name: input.name }),
  nodes: [
    greeting.invoke("Loading", {
      name: "Greeter.greet",
      effect: (state) => Effect.flatMap(Greeter, ({ greet }) => greet(state.name)),
      onSuccess: {
        target: "Done",
        reduce: ({ value }) => ({ _tag: "Done", message: value }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ _tag: "Failed", message: error.message }),
      },
    }),
    greeting.final("Done"),
    greeting.final("Failed"),
  ],
})

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

// Runtime ownership and Promise conversion stay at the consumer boundary.
const result = await Effect.runPromise(program)
```

`Machine.run` infers `Greeter` from the definition. A test, server, browser application, or Effect
Atom integration can provide a different Layer without changing the machine.

## Read-only graph

Tooling is an opt-in entry point and is not loaded by the core import:

```ts
import { Graph, Mermaid } from "effect-state-machine/devtools"
import { definition } from "./greeting.js"

const graph = Graph.fromDefinition(definition)
const mermaid = Mermaid.render(graph)
```

`Graph.fromDefinition` produces renderer-independent data. It retains Schema descriptions, ordered
guard metadata, invocation and retry names, ignored events, and linked child definitions. Mermaid
is the initial compact renderer; it does not attempt to reconstruct opaque Effect or Schedule
internals. Run `pnpm build` in this repository to regenerate
`dist/reference-workflow.mmd`, a read-only diagram of the integrated example.

## Runtime contract

`Machine.run(definition, input)` is a scoped Effect. Its requirements are inferred transitively
from invoked Effects, retry Schedules, and child machines. It returns a handle with:

- `snapshot`: the current tagged state as an Effect;
- `changes`: a Stream of committed state snapshots;
- `send(event)`: enqueue one decoded event and await its processing;
- `can(event)`: observe whether the current state accepts an event;
- `completion`: the inferred final-state value, preserving defects as an Effect `Cause`;
- `inspection`: a metadata-only semantic Stream for transitions, invocations, retries, and children.

One queue serializes external events and asynchronous completions. Leaving an invoked or child state
interrupts the work it owns. Typed Effect failures follow declared transitions; defects terminate
the machine. A known event rejected by the live state is a protocol defect. Expected irrelevant
events must be declared explicitly.

Input, state, and event values have explicit `decode*` and `encode*` helpers. V0 does not claim
persistence, replay, migration, or resumption of interrupted Effects.

## Definition model

V0 has four visible node kinds:

- ordinary states with pure reducers and optional ordered named guards;
- invoked Effects with typed success/failure routes and optional named native Schedules;
- statically invoked child machines with typed input, explicit forwarding, and inferred completion;
- final states whose value is the machine's completion output.

Hierarchy, parallel regions, dynamic spawning, a global actor registry, visual editing, application
framework bindings, and durable execution are deliberately outside v0. See the
[reference workflow](docs/reference-workflow.md) and [capability matrix](docs/capability-matrix.md)
for the executable evidence behind the current boundary.

## Compatibility and verification

V0 is pinned to `effect@4.0.0-beta.106` while Effect 4 remains beta. The repository is verified with
TypeScript 7.0.2, pnpm 11.18.0, and Node 26.5.0. The package emits ESM and declaration maps targeting
ES2022.

```sh
pnpm install --frozen-lockfile
pnpm check
```

The package check builds declarations, packs the exact publishable files, installs the tarball into
a clean temporary pnpm consumer, type-checks and executes an Effect/Layer machine, generates a
graph, and verifies that a core-only bundle contains no graph or Mermaid modules.
