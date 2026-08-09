# Effect beta + XState research for the todo prototype

Research snapshot: **2026-08-09**.

## Conclusion

Use XState as the app's **orchestrator and visible state graph**, and Effect as the implementation of **use cases, service dependencies, typed failures, resource ownership, and cancellation**. The smallest useful bridge is an XState `fromPromise` actor that runs an Effect through one application-level `ManagedRuntime`.

The important wrinkle is error typing: XState 5.32.5 strongly types a promise actor's input and successful output, but its `onError` event still carries `unknown`. Preserve expected Effect errors by converting them to `Result` data with `Effect.result` and handling `Success`/`Failure` through a typed `onDone`. Reserve `onError` for defects, runtime construction failures, and other unexpected failures.

No first-party Effect/XState adapter or official example was found in either project's docs, repository packages, or published package surface. The supported interop points are enough that a custom adapter should stay tiny.

## Verified versions

| Package | Version to pin | Evidence |
| --- | --- | --- |
| `effect` beta | `4.0.0-beta.106` | npm's `beta` dist-tag points to this version; it was published 2026-08-08. [Dist-tags](https://registry.npmjs.org/-/package/effect/dist-tags), [version metadata](https://registry.npmjs.org/effect/4.0.0-beta.106) |
| `xstate` stable | `5.32.5` | npm's `latest` dist-tag points to this version; it was published 2026-07-14. [Dist-tags](https://registry.npmjs.org/-/package/xstate/dist-tags), [version metadata](https://registry.npmjs.org/xstate/5.32.5) |
| `@xstate/react` if the prototype uses React | `6.1.0` | Current package metadata; its peers accept XState `^5.28.0` and React through 19. [Version metadata](https://registry.npmjs.org/@xstate%2freact/6.1.0) |

Recommended install command:

```sh
pnpm add effect@4.0.0-beta.106 xstate@5.32.5
```

Pin the exact Effect beta rather than leaving `@beta` in `package.json`; beta releases can change APIs. If React is used, add `@xstate/react@6.1.0` explicitly.

## What XState 5.32.5 provides

### Typed machine definition

`setup({ types, actors, actions, guards })` is the v5 API for declaring types and named implementations before calling `.createMachine(...)`. It gives typed context, events, actor input/output, guards, and actions. XState requires TypeScript 5 or newer. [XState setup docs](https://stately.ai/docs/setup)

For this experiment, keep guards pure and very small—examples are `title.trim().length > 0` and checking a typed result's `_tag`. Keep context updates in `assign(...)` actions. XState's docs explicitly say guards should be pure. [XState guard docs](https://stately.ai/docs/guards)

### Invoked actors and lifecycle

An `invoke` starts its child actor when the state is entered and stops it when the state is exited. Promise actors resolve into `invoke.onDone` with `event.output` and reject into `invoke.onError`. Actor sources registered in `setup({ actors })` are referenced by name through `src`; actor input is provided through `invoke.input`. [Invoke docs](https://stately.ai/docs/invoke)

The exact promise actor signature in 5.32.5 is effectively:

```ts
fromPromise<TOutput, TInput>(
  ({ input, system, self, signal, emit }) => PromiseLike<TOutput>
)
```

The supplied `signal` is an `AbortSignal`. XState creates an `AbortController` for the promise actor and aborts it when the actor stops. If the promise later resolves or rejects after stopping, XState discards that result. [Tagged 5.32.5 source](https://github.com/statelyai/xstate/blob/xstate%405.32.5/packages/core/src/actors/promise.ts), [promise actor docs](https://stately.ai/docs/promise-actors)

This gives the desired state-scoped cancellation: leaving `loading`, `adding`, `toggling`, or `deleting` stops that operation automatically.

### Error typing limitation

`fromPromise` has generics for output, input, and emitted events, but not the rejection type. In 5.32.5, `ErrorActorEvent<TErrorData = unknown>` defaults to `unknown`, and invoke `onError` uses that default. Successful actor output is inferred into `onDone`; rejection is not. [Promise actor source](https://github.com/statelyai/xstate/blob/xstate%405.32.5/packages/core/src/actors/promise.ts), [XState event types](https://github.com/statelyai/xstate/blob/xstate%405.32.5/packages/core/src/types.ts)

Consequently, letting an `Effect<A, TodoError, R>` reject through `runPromise` throws away the compile-time knowledge that the failure is `TodoError` at the XState boundary. A runtime `_tag` check can recover it, but returning `Result<A, TodoError>` is simpler and more honest.

### When `fromCallback` is relevant

Use `fromCallback` only for a long-lived Effect process that must send multiple events back, receive events, or expose subscription cleanup. Its callback may return a cleanup function, which XState calls when the actor stops; callback actors do not have `onDone` or produce output. [Callback actor docs](https://stately.ai/docs/callback-actors), [tagged source](https://github.com/statelyai/xstate/blob/xstate%405.32.5/packages/core/src/actors/callback.ts)

The todo CRUD calls are finite, one-output operations, so `fromPromise` is the better first experiment.

## What Effect 4.0.0-beta.106 provides

### Services and layers

Effect v4's class-style service declaration is:

```ts
class TodoRepository extends Context.Service<
  TodoRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<Todo>, TodoRepositoryError>
    readonly add: (title: string) => Effect.Effect<Todo, TodoRepositoryError>
    readonly toggle: (id: string) => Effect.Effect<Todo, TodoRepositoryError>
    readonly remove: (id: string) => Effect.Effect<void, TodoRepositoryError>
  }
>()("prototype/TodoRepository") {}
```

`Layer.succeed` provides an already-created in-memory implementation; `Layer.effect` provides one constructed effectfully. The class key itself can be yielded in `Effect.gen`, and `TodoRepository.of(...)` constructs a value of the service shape. [Tagged `Context.Service` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Context.ts), [tagged `Layer` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Layer.ts), [v4 service example](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/ai-docs/src/01_effect/03_services/01_service.ts)

For the prototype, a single in-memory layer is enough. Put artificial delay and controllable failure inside the service so the state graph can exercise loading, cancellation, and failure visibly.

### One managed runtime at the boundary

`ManagedRuntime.make(layer)` lazily builds a layer once, caches its context, runs many effects against it, and owns the layer's resources until `dispose()`/`disposeEffect` is called. Its `runPromise` accepts the same run options as Effect, including `signal?: AbortSignal`. [Tagged `ManagedRuntime` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/ManagedRuntime.ts)

Create one runtime at app composition time and dispose it when the app is torn down. Do not create a new runtime inside every promise actor; that would repeatedly build services and obscure resource lifetime.

`Effect.runPromise` alone is appropriate only after all service requirements have been provided. A `ManagedRuntime` is the clearer bridge here because todo programs retain their `TodoRepository` requirement and the runtime supplies it.

### Cancellation and Promise APIs

Effect's `Effect.RunOptions` includes `signal?: AbortSignal`; aborting it interrupts the running fiber. `ManagedRuntime.runPromise(effect, { signal })` forwards those run options. [Tagged `Effect.runPromise` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Effect.ts), [tagged `ManagedRuntime` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/ManagedRuntime.ts)

When Effect wraps a cancelable Promise, `Effect.tryPromise` passes its thunk an Effect-owned `AbortSignal`; interruption aborts that signal. The wrapped API must observe the signal—for example, `fetch(url, { signal })`. [Tagged `Effect.tryPromise` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Effect.ts)

The complete cancellation path is therefore:

```text
XState state exits
  -> invoked promise actor stops
  -> XState aborts fromPromise's signal
  -> ManagedRuntime.runPromise interrupts the Effect fiber
  -> Effect aborts signals owned by Effect.tryPromise
  -> fetch (or another AbortSignal-aware API) stops
```

Effect-native operations such as `Effect.sleep` are interruptible without wrapping a Promise.

### Typed errors as data at the bridge

Define domain failures with tagged error values, for example `Schema.TaggedError`, and use the Effect error channel inside services/use cases. Effect v4's own examples use `Schema.TaggedError` and `Effect.catchTag`/`catchTags`. [Tagged error example](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/ai-docs/src/01_effect/04_errors/01_error-handling.ts)

At the XState bridge, `Effect.result(effect)` converts typed recoverable failures to `Result.Failure` and successes to `Result.Success`; defects and interruption still fail the Effect. That is exactly the split needed here: expected todo failures remain typed output, while defects go through XState `onError`. [Tagged `Effect.result` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Effect.ts), [tagged `Result` source](https://github.com/Effect-TS/effect/blob/effect%404.0.0-beta.106/packages/effect/src/Result.ts)

## Recommended adapter

Keep the adapter local to the prototype rather than publishing an abstraction before the experiment validates it:

```ts
import { Effect, ManagedRuntime, Result } from "effect"
import { fromPromise } from "xstate"

const fromEffect = <R, Input, Output, Error>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  makeEffect: (input: Input) => Effect.Effect<Output, Error, R>
) =>
  fromPromise<Result.Result<Output, Error>, Input>(({ input, signal }) =>
    runtime.runPromise(Effect.result(makeEffect(input)), { signal })
  )
```

This adapter was type-checked under `strict` mode against the exact pinned package versions and TypeScript 7.0.2.

Notes:

- The runtime's layer-build error is `never` in this prototype. If a future live layer can fail to initialize, initialize it explicitly or model that bootstrap error in the root machine.
- `Effect.result` preserves expected errors. A defect still rejects and reaches `invoke.onError` as `unknown`.
- Pass the XState signal only to `runPromise`; Effect then owns propagation through its fiber and wrapped async operations.
- This helper is an integration boundary, not domain logic. Effect use cases should have no XState imports, and the machine should not know Layer construction details.

## Recommended todo state model

Start with a deliberately serialized graph because it makes ownership and cancellation obvious:

```text
loading -> ready.idle
             | ADD       -> ready.adding   -> idle | failed
             | TOGGLE    -> ready.toggling -> idle | failed
             | DELETE    -> ready.deleting -> idle | failed
failed  -> RETRY / DISMISS
```

More concretely:

- `loading` invokes `loadTodos`.
- `ready` contains nested `idle`, `adding`, `toggling`, and `deleting` states.
- Each operation state invokes one named Effect-backed actor and carries only the input needed by that operation.
- `onDone` has guarded branches for `Result.Success` and `Result.Failure`.
- Success actions update XState context; failure actions store the typed domain error.
- `onError` enters a distinct `crashed`/`unexpectedError` state so defects are not presented as normal repository failures.
- `CANCEL` returns to `idle`; exiting the invoking state interrupts the Effect.
- Pure guards reject blank titles or missing todo ids before invoking anything.

Serializing mutations is not a production claim. It is a useful prototype constraint: the graph stays legible, every operation has an observable lifecycle, and cancellation can be tested. A second experiment can compare parallel per-todo actors once this basic boundary feels right.

## Suggested experiment cases

The prototype should make these cases easy to drive and display the full XState value/context after every action:

1. Initial load succeeds.
2. Initial load returns a typed repository failure.
3. Add succeeds and updates context only after success.
4. Blank add is blocked by a pure guard.
5. Toggle/delete a missing id returns a typed failure.
6. Cancel a delayed operation and confirm it cannot update context afterward.
7. Force a defect and confirm it uses the unexpected-error path, not the typed domain-failure path.
8. Retry from failure.
9. Stop the root actor and dispose the `ManagedRuntime`.

These cases answer the actual design question: whether the XState graph remains the readable source of orchestration truth while Effect code stays independently understandable and retains its dependency/error/cancellation advantages.

## Integration status

I found no package maintained by Stately or Effect-TS whose purpose is an Effect/XState bridge, and neither official documentation set contains an integration guide. This is a bounded search result, not proof that no community experiment exists. The official primitives point to `fromPromise` for finite effects and `fromCallback` for long-lived/subscription effects, with a small application-owned adapter between them. [XState repository](https://github.com/statelyai/xstate), [Effect repository](https://github.com/Effect-TS/effect), [XState actor docs](https://stately.ai/docs/actors)
