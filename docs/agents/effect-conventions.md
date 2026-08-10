# Effect conventions

Conventions for Effect code in this repository (Effect v4 beta, pinned in each
package). `packages/core` is the reference implementation of these rules.

## One module per coherent concept

One module per concept, named after its singular subject (`Machine.ts`,
`Graph.ts`, `Mermaid.ts`, `SourceLocation.ts`). Each module holds the concept's
data type and sibling functions that take that value as their first parameter
(`Graph.focus(graph, …)`, `Machine.run(definition, …)`). Barrels (`src/index.ts`,
`src/devtools.ts`) only re-export namespaces (`export * as Graph from
"./Graph.js"`). No `utils.ts`/`helpers.ts` god-modules, no class-per-entity. A
new concept means a new module plus one barrel line.

## Prefer stable public subpath imports

Default to the narrowest stable public import path:

```ts
// prefer
import * as Effect from "effect/Effect"
import * as Machine from "effect-state-machine/Machine"

// over
import { Effect } from "effect"
import { Machine } from "effect-state-machine"
```

`effect-state-machine` publicly exports `.`, `./devtools`, `./Machine`,
`./Graph`, `./Mermaid`, and `./SourceLocation` — mirrored in `publishConfig`
and verified by `check-package.mjs`. `Source` is internal; adding a public
module means adding it to both export maps. Never import another package's
private implementation files (`dist/internal/...`).

## Wrap external APIs in Effect

Nothing that throws or returns a bare `Promise` crosses into our code
unwrapped. Give each external dependency one boundary module using
`Effect.try`/`Effect.tryPromise` with a semantic typed error, and
`Effect.acquireRelease` for anything needing cleanup. Prefer Effect's built-in
modules over hand-wrapping (`HttpClient` from `effect/unstable/http` over raw
`fetch`, `FileSystem` over `node:fs/promises`) so tests swap layers instead of
mocking globals. Deterministic domain calculations (`Graph`, `Mermaid`,
`SourceLocation`) stay pure.

**Defects vs typed errors in core:** `MachineDefinitionDefect` and
`ProtocolDefect` are deliberate defects — invalid definitions and protocol
violations are programmer errors, thrown synchronously by the builder or raised
with `Effect.die` by the interpreter, never modeled in the typed error channel.
Expected failures belong to invoked Effects and flow through `onFailure`
transitions. Never throw a typed error as ordinary error handling
(`return yield* new ErrorType(...)`), and never put `try`/`catch` around
`yield*` inside `Effect.gen`.

## Effectful functions are `Effect.fn`

Use `Effect.gen` for inline one-off composition. Reusable implementations use
`Effect.fnUntraced(function* (args) { … })`, not an arrow that merely returns
`Effect.gen`. Use named `Effect.fn("Service.method")` only where a tracing span
is wanted (application/service operations — not core library internals). Pin
public or recursive signatures explicitly; `Machine.run` keeps an annotated
arrow because its generic, self-recursive signature cannot survive generator
inference (documented at the definition). Use `return yield*` for terminal
effects.

## Define services and compose layers

Core defines no services — the machine interpreter takes its requirements from
invoked Effects and expresses them in `run`'s `R` channel. Where services are
needed (studio, clients), prefer class syntax for `Context.Service` with a
stable `"<package>/<Module>"` identifier, construct implementations with
`Service.of`, attach `layer`/`layerNoDeps`/`layerTest` statics to the service
module, hide supplied dependencies with `Layer.provide`, and compose the graph
once at the application edge.

## Keep runtime bridges at application edges

Effect-owned processes use `Layer.launch` + the platform `runMain`.
`ManagedRuntime` is only for bridging into foreign callback/promise frameworks —
shared deliberately and disposed on shutdown, never a test runner.

## Tests stay inside Effect

Use `@effect/vitest`: `it.effect` for Effect-returning tests, plain `it` for
pure synchronous tests, `assert` rather than `expect`, `TestClock` for
time-dependent behavior (see `packages/core/tests`). No `Effect.runPromise`/
`Effect.runSync` in ordinary test bodies, no `async` wrappers around Effect
tests, no `ManagedRuntime` as a test runner.

## Stay type-safe

- No non-null assertions (`!`) anywhere, tests included — use explicit
  narrowing (`?? fallback`, guards) instead.
- Casts (`as`) only at type-erasure boundaries TypeScript genuinely cannot
  express, each with a one-line comment naming why (see the interpreter
  boundary in `Machine.ts`). Prefer fixing the signature over casting the call
  site.
- No lint suppressions to dodge either rule.

## Handle dynamic records safely

Only relevant when keys come from external data or are chosen at runtime: use
`Map` (as the interpreter does for node lookup) or a null-prototype dictionary
for owned open-key storage, `Object.hasOwn` for presence checks on external
records, and never `for...in`. Schema-validated tag unions are closed keys and
need none of this.
