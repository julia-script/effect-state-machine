import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import {
  ActivityCommand,
  Checkpoint,
  Claim,
  DispatchRecord,
  type Json,
  MachineMessage,
  PersistedTreeRecord,
} from "./MachineRuntimeProtocol.js"

const MachineInstanceIdTypeId = Symbol.for("effect-state-machine/MachineStore/MachineInstanceId")
const DispatchIdTypeId = Symbol.for("effect-state-machine/MachineStore/DispatchId")
const EntryIdTypeId = Symbol.for("effect-state-machine/MachineStore/EntryId")
const ExecutionIdTypeId = Symbol.for("effect-state-machine/MachineStore/ExecutionId")
const RevisionTypeId = Symbol.for("effect-state-machine/MachineStore/Revision")
const FenceTypeId = Symbol.for("effect-state-machine/MachineStore/Fence")

/**
 * Stable identity of one logical machine instance.
 *
 * @category models
 * @since 0.2.0
 */
export type MachineInstanceId = string & {
  readonly [MachineInstanceIdTypeId]: typeof MachineInstanceIdTypeId
}

/**
 * Stable identity of one external dispatch attempt.
 *
 * @category models
 * @since 0.2.0
 */
export type DispatchId = string & { readonly [DispatchIdTypeId]: typeof DispatchIdTypeId }

/**
 * Stable identity of one active state entry.
 *
 * @category models
 * @since 0.2.0
 */
export type EntryId = string & { readonly [EntryIdTypeId]: typeof EntryIdTypeId }

/**
 * Stable identity supplied to one entry-owned work execution.
 *
 * **Gotchas**
 *
 * The engine preserves this identity across at-least-once redelivery, but an external system must
 * honor it to make its own side effect idempotent.
 *
 * @category models
 * @since 0.2.0
 */
export type ExecutionId = string & { readonly [ExecutionIdTypeId]: typeof ExecutionIdTypeId }

/**
 * Monotonic aggregate revision used by compare-and-set.
 *
 * @category models
 * @since 0.2.0
 */
export type Revision = number & { readonly [RevisionTypeId]: typeof RevisionTypeId }

/**
 * Monotonic claim fence used to reject stale workers.
 *
 * @category models
 * @since 0.2.0
 */
export type Fence = number & { readonly [FenceTypeId]: typeof FenceTypeId }

// These constructors are the single intentional nominal-erasure boundary for public brands.
const brand = <Value, Branded extends Value>(value: Value): Branded => value as Branded

/**
 * Brands a validated or reconstructed machine instance identity.
 *
 * **When to use**
 *
 * Use at trusted persistence and migration boundaries. New application identities should normally
 * come from {@link deriveMachineInstanceId} or a machine definition's `instanceId` operation.
 *
 * @category constructors
 * @since 0.2.0
 */
export const machineInstanceId = (value: string): MachineInstanceId =>
  brand<string, MachineInstanceId>(value)

/**
 * Brands a validated or reconstructed dispatch identity.
 *
 * @category constructors
 * @since 0.2.0
 */
export const dispatchId = (value: string): DispatchId => brand<string, DispatchId>(value)

/**
 * Brands a validated or reconstructed entry identity.
 *
 * @category constructors
 * @since 0.2.0
 */
export const entryId = (value: string): EntryId => brand<string, EntryId>(value)

/**
 * Brands a validated or reconstructed work execution identity.
 *
 * @category constructors
 * @since 0.2.0
 */
export const executionId = (value: string): ExecutionId => brand<string, ExecutionId>(value)

/**
 * Brands a validated aggregate revision.
 *
 * @category constructors
 * @since 0.2.0
 */
export const revision = (value: number): Revision => brand<number, Revision>(value)

/**
 * Brands a validated claim fence.
 *
 * @category constructors
 * @since 0.2.0
 */
export const fence = (value: number): Fence => brand<number, Fence>(value)

const encodePart = (value: string): string => `${value.length}:${value}`

const decodePart = (
  value: string,
  offset: number,
): Readonly<{ value: string; offset: number }> | undefined => {
  const separator = value.indexOf(":", offset)
  if (separator < 0) return undefined
  const length = Number(value.slice(offset, separator))
  if (!Number.isSafeInteger(length) || length < 0) return undefined
  const start = separator + 1
  const end = start + length
  if (end > value.length) return undefined
  return { value: value.slice(start, end), offset: end + 1 }
}

/**
 * Derives a total, versioned machine identity from definition and logical input identity.
 *
 * **Details**
 *
 * Both components use a length-prefixed encoding, so arbitrary Unicode and delimiter-like input
 * remain collision-safe. The same pair always produces the same identity.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveMachineInstanceId = (
  definitionId: string,
  idempotencyKey: string,
): MachineInstanceId =>
  machineInstanceId(`machine:v1:${encodePart(definitionId)}:${encodePart(idempotencyKey)}`)

/**
 * Derives a stable entry identity from one machine instance and entry sequence.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveEntryId = (instanceId: MachineInstanceId, sequence: number): EntryId =>
  entryId(`entry:v1:${encodePart(instanceId)}:${sequence}`)

/**
 * Derives a child runtime identity scoped to its parent instance and owning parent entry.
 *
 * **Details**
 *
 * Re-entering the parent creates a different entry identity and therefore a different child
 * identity, while redelivery within the same entry reconstructs the same child.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveChildMachineInstanceId = (
  parentInstanceId: MachineInstanceId,
  parentEntryId: EntryId,
  childName: string,
): MachineInstanceId =>
  machineInstanceId(
    `child:v1:${encodePart(parentInstanceId)}:${encodePart(parentEntryId)}:${encodePart(childName)}`,
  )

/**
 * Persisted ownership decoded from a derived child-machine identity.
 *
 * @category models
 * @since 0.2.0
 */
export interface ChildMachineIdentity {
  readonly parentInstanceId: MachineInstanceId
  readonly parentEntryId: EntryId
  readonly childName: string
}

/**
 * Parses identities produced by {@link deriveChildMachineInstanceId}.
 *
 * **Gotchas**
 *
 * Returns `undefined` for another identity version, malformed length prefixes, or trailing data.
 * It does not accept arbitrary application-authored strings as child identities.
 *
 * @category decoding
 * @since 0.2.0
 */
export const parseChildMachineInstanceId = (value: string): ChildMachineIdentity | undefined => {
  const prefix = "child:v1:"
  if (!value.startsWith(prefix)) return undefined
  const parent = decodePart(value, prefix.length)
  if (parent === undefined) return undefined
  const entry = decodePart(value, parent.offset)
  if (entry === undefined) return undefined
  const child = decodePart(value, entry.offset)
  if (child === undefined || child.offset - 1 !== value.length) return undefined
  return {
    parentInstanceId: machineInstanceId(parent.value),
    parentEntryId: entryId(entry.value),
    childName: child.value,
  }
}

/**
 * Derives one stable work identity for an invocation lane owned by an entry.
 *
 * **Details**
 *
 * The identity separates instance, entry, owner path, invocation name, and optional lane. It stays
 * stable across retries and redelivery until the owning entry is replaced.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveExecutionId = (
  instanceId: MachineInstanceId,
  entry: EntryId,
  ownerPath: string,
  invocationName: string,
  laneName?: string,
): ExecutionId =>
  executionId(
    `execution:v1:${encodePart(instanceId)}:${encodePart(entry)}:${encodePart(ownerPath)}:${encodePart(invocationName)}:${encodePart(laneName ?? "")}`,
  )

/**
 * Canonical JSON-compatible value crossing a machine-store boundary.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedValue = Json

/**
 * Schema for the persisted lifecycle of a root or nested runtime node.
 *
 * @category schemas
 * @since 0.2.0
 */
export const PersistedTerminalStatus = Schema.Literals([
  "running",
  "completed",
  "defected",
  "cancelled",
])

/**
 * Persisted lifecycle of a root or nested runtime node.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedTerminalStatus = Schema.Schema.Type<typeof PersistedTerminalStatus>

/**
 * Schema for one root or child runtime record in the flattened aggregate tree.
 *
 * @category schemas
 * @since 0.2.0
 */
export const PersistedRuntimeNode = Schema.Struct({
  key: Schema.String,
  actorId: Schema.String,
  definitionPath: Schema.String,
  parentActorId: Schema.NullOr(Schema.String),
  ownerStateTag: Schema.NullOr(Schema.String),
  invocation: Schema.NullOr(Schema.String),
  ownerPath: Schema.String,
  parentEntryId: Schema.NullOr(Schema.String),
  definitionId: Schema.String,
  persistenceVersion: Schema.String,
  input: Schema.Json,
  state: Schema.Json,
  status: PersistedTerminalStatus,
  rootEntryId: Schema.String,
  regionEntryIds: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
})

/**
 * Root or nested runtime record stored inside one machine aggregate.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedRuntimeNode = Schema.Schema.Type<typeof PersistedRuntimeNode>

/**
 * Schema for a flattened runtime tree whose first node is the root record.
 *
 * **Details**
 *
 * The array representation keeps runtime-selected child keys out of prototype-bearing records at
 * the persistence boundary.
 *
 * @category schemas
 * @since 0.2.0
 */
export const PersistedRuntimeTree = Schema.Struct({
  nodes: Schema.Array(PersistedRuntimeNode),
})

/**
 * Flattened root and nested runtime tree.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedRuntimeTree = Schema.Schema.Type<typeof PersistedRuntimeTree>

/**
 * Schema for a timer duration and authoritative absolute deadline owned by one entry.
 *
 * @category schemas
 * @since 0.2.0
 */
export const PersistedTimer = Schema.Struct({
  entryId: Schema.String,
  ownerPath: Schema.String,
  name: Schema.String,
  durationMillis: Schema.Number,
  dueAtEpochMillis: Schema.Number,
  messageId: Schema.String,
})

/**
 * Persisted entry-owned timer.
 *
 * **Details**
 *
 * `dueAtEpochMillis` is resolved from store time when entry commits. Resumption compares that same
 * absolute deadline instead of restarting the authored duration.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedTimer = Schema.Schema.Type<typeof PersistedTimer>

/**
 * Schema for stable work identity and its latest aggregate delivery state.
 *
 * @category schemas
 * @since 0.2.0
 */
export const PersistedExecution = Schema.Struct({
  id: Schema.String,
  entryId: Schema.String,
  ownerPath: Schema.String,
  invocation: Schema.String,
  lane: Schema.String,
  status: Schema.Literals(["pending", "claimed", "done", "cancelled"]),
  attempt: Schema.Number,
  fence: Schema.Number,
})

/**
 * Persisted stable work execution record.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedExecution = Schema.Schema.Type<typeof PersistedExecution>

/**
 * Schema for application-version state exposed to a definition migration.
 *
 * @category schemas
 * @since 0.2.0
 */
export const PersistedMigrationState = Schema.Struct({
  definitionId: Schema.String,
  persistenceVersion: Schema.String,
  state: Schema.Json,
})

/**
 * Application-version state exposed to a definition migration.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedMigrationState = Schema.Schema.Type<typeof PersistedMigrationState>

/**
 * Schema for a machine-mailbox delivery and its claim bookkeeping.
 *
 * @category schemas
 * @since 0.2.0
 */
export const StoredMachineDelivery = Schema.Struct({
  value: MachineMessage,
  sequence: Schema.Number,
  status: Schema.Literals(["pending", "claimed", "done", "cancelled"]),
  claim: Schema.NullOr(Claim),
  attempt: Schema.Number,
  fence: Schema.Number,
})

/**
 * Stored machine-mailbox delivery.
 *
 * @category models
 * @since 0.2.0
 */
export type StoredMachineDelivery = Schema.Schema.Type<typeof StoredMachineDelivery>

/**
 * Schema for an activity command and its claim bookkeeping.
 *
 * @category schemas
 * @since 0.2.0
 */
export const StoredActivityDelivery = Schema.Struct({
  value: ActivityCommand,
  sequence: Schema.Number,
  status: Schema.Literals(["pending", "claimed", "done", "cancelled"]),
  claim: Schema.NullOr(Claim),
  attempt: Schema.Number,
  fence: Schema.Number,
})

/**
 * Stored activity-command delivery.
 *
 * @category models
 * @since 0.2.0
 */
export type StoredActivityDelivery = Schema.Schema.Type<typeof StoredActivityDelivery>

/**
 * Schema for a caller-keyed dispatch record.
 *
 * @category schemas
 * @since 0.2.0
 */
export const StoredDispatch = Schema.Struct({
  idempotencyKey: Schema.String,
  record: DispatchRecord,
})

/**
 * Stored dispatch idempotency record.
 *
 * @category models
 * @since 0.2.0
 */
export type StoredDispatch = Schema.Schema.Type<typeof StoredDispatch>

/**
 * Schema for the complete opaque aggregate persisted for one root machine.
 *
 * Adapters compare and store this document but do not interpret its queue or statechart fields.
 *
 * @category schemas
 * @since 0.2.0
 */
const MachineDocumentStruct = Schema.Struct({
  formatVersion: Schema.Literal(2),
  revision: Schema.Number,
  instanceId: Schema.String,
  definition: Schema.Struct({ id: Schema.String, version: Schema.String }),
  input: Schema.Json,
  status: PersistedTerminalStatus,
  runtime: PersistedRuntimeTree,
  checkpoint: Checkpoint,
  messages: Schema.Array(StoredMachineDelivery),
  timers: Schema.Array(PersistedTimer),
  activities: Schema.Array(StoredActivityDelivery),
  dispatches: Schema.Array(StoredDispatch),
  executions: Schema.Array(PersistedExecution),
  migration: PersistedMigrationState,
  messageTombstones: Schema.Array(Schema.String),
  executionTombstones: Schema.Array(Schema.String),
  nestedDocuments: Schema.Array(Schema.Json),
  nextSequence: Schema.Number,
  tree: Schema.Struct({
    rootActorId: Schema.String,
    nextSequence: Schema.Number,
    records: Schema.Array(PersistedTreeRecord),
  }),
})

/**
 * Schema for a complete machine aggregate whose tree journal is internally consistent.
 *
 * Tree sequences are positional and gapless, record identities are unique, and the journal root
 * is derived from the aggregate instance. These checks keep custom adapters from returning a
 * structurally valid document that would make replay ambiguous.
 *
 * @category schemas
 * @since 0.2.0
 */
export const MachineDocument = MachineDocumentStruct.pipe(
  Schema.refine(
    (document): document is typeof document => {
      if (
        document.tree.rootActorId !== `actor:${document.instanceId}` ||
        document.tree.nextSequence !== document.tree.records.length
      ) {
        return false
      }
      const keys = new Set<string>()
      for (let index = 0; index < document.tree.records.length; index++) {
        const record = document.tree.records[index]
        if (record === undefined || record.sequence !== index || keys.has(record.key)) return false
        keys.add(record.key)
      }
      return true
    },
    { message: "machine tree journal must have a stable root, gapless sequences, and unique keys" },
  ),
)

/**
 * Complete revisioned aggregate for one root machine instance.
 *
 * @category models
 * @since 0.2.0
 */
export type MachineDocument = Schema.Schema.Type<typeof MachineDocument>

/**
 * Derives the canonical aggregate envelopes mirrored from one validated runtime checkpoint.
 *
 * Engine code uses this constructor so adapters never need to interpret machine state. Nested
 * child records may be supplied when planning a complete runtime-tree replacement.
 *
 * **When to use**
 *
 * Use in engine integrations, migrations, and store fixtures that must rebuild the aggregate
 * envelopes corresponding to a validated checkpoint.
 *
 * @category constructors
 * @since 0.2.0
 */
export const documentMetadata = (
  checkpoint: Schema.Schema.Type<typeof Checkpoint>,
  input: Json = null,
  children: ReadonlyArray<PersistedRuntimeNode> = [],
): Pick<
  MachineDocument,
  "definition" | "input" | "status" | "runtime" | "timers" | "executions" | "migration"
> => ({
  definition: { id: checkpoint.definitionId, version: checkpoint.persistenceVersion },
  input,
  status: checkpoint.status,
  runtime: {
    nodes: [
      {
        key: "root",
        actorId: `actor:${checkpoint.instanceId}`,
        definitionPath: "root",
        parentActorId: null,
        ownerStateTag: null,
        invocation: null,
        ownerPath: "",
        parentEntryId: null,
        definitionId: checkpoint.definitionId,
        persistenceVersion: checkpoint.persistenceVersion,
        input,
        state: checkpoint.state,
        status: checkpoint.status,
        rootEntryId: checkpoint.rootEntryId,
        regionEntryIds: Object.entries(checkpoint.regionEntryIds),
      },
      ...children,
    ],
  },
  timers: checkpoint.timers,
  executions: [],
  migration: {
    definitionId: checkpoint.definitionId,
    persistenceVersion: checkpoint.persistenceVersion,
    state: checkpoint.state,
  },
})

/**
 * Expected state and replacement document for one atomic compare-and-set write.
 *
 * **Details**
 *
 * An absent `expectedRevision` means the aggregate must not exist. `notAfter`, when present, is an
 * exclusive store-time deadline checked atomically with the revision and replacement.
 *
 * @category models
 * @since 0.2.0
 */
export interface CompareAndSetRequest {
  readonly instanceId: MachineInstanceId
  readonly expectedRevision: Revision | undefined
  readonly document: MachineDocument
  readonly notAfter?: number
}

/**
 * Successful compare-and-set result with the store-assigned revision and observation time.
 *
 * @category models
 * @since 0.2.0
 */
export interface Committed {
  readonly _tag: "Committed"
  readonly revision: Revision
  readonly observedAt: number
}

/**
 * Compare-and-set result when another writer changed or created the aggregate.
 *
 * @category models
 * @since 0.2.0
 */
export interface Conflict {
  readonly _tag: "Conflict"
  readonly actualRevision: Revision | undefined
  readonly observedAt: number
}

/**
 * Compare-and-set result when its exclusive store-time deadline has elapsed.
 *
 * @category models
 * @since 0.2.0
 */
export interface Expired {
  readonly _tag: "Expired"
  readonly observedAt: number
}

/**
 * Result of atomically checking revision, optional deadline, and replacement.
 *
 * @category models
 * @since 0.2.0
 */
export type CompareAndSetResult = Committed | Conflict | Expired

/**
 * Expected failure from a machine-store adapter boundary.
 *
 * **Details**
 *
 * `operation` identifies the stable service operation and `cause` retains diagnostic ancestry for
 * adapter, Schema, or serialization failures.
 *
 * @category errors
 * @since 0.2.0
 */
export class MachineStoreError extends Data.TaggedError("MachineStoreError")<{
  readonly operation: "now" | "load" | "compareAndSet" | "decode" | "encode"
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Minimal aggregate persistence contract consumed by the machine engine.
 *
 * **Details**
 *
 * The store owns authoritative time, loading by instance identity, and atomic whole-document
 * replacement. Mailbox ordering, claims, timers, work, child machines, and migrations remain
 * engine behavior and must not be reimplemented by adapters.
 *
 * **Gotchas**
 *
 * `compareAndSet` must check `expectedRevision`, optional `notAfter`, and replacement as one atomic
 * operation. A separate time read followed by a write does not safely fence an expired owner.
 *
 * @category services
 * @since 0.2.0
 */
export interface Service {
  readonly now: Effect.Effect<number, MachineStoreError>
  readonly load: (
    instanceId: MachineInstanceId,
  ) => Effect.Effect<Option.Option<MachineDocument>, MachineStoreError>
  readonly compareAndSet: (
    request: CompareAndSetRequest,
  ) => Effect.Effect<CompareAndSetResult, MachineStoreError>
}

/**
 * Effect service for revisioned machine aggregate persistence.
 *
 * **When to use**
 *
 * Use as the service tag provided to `MachineEngine.layer`, either through a bundled adapter or a
 * custom adapter that passes the primitive store conformance corpus.
 *
 * @see {@link Service} for the atomic adapter contract.
 * @category services
 * @since 0.2.0
 */
export class MachineStore extends Context.Service<MachineStore, Service>()(
  "effect-state-machine/MachineStore",
) {}

const validateDocument = (
  operation: "load" | "compareAndSet",
  document: unknown,
): Effect.Effect<MachineDocument, MachineStoreError> =>
  Effect.gen(function* () {
    return yield* Schema.decodeUnknownEffect(MachineDocument)(document).pipe(
      Effect.mapError(
        (cause) =>
          new MachineStoreError({
            operation,
            message: `Invalid machine document: ${String(cause)}`,
            cause,
          }),
      ),
    )
  })

/**
 * Creates a process-local store whose state lives for the returned service lifetime.
 *
 * **When to use**
 *
 * Use for isolated tests, examples, and custom Layer composition that deliberately accepts
 * process-local persistence.
 *
 * **Gotchas**
 *
 * Every call creates a new empty database. The service uses Effect's clock, so `TestClock` can
 * deterministically exercise compare-and-set deadlines.
 *
 * @see {@link layerMemory} for Layer-based provisioning.
 * @category constructors
 * @since 0.2.0
 */
export const makeMemory: () => Effect.Effect<Service> = Effect.fnUntraced(function* () {
  const documents = yield* Ref.make<ReadonlyMap<string, MachineDocument>>(new Map())

  return MachineStore.of({
    now: Clock.currentTimeMillis,
    load: Effect.fnUntraced(function* (id) {
      const current = (yield* Ref.get(documents)).get(id)
      if (current === undefined) return Option.none()
      return Option.some(yield* validateDocument("load", current))
    }),
    compareAndSet: Effect.fnUntraced(function* (request) {
      const candidate = yield* validateDocument("compareAndSet", request.document)
      if (candidate.instanceId !== request.instanceId) {
        return yield* new MachineStoreError({
          operation: "compareAndSet",
          message: "Replacement document instanceId does not match the request",
        })
      }
      const observedAt = yield* Clock.currentTimeMillis
      if (request.notAfter !== undefined && observedAt >= request.notAfter) {
        return { _tag: "Expired", observedAt } as const
      }
      return yield* Ref.modify(
        documents,
        (current): readonly [CompareAndSetResult, ReadonlyMap<string, MachineDocument>] => {
          const existing = current.get(request.instanceId)
          const actualRevision = existing === undefined ? undefined : revision(existing.revision)
          const matches =
            request.expectedRevision === undefined
              ? existing === undefined
              : existing !== undefined && existing.revision === request.expectedRevision
          if (!matches) {
            return [{ _tag: "Conflict", actualRevision, observedAt } as const, current]
          }
          const nextRevision = revision((existing?.revision ?? -1) + 1)
          const next = new Map(current)
          next.set(request.instanceId, { ...candidate, revision: nextRevision })
          return [{ _tag: "Committed", revision: nextRevision, observedAt } as const, next]
        },
      )
    }),
  })
})

/**
 * Layer providing a fresh process-local machine store.
 *
 * **Gotchas**
 *
 * Building the Layer again creates a separate empty database. Share one Layer value across every
 * engine that must load the same machine instances.
 *
 * @see {@link makeMemory} for direct service construction.
 * @category layers
 * @since 0.2.0
 */
export const layerMemory: Layer.Layer<MachineStore> = Layer.effect(MachineStore, makeMemory())
