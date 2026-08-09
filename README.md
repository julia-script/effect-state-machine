# Effect-native state machine — throwaway prototype

This experiment asks:

> Can one pure state-machine definition infer its Effect requirements, execute
> with swappable Layers, preserve typed errors and scoped cancellation, and
> generate an honest Mermaid graph?

There is no XState in this version. The interpreter is built from Effect
queues, fibers, scopes, references, streams, context, and Layers.

## Run it

Double-click
[`dist/effect-native-todo.prototype.html`](dist/effect-native-todo.prototype.html).

To rebuild and open it on macOS:

```sh
pnpm install
pnpm prototype
```

Use `pnpm check` for a strict TypeScript check.

## Module under test

[`src/effect-machine.ts`](src/effect-machine.ts) exposes a deliberately small
interface:

- `Machine.builder<State, Event>()` defines state and invoke nodes.
- `Machine.run(definition)` creates a scoped handle requiring the environment
  inferred from every invoked Effect.
- The handle exposes `send`, `can`, `snapshot`, and `changes`.

Every application-facing operation remains an Effect. The core does not choose
a runtime or convert anything to a Promise; a browser, server, test, or Atom
integration owns that boundary.

Internally, a queue serializes external and effect-completion events, a
`FiberMap` owns the current invocation, a `SubscriptionRef` stores and streams
the tagged state, and the surrounding Layer owns the Scope.

## Todo experiment

[`src/todo-effect-machine.ts`](src/todo-effect-machine.ts) defines one machine
whose invoked Effects require the `Todos` Effect service. A type-level assertion
fails compilation if that requirement stops being inferred.

`TodoApp` is an Effect service whose `send`, `can`, `snapshot`, and `changes`
members are still Effect values. Its Layer requires `Todos`, so the concrete
implementation remains a composition-root choice. The browser prototype in
[`src/main.ts`](src/main.ts) deliberately owns `ManagedRuntime` and the Promise
conversion; an Effect Atom consumer could own that boundary instead.

Mermaid generation lives separately in the opt-in
[`src/effect-machine-devtools.ts`](src/effect-machine-devtools.ts) module. Its
default overview merges transitions that share endpoints and summarizes defect
routes; `{ detail: "complete" }` emits every route. The build writes the compact
graph generated from the definition to
[`dist/effect-native-todo.mmd`](dist/effect-native-todo.mmd).

At execution time the same definition can receive:

- `Todos.Memory`, a stateful in-memory Layer.
- `Todos.Failing`, a write-rejecting Layer.

Typed `TodoError` values flow directly into `onFailure`; they never become
untyped Promise rejections. Leaving an invoked state interrupts the active
fiber through the machine's Scope.

## Deliberate omissions

This is not a production library. It has no hierarchical or parallel states,
history, persistence, supervision policy, framework bindings, visual editor,
or durable event log. The point is to test whether dependency inference and
Layer-provided execution make the module worth pursuing.
