import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Machine from "./Machine.js"
import { ActorDispatchError, type ActorId, DefinitionPath, type MachineHandle } from "./Machine.js"
import { MachineEngine, type Service as MachineEngineService } from "./MachineEngineService.js"
import * as MachineRuntime from "./MachineRuntime.js"
import {
  instanceId as durableInstanceId,
  MachineEncodingError,
  type MachineError,
  type PersistedTreeRecordBody,
  persistenceVersion,
  Store,
} from "./MachineRuntimeProtocol.js"
import * as MachineStore from "./MachineStore.js"
import { makeMachineRuntimeStore } from "./MachineStoreRuntime.js"

/**
 * Worker and polling policy shared by every machine run beneath one engine Layer.
 *
 * **Details**
 *
 * Lease durations apply to machine-message and activity claims, `pollIntervalMillis` controls idle
 * store polling, and `activityWorkerCount` bounds the local activity workers created per instance.
 * Omitted fields use engine defaults.
 *
 * @category configuration
 * @since 0.2.0
 */
export interface Config {
  readonly machineLeaseMillis?: number
  readonly activityLeaseMillis?: number
  readonly pollIntervalMillis?: number
  readonly activityWorkerCount?: number
}

export { MachineEngine }

const treeRecordBody = (body: PersistedTreeRecordBody): Machine.TreeRecordBody => {
  switch (body._tag) {
    case "ActorStarted":
      return {
        _tag: body._tag,
        machineId: body.machineId,
        ...(body.parentActorId === undefined
          ? {}
          : { parentActorId: Machine.ActorId.make(body.parentActorId) }),
        ...(body.ownerStateTag === undefined ? {} : { ownerStateTag: body.ownerStateTag }),
        ...(body.invocation === undefined ? {} : { invocation: body.invocation }),
        ...(body.instanceId === undefined ? {} : { instanceId: body.instanceId }),
      }
    case "Inspection":
      return body
    case "StateSnapshot":
      return body
    case "ActorTerminated":
      return body
  }
}

const persistentService = (
  config: Config,
): Effect.Effect<MachineEngineService, never, MachineStore.MachineStore> =>
  Effect.gen(function* () {
    const store = yield* MachineStore.MachineStore
    const runDefinition = <
      InputSchema extends Schema.Top,
      StateSchema extends Machine.TaggedSchema,
      EventSchema extends Machine.TaggedSchema,
      States extends Machine.StatesConfig<
        Schema.Schema.Type<StateSchema>,
        Schema.Schema.Type<EventSchema>
      >,
    >(
      definition: Machine.MachineDefinition<InputSchema, StateSchema, EventSchema, States>,
      input: Schema.Schema.Type<InputSchema>,
    ) =>
      Effect.gen(function* () {
        const decodingContext = yield* Effect.context()
        const instance = definition.instanceId(input)
        const durableStore = yield* makeMachineRuntimeStore(store, instance)
        const rootActorId = Machine.ActorId.make(`actor:${instance}`)
        const retained = yield* durableStore.loadTree(durableInstanceId(instance))
        const journal = yield* SubscriptionRef.make(retained)
        type RegistryEntry =
          | Readonly<{
              status: "live"
              can: (event: unknown) => Effect.Effect<boolean, MachineError>
              send: (event: unknown) => Effect.Effect<void, MachineError>
            }>
          | Readonly<{ status: "starting" }>
          | Readonly<{ status: "ended" }>
        const registry = yield* Ref.make<ReadonlyMap<Machine.ActorId, RegistryEntry>>(new Map())
        const observer: MachineRuntime.RuntimeObserver = {
          refresh: Effect.gen(function* () {
            const records = yield* durableStore.loadTree(durableInstanceId(instance))
            yield* SubscriptionRef.update(journal, (current) =>
              records.length > current.length ? records : current,
            )
            const started = records
              .filter((record) => record.body._tag === "ActorStarted")
              .map((record) => Machine.ActorId.make(record.actorId))
            const ended = records
              .filter((record) => record.body._tag === "ActorTerminated")
              .map((record) => Machine.ActorId.make(record.actorId))
            if (started.length > 0 || ended.length > 0) {
              yield* Ref.update(registry, (entries) => {
                const updated = new Map(entries)
                for (const actorId of started) {
                  if (!updated.has(actorId)) updated.set(actorId, { status: "starting" })
                }
                for (const actorId of ended) updated.set(actorId, { status: "ended" })
                return updated
              })
            }
          }),
          register: (actor, adapter) =>
            Ref.update(registry, (entries) => {
              const current = entries.get(actor.actorId)
              return current?.status === "ended"
                ? entries
                : new Map(entries).set(actor.actorId, { status: "live", ...adapter })
            }),
          terminate: (actor) =>
            Ref.update(registry, (entries) =>
              new Map(entries).set(actor.actorId, { status: "ended" }),
            ),
        }
        yield* Effect.forever(
          Effect.sleep(config.pollIntervalMillis ?? 250).pipe(Effect.andThen(observer.refresh)),
        ).pipe(Effect.forkScoped)
        const durable = yield* MachineRuntime.run(definition as never, input as never, {
          instanceId: durableInstanceId(instance),
          persistenceVersion: persistenceVersion(definition.version),
          migrations: definition.migrations,
          actor: { actorId: rootActorId, definitionPath: DefinitionPath.root },
          observer,
          ...config,
        }).pipe(Effect.provideService(Store, durableStore))

        const awaitRegistryEntry = (
          target: Machine.ActorId,
          remaining = 256,
        ): Effect.Effect<RegistryEntry | undefined, ActorDispatchError> =>
          Effect.gen(function* () {
            const entry = (yield* Ref.get(registry)).get(target)
            if (entry?.status !== "starting" || remaining === 0) return entry
            yield* Effect.yieldNow
            yield* observer.refresh.pipe(
              Effect.mapError(
                () => new ActorDispatchError({ actorId: target, reason: "unaccepted" }),
              ),
            )
            return yield* awaitRegistryEntry(target, remaining - 1)
          })

        const actorId = rootActorId as ActorId
        const send = (
          event: Machine.MachineEvent<typeof definition>,
          options?: Readonly<{ idempotencyKey?: string }>,
        ) =>
          Effect.gen(function* () {
            const key =
              options?.idempotencyKey ??
              (yield* Effect.try({
                try: () => globalThis.crypto.randomUUID(),
                catch: (cause) =>
                  new MachineEncodingError({
                    operation: "generate dispatch idempotency key",
                    message: "Unable to generate a fresh dispatch idempotency key",
                    cause,
                  }),
              }))
            yield* durable.send(event as never, {
              idempotencyKey: options?.idempotencyKey ?? `${instance}:dispatch:${key}`,
            })
          })
        const observeTerminal: Effect.Effect<
          Machine.MachineCompletion<typeof definition>,
          MachineError
        > = Effect.suspend(() =>
          durable.status.pipe(
            Effect.flatMap((status) => {
              if (status === "completed") {
                return durable.snapshot.pipe(
                  // A completed checkpoint is validated against the definition's final-state union.
                  Effect.map((state) => state as Machine.MachineCompletion<typeof definition>),
                )
              }
              if (status === "defected") {
                return durable.snapshot.pipe(Effect.flatMap(() => durable.completion))
              }
              return Effect.sleep(config.pollIntervalMillis ?? 25).pipe(
                Effect.andThen(observeTerminal),
              )
            }),
          ),
        )
        const records = SubscriptionRef.changes(journal).pipe(
          Stream.mapAccum(
            () => 0,
            (seen, retainedRecords) => [
              retainedRecords.length,
              retainedRecords.slice(seen).map(
                (record): Machine.TreeRecord => ({
                  sequence: record.sequence,
                  actorId: Machine.ActorId.make(record.actorId),
                  definitionPath: Machine.DefinitionPath.make(record.definitionPath),
                  body: treeRecordBody(record.body),
                }),
              ),
            ],
          ),
        )
        const tree: Machine.MachineTreeHandle = {
          rootActorId: actorId,
          records,
          dispatch: (target, event) =>
            Effect.gen(function* () {
              let entry = (yield* Ref.get(registry)).get(target)
              if (entry === undefined) {
                const retainedRecords = yield* SubscriptionRef.get(journal)
                const ended = retainedRecords.some(
                  (record) => record.actorId === target && record.body._tag === "ActorTerminated",
                )
                if (ended) {
                  return yield* new ActorDispatchError({ actorId: target, reason: "ended" })
                }
                const started = retainedRecords.some(
                  (record) => record.actorId === target && record.body._tag === "ActorStarted",
                )
                if (!started) {
                  return yield* new ActorDispatchError({ actorId: target, reason: "unknown" })
                }
                yield* Ref.update(registry, (entries) =>
                  entries.has(target)
                    ? entries
                    : new Map(entries).set(target, { status: "starting" }),
                )
                entry = yield* awaitRegistryEntry(target)
              }
              if (entry?.status === "ended") {
                return yield* new ActorDispatchError({ actorId: target, reason: "ended" })
              }
              if (entry === undefined || entry.status === "starting") {
                return yield* new ActorDispatchError({ actorId: target, reason: "unaccepted" })
              }
              if (
                !(yield* entry
                  .can(event)
                  .pipe(
                    Effect.mapError(
                      () => new ActorDispatchError({ actorId: target, reason: "unaccepted" }),
                    ),
                  ))
              ) {
                return yield* new ActorDispatchError({ actorId: target, reason: "unaccepted" })
              }
              yield* entry.send(event).pipe(
                Effect.mapError(
                  (error) =>
                    new ActorDispatchError({
                      actorId: target,
                      reason: error._tag === "CompletedInstance" ? "ended" : "unaccepted",
                    }),
                ),
              )
            }),
        }
        const rootInspectionRecords = records.pipe(
          Stream.filter(
            (record) => record.actorId === actorId && record.body._tag === "Inspection",
          ),
        )
        const inspection = rootInspectionRecords.pipe(
          Stream.map((record) =>
            record.body._tag === "Inspection"
              ? record.body.metadata
              : ({
                  _tag: "MachineStarted",
                  machineId: definition.id,
                  initialStateTag: "unknown",
                } as const),
          ),
        )
        const handle: MachineHandle<
          Machine.MachineState<typeof definition>,
          Machine.MachineEvent<typeof definition>,
          Machine.MachineCompletion<typeof definition>,
          MachineError
        > = {
          instanceId: instance,
          actorId,
          definitionPath: DefinitionPath.root,
          tree,
          snapshot: durable.snapshot as never,
          changes: durable.changes as never,
          inspection,
          inspect: (projectEvent) =>
            rootInspectionRecords.pipe(
              Stream.mapEffect((record) => {
                if (record.body._tag !== "Inspection" || record.body.event === undefined) {
                  return Effect.succeed(
                    record.body._tag === "Inspection"
                      ? record.body.metadata
                      : ({
                          _tag: "MachineStarted",
                          machineId: definition.id,
                          initialStateTag: "unknown",
                        } as const),
                  )
                }
                const body = record.body
                return Schema.decodeUnknownEffect(Schema.toCodecJson(definition.schemas.event))(
                  body.event,
                ).pipe(
                  Effect.provide(decodingContext),
                  Effect.orDie,
                  Effect.map((event) => ({
                    ...body.metadata,
                    details: projectEvent(event as Machine.MachineEvent<typeof definition>),
                  })),
                )
              }),
            ) as never,
          completion: Effect.raceFirst(durable.completion, observeTerminal),
          send,
          can: (event) => durable.can(event as never),
          status: durable.status,
        }
        return handle
      })
    return MachineEngine.of({ run: runDefinition as MachineEngineService["run"] })
  })

/**
 * Builds a machine-engine Layer from the supplied {@link MachineStore.MachineStore} service.
 *
 * **When to use**
 *
 * Use with a persistent or custom aggregate-store Layer when machine state must outlive the current
 * process or browser page.
 *
 * **Gotchas**
 *
 * This Layer still requires `MachineStore.MachineStore`; provide the adapter at the application
 * boundary and share the resulting Layer for every run that must observe the same aggregates.
 *
 * @see {@link layerMemory} for an explicit process-local composition.
 * @category layers
 * @since 0.2.0
 */
export const layer = (
  config: Config = {},
): Layer.Layer<MachineEngine, never, MachineStore.MachineStore> =>
  Layer.effect(MachineEngine, persistentService(config))

/**
 * Explicit volatile composition of the unified engine with a process-local aggregate store.
 *
 * One Layer value owns one shared in-memory database. It uses the same persisted document, timer,
 * mailbox, lease, and activity protocol as every restart-capable adapter.
 *
 * **When to use**
 *
 * Use for tests, examples, and applications that deliberately accept process-local persistence.
 *
 * **Gotchas**
 *
 * Building this Layer again creates a new empty database. Reuse one Layer value when separate runs
 * must address the same machine instance.
 *
 * @see {@link layer} for composing a restart-capable store.
 * @category layers
 * @since 0.2.0
 */
export const layerMemory = (config: Config = {}): Layer.Layer<MachineEngine> =>
  layer(config).pipe(Layer.provide(MachineStore.layerMemory))

/**
 * Runs or resumes a machine definition through the supplied `MachineEngine` service.
 *
 * **Details**
 *
 * This is the data-first counterpart of a definition's `run` method. The returned Effect retains
 * the definition-derived state, event, completion, failure, Scope, and application-service types.
 *
 * @category running
 * @since 0.2.0
 */
export const run = <
  InputSchema extends Schema.Top,
  StateSchema extends Machine.TaggedSchema,
  EventSchema extends Machine.TaggedSchema,
  States extends Machine.StatesConfig<
    Schema.Schema.Type<StateSchema>,
    Schema.Schema.Type<EventSchema>
  >,
>(
  definition: Machine.MachineDefinition<InputSchema, StateSchema, EventSchema, States>,
  input: Schema.Schema.Type<InputSchema>,
): Machine.RunEffect<StateSchema, EventSchema, States> => definition.run(input)
