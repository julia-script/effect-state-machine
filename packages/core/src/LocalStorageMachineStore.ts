import * as Clock from "effect/Clock"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as MachineStore from "./MachineStore.js"

/**
 * Synchronous key-value capability required from browser `localStorage` or a compatible adapter.
 *
 * @category services
 * @since 0.2.0
 */
export interface Storage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
}

/**
 * Effect-level exclusive-lock capability used to serialize one instance's compare-and-set writes.
 *
 * @category services
 * @since 0.2.0
 */
export interface Locks {
  readonly withLock: <A, E, R>(
    name: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | LocalStorageMachineStoreError, R>
}

/**
 * Structural subset of the browser Web Locks manager consumed by {@link webLocks}.
 *
 * @category services
 * @since 0.2.0
 */
export interface WebLockManager {
  readonly request: <A>(name: string, callback: () => Promise<A>) => Promise<A>
}

/**
 * Expected failure while locking, reading, writing, decoding, or encoding browser-local state.
 *
 * **Details**
 *
 * Adapter layers translate this boundary error into `MachineStore.MachineStoreError` before the
 * service is exposed to `MachineEngine`.
 *
 * @category errors
 * @since 0.2.0
 */
export class LocalStorageMachineStoreError extends Data.TaggedError(
  "LocalStorageMachineStoreError",
)<{
  readonly operation: "lock" | "read" | "write" | "decode" | "encode"
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Safe refusal to construct a coordinated store without Web Locks.
 *
 * @category errors
 * @since 0.2.0
 */
export class UnsupportedPlatform extends Data.TaggedError("UnsupportedPlatform")<{
  readonly feature: "web-locks"
  readonly message: string
}> {}

/**
 * Construction settings shared by coordinated and explicitly single-context stores.
 *
 * **Details**
 *
 * `namespace` defaults to `"effect-state-machine"`. `now` defaults to Effect's current clock and
 * can be replaced by a virtual-clock Effect for deterministic tests.
 *
 * @category configuration
 * @since 0.2.0
 */
export interface Config {
  readonly storage: Storage
  readonly namespace?: string
  readonly now?: Effect.Effect<number, LocalStorageMachineStoreError>
}

/**
 * Settings for the cross-context-safe adapter.
 *
 * **Gotchas**
 *
 * `locks` is optional in the input so capability detection can remain explicit, but {@link make}
 * and {@link layer} fail with {@link UnsupportedPlatform} when it is absent.
 *
 * @category configuration
 * @since 0.2.0
 */
export interface CoordinatedConfig extends Config {
  readonly locks?: Locks
}

const boundaryError = (
  operation: LocalStorageMachineStoreError["operation"],
  cause: unknown,
): LocalStorageMachineStoreError =>
  new LocalStorageMachineStoreError({ operation, message: String(cause), cause })

/**
 * Wraps an injected browser Web Locks manager as the Effect-level {@link Locks} capability.
 *
 * **When to use**
 *
 * Use at a browser application boundary to adapt `navigator.locks` without reading browser globals
 * from this module.
 *
 * **Gotchas**
 *
 * The callback crosses a Promise boundary while preserving the current Effect context and Cause.
 * A rejected lock request becomes {@link LocalStorageMachineStoreError}.
 *
 * @category constructors
 * @since 0.2.0
 */
export const webLocks = (manager: WebLockManager): Locks => ({
  withLock: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<R>()
      const result = yield* Effect.tryPromise({
        try: () => manager.request(name, () => Effect.runPromiseExitWith(context)(effect)),
        catch: (cause) => boundaryError("lock", cause),
      })
      return Exit.isSuccess(result) ? result.value : yield* Effect.failCause(result.cause)
    }),
})

const storageKey = (namespace: string, instanceId: MachineStore.MachineInstanceId): string =>
  `${namespace}:${instanceId.length}:${instanceId}`

const read = (
  config: Config,
  instanceId: MachineStore.MachineInstanceId,
): Effect.Effect<Option.Option<MachineStore.MachineDocument>, LocalStorageMachineStoreError> =>
  Effect.gen(function* () {
    const encoded = yield* Effect.try({
      try: () =>
        config.storage.getItem(storageKey(config.namespace ?? "effect-state-machine", instanceId)),
      catch: (cause) => boundaryError("read", cause),
    })
    if (encoded === null) return Option.none()
    const parsed = yield* Effect.try({
      try: () => JSON.parse(encoded),
      catch: (cause) => boundaryError("decode", cause),
    })
    return Option.some(
      yield* Schema.decodeUnknownEffect(MachineStore.MachineDocument)(parsed).pipe(
        Effect.mapError((cause) => boundaryError("decode", cause)),
      ),
    )
  })

const write = (
  config: Config,
  instanceId: MachineStore.MachineInstanceId,
  document: MachineStore.MachineDocument,
): Effect.Effect<void, LocalStorageMachineStoreError> =>
  Effect.gen(function* () {
    const validated = yield* Schema.decodeUnknownEffect(MachineStore.MachineDocument)(
      document,
    ).pipe(Effect.mapError((cause) => boundaryError("encode", cause)))
    const encoded = yield* Effect.try({
      try: () => JSON.stringify(validated),
      catch: (cause) => boundaryError("encode", cause),
    })
    yield* Effect.try({
      try: () =>
        config.storage.setItem(
          storageKey(config.namespace ?? "effect-state-machine", instanceId),
          encoded,
        ),
      catch: (cause) => boundaryError("write", cause),
    })
  })

const mapError = (error: LocalStorageMachineStoreError): MachineStore.MachineStoreError =>
  new MachineStore.MachineStoreError({
    operation:
      error.operation === "read"
        ? "load"
        : error.operation === "decode"
          ? "decode"
          : "compareAndSet",
    message: error.message,
    cause: error.cause ?? error,
  })

const makeService = (config: Config, withLock: Locks["withLock"]): MachineStore.Service => {
  const now = config.now ?? Clock.currentTimeMillis
  return MachineStore.MachineStore.of({
    now: now.pipe(Effect.mapError(mapError)),
    load: (instanceId) => read(config, instanceId).pipe(Effect.mapError(mapError)),
    compareAndSet: (request) =>
      withLock(
        storageKey(config.namespace ?? "effect-state-machine", request.instanceId),
        Effect.gen(function* () {
          const candidate = yield* Schema.decodeUnknownEffect(MachineStore.MachineDocument)(
            request.document,
          ).pipe(Effect.mapError((cause) => boundaryError("encode", cause)))
          if (candidate.instanceId !== request.instanceId) {
            return yield* boundaryError(
              "encode",
              "Replacement document instanceId does not match the request",
            )
          }
          const observedAt = yield* now
          if (request.notAfter !== undefined && observedAt >= request.notAfter) {
            return { _tag: "Expired", observedAt } as const
          }
          const loaded = yield* read(config, request.instanceId)
          const existing = Option.getOrUndefined(loaded)
          const actualRevision =
            existing === undefined ? undefined : MachineStore.revision(existing.revision)
          const matches =
            request.expectedRevision === undefined
              ? existing === undefined
              : existing !== undefined && existing.revision === request.expectedRevision
          if (!matches) return { _tag: "Conflict", actualRevision, observedAt } as const
          const nextRevision = MachineStore.revision((existing?.revision ?? -1) + 1)
          yield* write(config, request.instanceId, { ...candidate, revision: nextRevision })
          return { _tag: "Committed", revision: nextRevision, observedAt } as const
        }),
      ).pipe(Effect.mapError(mapError)),
  })
}

/**
 * Constructs a cross-context-safe machine store using injected storage and lock capabilities.
 *
 * **When to use**
 *
 * Use when the same namespace may be written by multiple tabs, frames, or workers.
 *
 * **Gotchas**
 *
 * Construction fails with {@link UnsupportedPlatform} when no lock capability is supplied. Storage
 * and serialization failures occur later through the returned `MachineStore.Service` error channel.
 *
 * @see {@link layerSingleContext} for an explicit single-context opt-in.
 * @category constructors
 * @since 0.2.0
 */
export const make = (
  config: CoordinatedConfig,
): Effect.Effect<MachineStore.Service, UnsupportedPlatform> =>
  config.locks === undefined
    ? Effect.fail(
        new UnsupportedPlatform({
          feature: "web-locks",
          message: "LocalStorageMachineStore requires Web Locks for cross-context atomicity",
        }),
      )
    : Effect.succeed(makeService(config, config.locks.withLock))

/**
 * Provides a cross-context-safe localStorage-backed `MachineStore` Layer.
 *
 * **Gotchas**
 *
 * The Layer can fail to build with {@link UnsupportedPlatform}. Construct it in browser code and
 * provide the resulting store to `MachineEngine.layer` at the application boundary.
 *
 * @see {@link make} for direct service construction.
 * @category layers
 * @since 0.2.0
 */
export const layer = (
  config: CoordinatedConfig,
): Layer.Layer<MachineStore.MachineStore, UnsupportedPlatform> =>
  Layer.effect(MachineStore.MachineStore, make(config))

/**
 * Explicit same-page-only localStorage layer.
 *
 * This mode performs no cross-tab synchronization. Use it only when one JavaScript context can
 * access the configured namespace for the entire application lifetime.
 *
 * **When to use**
 *
 * Use only when the application can prove that a namespace has one writer for its full lifetime.
 *
 * **Gotchas**
 *
 * Multiple tabs, frames, workers, or independently mounted applications can lose updates because
 * this Layer deliberately performs no cross-context locking.
 *
 * @see {@link layer} for coordinated browser persistence.
 * @category layers
 * @since 0.2.0
 */
export const layerSingleContext = (config: Config): Layer.Layer<MachineStore.MachineStore> =>
  Layer.succeed(
    MachineStore.MachineStore,
    makeService(config, (_name, effect) => effect),
  )
