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

## Packages

This repository is a pnpm workspace:

- [`effect-state-machine`](packages/core) — the core library (single dependency: `effect`);
- [`@effect-state-machine/studio-client`](packages/studio-client) — connects running machines to Studio;
- [`@effect-state-machine/studio`](packages/studio) — the Studio CLI, server, and interface;
- [`@effect-state-machine/studio-react`](packages/studio-react) — embed Studio in a React app;
- [`@effect-state-machine/docs`](apps/docs) — the documentation site (Next.js + Fumadocs).

## Install

The v0 line currently targets the Effect beta used to design and verify its semantics:

```sh
pnpm add effect-state-machine effect
```

## Quick start

Define input, complete machine states, and events with Effect Schema. An invoked Effect can require
an application service; its Layer is selected only when the machine runs.

```ts
import { Context, Effect, Layer, Schema } from "effect"
import { Machine } from "effect-state-machine"

class GreetFailed extends Schema.TaggedError<GreetFailed>()("GreetFailed", {
  message: Schema.String,
}) {}

class Greeter extends Context.Service<
  Greeter,
  Readonly<{
    greet: (name: string) => Effect.Effect<string, GreetFailed>
  }>
>()("app/Greeter") {}

const Input = Schema.Struct({ name: Schema.String })
const State = Machine.taggedUnion({
  Loading: {
    fields: { name: Schema.String },
    description: "Load a greeting through the injected service.",
  },
  Done: {
    fields: { message: Schema.String },
    description: "Complete with the generated greeting.",
  },
  Failed: {
    fields: { message: Schema.String },
    description: "Complete with an expected greeting failure.",
  },
})
const Cancel = Schema.TaggedStruct("Cancel", {})
const Event = Schema.Union([Cancel])

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
      onSuccess: {
        target: "Done",
        reduce: ({ value }) => ({ message: value }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ message: error.message }),
      },
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

// Runtime ownership and Promise conversion stay at the consumer boundary.
const result = await Effect.runPromise(program)
```

`Machine.run` infers `Greeter` from the definition. A test, server, browser application, or Effect
Atom integration can provide a different Layer without changing the machine.

`Machine.builder` accepts Effect's native `Schema.TaggedUnion`, an ordinary `Schema.Union` of
tagged structs, or `Machine.taggedUnion`. The helper is optional; it keeps each case's fields,
title, and description together and produces an ordinary Effect Schema. The builder adds tagged
union utilities internally when an ordinary union is supplied.

## Read-only graph

Tooling is an opt-in entry point and is not loaded by the core import:

```ts
import { Graph, Mermaid } from "effect-state-machine/devtools"
import { definition } from "./greeting.js"

const graph = Graph.fromDefinition(definition)
const mermaid = Mermaid.render(graph)
```

`Graph.fromDefinition` produces renderer-independent data. It retains Schema descriptions, ordered
guard metadata, region paths, timers, invocation kinds and lanes, retry names, ignored events, and
linked child definitions. Mermaid
is the initial compact renderer; it does not attempt to reconstruct opaque Effect or Schedule
internals. Run `pnpm build` in this repository to regenerate
`dist/reference-workflow.mmd`, a read-only diagram of the integrated example.

## Studio

Studio is the standalone devtool: a local server plus a browser interface that any number of
applications — browser or Node — connect to over WebSocket. The old in-page viewer is gone; one
tool serves every runtime.

Start it:

```sh
npx @effect-state-machine/studio        # http://127.0.0.1:4747
```

Attach a running machine from your application with
[`@effect-state-machine/studio-client`](packages/studio-client):

```ts
import { Attach, WebSocketTransport, Transport } from "@effect-state-machine/studio-client"
import { Effect } from "effect"
import { Machine } from "effect-state-machine"

const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* Machine.run(definition, input)
    yield* Attach.attach({
      definition,
      handle,
      quickEvents: [
        { id: "save", label: "Save", event: { _tag: "Save" } },
        {
          id: "random-edit",
          label: "Random edit",
          make: () => ({ _tag: "Edit" as const, text: crypto.randomUUID() }),
        },
      ],
    })
    // …the application continues normally
  }),
).pipe(Effect.provideService(Transport.StudioTransport, WebSocketTransport.make()))
```

Attaching is scoped and observational: one attachment represents the root machine and every child
machine it owns as a single ordered Studio session. Each runtime actor keeps its own identity and
structural definition path inside that session, so Studio can target a live child without creating
another session. The attachment never interrupts the machine, and it is inert when no
Studio is running — the client connects lazily, retries in the background, and buffers unsent
facts (bounded, oldest dropped with a truncation notice). Everything Studio needs crosses the wire
as plain data: the serialized behavior graph, JSON Schemas per state and event, schema-encoded
state snapshots, and semantic inspection events. Quick-event factories run in the application;
custom events dispatched from Studio are decoded against the machine's event schema and checked
with `can` before they reach the real handle.

The interface shows the behavior map with depth-limited focus and traversed-edge emphasis, the
current actor state as JSON with an actor-local line diff, node and event detail cards with their JSON Schemas and
source links (opened in your editor by the local server, `--editor` to configure), grouped quick
events, a custom-event editor, and a semantic history with local time travel — the cursor is
per-viewer state and never touches the wire or the machine. The map composes the complete structural
machine tree and shows inactive child definitions too; every live actor's state is highlighted at the
global cursor. Multiple root machines appear as sessions in the top bar, while descendants stay in
their root session; disconnected sessions keep their history inspectable. Dispatch requests carry
both the root session ID and target actor ID.

The connection is a swappable Effect service (`StudioTransport`), so future transports — an
in-memory pair for tests ships today, a browser-extension port is possible later — reuse the whole
client and interface unchanged.

For a runnable walkthrough see
[`packages/studio-client/examples/checkout-demo.ts`](packages/studio-client/examples/checkout-demo.ts).

### Interactive reference workbench

`pnpm build` also creates `dist/local-first-document.html`, a standalone browser page for the same
local-first document definition used by the tests. It can swap `Documents` and `Synchronizer`
Layers, exercise typed failures, advance an Effect `TestClock` through the retry Schedule, resolve
the scoped conflict child, and inspect both focused and complete graph views. The page owns its
`ManagedRuntime` and Promise bridge; the machine handle remains Effect-native.

## Runtime contract

`Machine.run(definition, input)` is a scoped Effect. It is also dual, so
`pipe(definition, Machine.run(input))` is equivalent. Its requirements are inferred
transitively from invoked Effects, retry Schedules, and child machines. It returns a handle with:

- `snapshot`: the current tagged state as an Effect;
- `changes`: a Stream of committed state snapshots;
- `send(event)`: enqueue one decoded event and await its processing;
- `can(event)`: observe whether the current state accepts an event;
- `completion`: the inferred final-state value, preserving defects as an Effect `Cause`;
- `inspection`: a metadata-only semantic Stream for transitions, parallel macrosteps, invocations,
  timers, retries, stale outcomes, and children.

One queue serializes external events and asynchronous completions. Leaving an invoked or child state
interrupts the work it owns. Typed Effect failures follow declared transitions; defects terminate
the machine. A known event rejected by the live state is a protocol defect. Expected irrelevant
events must be declared explicitly.

Input, state, and event values have explicit `decode*` and `encode*` helpers. V0 does not claim
persistence, replay, migration, or resumption of interrupted Effects.

## Definition model

Definitions are exhaustive records keyed by state tag and have five visible node kinds:

- ordinary states with pure reducers, optional ordered named guards, and entry-owned timers;
- invoked Effects with typed success/failure routes, single/all/race work, named lanes, concurrency,
  and optional named native Schedules;
- region-bearing states with one compound or several parallel tagged-union slots;
- statically invoked child machines with typed input, explicit forwarding, and inferred completion;
- final states whose value is the machine's completion output.

Nested parent-state hierarchy, dynamic spawning, a global actor registry, visual editing, and
durable execution remain outside v0. See the [statecharts guide](docs/statecharts.md),
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
