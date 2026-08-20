import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import { encodeComponent } from "./Internal.js"
import type * as Machine from "./Machine.js"

declare const InstanceIdTypeId: unique symbol
declare const EntryIdTypeId: unique symbol
declare const MessageIdTypeId: unique symbol
declare const ExecutionKeyTypeId: unique symbol
declare const DeliveryIdTypeId: unique symbol
declare const RevisionTypeId: unique symbol
declare const PersistenceVersionTypeId: unique symbol

// Durable brands are compile-time-only, so every public constructor erases through this one seam.
const brand = <Value, Branded extends Value>(value: Value): Branded => value as Branded

/**
 * Stable identity of one durable machine instance.
 *
 * **Details**
 *
 * The application chooses this value and must reuse it to resume the same checkpoint, mailbox,
 * timers, and activities.
 *
 * @category models
 * @since 0.2.0
 */
export type InstanceId = string & { readonly [InstanceIdTypeId]: typeof InstanceIdTypeId }

/**
 * Identity of one committed entry into a state or region node.
 *
 * **Details**
 *
 * Entry identity survives process restarts and changes on explicit re-entry, allowing stale timer
 * and activity deliveries to be rejected even when they name the same authored node.
 *
 * @category models
 * @since 0.2.0
 */
export type EntryId = string & { readonly [EntryIdTypeId]: typeof EntryIdTypeId }

/**
 * Stable identity of a message in a durable machine mailbox.
 *
 * @category models
 * @since 0.2.0
 */
export type MessageId = string & { readonly [MessageIdTypeId]: typeof MessageIdTypeId }

/**
 * Stable idempotency key for one invoked Effect or aggregate lane execution.
 *
 * **Gotchas**
 *
 * The runner preserves this key across at-least-once activity redelivery, but an external system
 * must use it to make its own side effect idempotent.
 *
 * @category models
 * @since 0.2.0
 */
export type ExecutionKey = string & {
  readonly [ExecutionKeyTypeId]: typeof ExecutionKeyTypeId
}

/**
 * Identity of a claimable machine-message or activity delivery.
 *
 * @category models
 * @since 0.2.0
 */
export type DeliveryId = string & { readonly [DeliveryIdTypeId]: typeof DeliveryIdTypeId }

/**
 * Monotonic checkpoint revision used for optimistic store commits.
 *
 * @category models
 * @since 0.2.0
 */
export type Revision = number & { readonly [RevisionTypeId]: typeof RevisionTypeId }

/**
 * Application-owned version of a durable machine definition and its persisted data.
 *
 * **Details**
 *
 * This version is independent of the library's checkpoint format version. Changing it requires a
 * compatible {@link Migration} when an older checkpoint already exists.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistenceVersion = string & {
  readonly [PersistenceVersionTypeId]: typeof PersistenceVersionTypeId
}

/**
 * Brands a caller-chosen string as a durable machine instance identity.
 *
 * **Gotchas**
 *
 * This constructor does not validate or normalize the value. Applications must prevent accidental
 * reuse between logically different machines.
 *
 * @category constructors
 * @since 0.2.0
 */
export const instanceId = (value: string): InstanceId => brand<string, InstanceId>(value)

/**
 * Brands a persisted string as a durable state-entry identity.
 *
 * **When to use**
 *
 * Use when implementing a store adapter or migration. Runners normally create entry identities
 * with {@link deriveEntryId}.
 *
 * @category constructors
 * @since 0.2.0
 */
export const entryId = (value: string): EntryId => brand<string, EntryId>(value)

/**
 * Brands a persisted string as a durable mailbox message identity.
 *
 * **When to use**
 *
 * Use when implementing a store adapter or migration. Runners normally create message identities
 * with {@link deriveMessageId}.
 *
 * @category constructors
 * @since 0.2.0
 */
export const messageId = (value: string): MessageId => brand<string, MessageId>(value)

/**
 * Brands a persisted string as an activity execution key.
 *
 * **When to use**
 *
 * Use when reconstructing migration data. Authored work receives the runner-derived key through
 * its execution metadata.
 *
 * @category constructors
 * @since 0.2.0
 */
export const executionKey = (value: string): ExecutionKey => brand<string, ExecutionKey>(value)

/**
 * Brands a persisted string as a claimable delivery identity.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deliveryId = (value: string): DeliveryId => brand<string, DeliveryId>(value)

/**
 * Brands a persisted number as a checkpoint revision.
 *
 * **Gotchas**
 *
 * This constructor does not check that the value is non-negative or monotonic; the store adapter
 * owns those invariants.
 *
 * @category constructors
 * @since 0.2.0
 */
export const revision = (value: number): Revision => brand<number, Revision>(value)

/**
 * Brands an application-chosen string as a persistence version.
 *
 * @category constructors
 * @since 0.2.0
 */
export const persistenceVersion = (value: string): PersistenceVersion =>
  brand<string, PersistenceVersion>(value)

/**
 * Derives the deterministic identity of an entry created by a target checkpoint revision.
 *
 * **When to use**
 *
 * Use in migrations that replace an active entry or its owner path. Normal runner transitions
 * derive this identity automatically.
 *
 * **Gotchas**
 *
 * Unpaired UTF-16 surrogates are normalized to U+FFFD before encoding. Well-formed inputs retain
 * their existing byte-for-byte identities; malformed spellings may normalize to the same key.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveEntryId = (
  instance: InstanceId,
  targetRevision: Revision,
  ownerPath: string,
): EntryId =>
  entryId(`${encodeComponent(instance)}:${targetRevision}:${encodeComponent(ownerPath)}`)

/**
 * Derives a deterministic mailbox message identity from its owning transition and name.
 *
 * **Details**
 *
 * Re-deriving the same components returns the same key, allowing store adapters to suppress
 * duplicate publication. Components use the same total malformed-UTF-16 normalization as
 * {@link deriveEntryId}.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveMessageId = (
  instance: InstanceId,
  targetRevision: Revision,
  ownerPath: string,
  name: string,
): MessageId =>
  messageId(
    `${encodeComponent(instance)}:${targetRevision}:${encodeComponent(ownerPath)}:${encodeComponent(name)}`,
  )

/**
 * Derives the stable idempotency key for an invoked Effect or named aggregate lane.
 *
 * **Details**
 *
 * Redeliveries for the same entry and lane keep this key. A new entry identity produces a new key,
 * even when the authored state and invocation names are unchanged. Components use the same total
 * malformed-UTF-16 normalization as {@link deriveEntryId}.
 *
 * @category constructors
 * @since 0.2.0
 */
export const deriveExecutionKey = (
  instance: InstanceId,
  entry: EntryId,
  ownerPath: string,
  invocation: string,
  lane = "",
): ExecutionKey =>
  executionKey(
    `${encodeComponent(instance)}:${encodeComponent(entry)}:${encodeComponent(ownerPath)}:${encodeComponent(invocation)}:${encodeComponent(lane)}`,
  )

/**
 * Canonical JSON-compatible value accepted by the durable store boundary.
 *
 * @category models
 * @since 0.2.0
 */
export type Json = Schema.Schema.Type<typeof Schema.Json>

/**
 * Schema for the persisted summary of a defect that stopped a durable instance.
 *
 * @category schemas
 * @since 0.2.0
 */
export const DurableDefectSummary = Schema.Struct({
  category: Schema.Literals(["protocol", "definition", "encoding", "activity", "store", "unknown"]),
  name: Schema.String,
  message: Schema.String,
})

/**
 * Persisted summary of a defect that stopped a durable instance.
 *
 * @category models
 * @since 0.2.0
 */
export type DurableDefectSummary = Schema.Schema.Type<typeof DurableDefectSummary>

/**
 * Schema for an entry-owned timer and its absolute store-clock deadline.
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
 * Persisted entry-owned timer whose original deadline survives runner restarts.
 *
 * @category models
 * @since 0.2.0
 */
export type PersistedTimer = Schema.Schema.Type<typeof PersistedTimer>

/**
 * Schema for checkpointed progress of an `all` or `race` invocation.
 *
 * @category schemas
 * @since 0.2.0
 */
export const AggregateProgress = Schema.Struct({
  kind: Schema.Literals(["all", "race"]),
  entryId: Schema.String,
  ownerPath: Schema.String,
  invocation: Schema.String,
  state: Schema.Json,
  parentState: Schema.NullOr(Schema.Json),
  pending: Schema.Array(Schema.String),
  running: Schema.Array(Schema.String),
  completed: Schema.Record(Schema.String, Schema.Json),
  failures: Schema.Record(Schema.String, Schema.Json),
})

/**
 * Checkpointed lane outcomes and pending work for one aggregate invocation.
 *
 * @category models
 * @since 0.2.0
 */
export type AggregateProgress = Schema.Schema.Type<typeof AggregateProgress>

/**
 * Schema for the authoritative persisted state of a durable machine instance.
 *
 * **Details**
 *
 * A checkpoint contains encoded machine state, lifecycle status, entry identities, timers,
 * aggregate progress, and the revision used by optimistic commits.
 *
 * @category schemas
 * @since 0.2.0
 */
export const Checkpoint = Schema.Struct({
  formatVersion: Schema.Number,
  definitionId: Schema.String,
  persistenceVersion: Schema.String,
  instanceId: Schema.String,
  revision: Schema.Number,
  status: Schema.Literals(["running", "completed", "defected"]),
  state: Schema.Json,
  rootEntryId: Schema.String,
  regionEntryIds: Schema.Record(Schema.String, Schema.String),
  timers: Schema.Array(PersistedTimer),
  aggregates: Schema.Array(AggregateProgress),
  nextSequence: Schema.Number,
  defect: Schema.NullOr(DurableDefectSummary),
})

/**
 * Authoritative persisted state and runtime metadata for one durable instance revision.
 *
 * @category models
 * @since 0.2.0
 */
export type Checkpoint = Schema.Schema.Type<typeof Checkpoint>

/**
 * Schema for messages consumed by the serialized machine mailbox.
 *
 * **Details**
 *
 * External events, timers, activity outcomes, and region completion notices share this envelope.
 * `availableAtEpochMillis` controls delayed visibility using the store's clock.
 *
 * @category schemas
 * @since 0.2.0
 */
export const MachineMessage = Schema.TaggedUnion({
  External: {
    messageId: Schema.String,
    instanceId: Schema.String,
    availableAtEpochMillis: Schema.Number,
    idempotencyKey: Schema.String,
    payloadFingerprint: Schema.String,
    event: Schema.Json,
  },
  Timer: {
    messageId: Schema.String,
    instanceId: Schema.String,
    availableAtEpochMillis: Schema.Number,
    entryId: Schema.String,
    ownerPath: Schema.String,
    timer: Schema.String,
  },
  ActivityOutcome: {
    messageId: Schema.String,
    instanceId: Schema.String,
    availableAtEpochMillis: Schema.Number,
    executionKey: Schema.String,
    entryId: Schema.String,
    ownerPath: Schema.String,
    invocation: Schema.String,
    lane: Schema.String,
    outcome: Schema.Json,
  },
  RegionsComplete: {
    messageId: Schema.String,
    instanceId: Schema.String,
    availableAtEpochMillis: Schema.Number,
    entryId: Schema.String,
    ownerPath: Schema.String,
  },
})

/**
 * External event, timer, activity outcome, or region completion delivery for a machine mailbox.
 *
 * @category models
 * @since 0.2.0
 */
export type MachineMessage = Schema.Schema.Type<typeof MachineMessage>

/**
 * Schema for one leased invocation or aggregate-lane activity command.
 *
 * @category schemas
 * @since 0.2.0
 */
export const ActivityCommand = Schema.Struct({
  deliveryId: Schema.String,
  instanceId: Schema.String,
  executionKey: Schema.String,
  entryId: Schema.String,
  ownerPath: Schema.String,
  invocation: Schema.String,
  lane: Schema.String,
  state: Schema.Json,
  parentState: Schema.NullOr(Schema.Json),
  concurrencyGroup: Schema.String,
  concurrencyLimit: Schema.Number,
})

/**
 * Persisted command for one invocation or named aggregate lane.
 *
 * @category models
 * @since 0.2.0
 */
export type ActivityCommand = Schema.Schema.Type<typeof ActivityCommand>

/**
 * Schema for an encoded terminal activity result.
 *
 * **Details**
 *
 * Success and allowed failure values are encoded with the invocation's declared Schemas. Defects
 * use a durable summary because they do not select the typed failure transition.
 *
 * @category schemas
 * @since 0.2.0
 */
export const ActivityOutcome = Schema.TaggedUnion({
  Success: { encodedValue: Schema.Json },
  Failure: { encodedError: Schema.Json },
  Defect: { defect: DurableDefectSummary },
})

/**
 * Encoded success, allowed failure, or defect produced by an activity worker.
 *
 * @category models
 * @since 0.2.0
 */
export type ActivityOutcome = Schema.Schema.Type<typeof ActivityOutcome>

/**
 * Schema for the durable status of a caller-keyed event dispatch.
 *
 * @category schemas
 * @since 0.2.0
 */
export const DispatchRecord = Schema.Struct({
  instanceId: Schema.String,
  idempotencyKey: Schema.String,
  payloadFingerprint: Schema.String,
  status: Schema.Literals(["pending", "committed", "rejected"]),
  revision: Schema.Number,
  reason: Schema.String,
})

/**
 * Durable status and resulting revision of one idempotent external event dispatch.
 *
 * @category models
 * @since 0.2.0
 */
export type DispatchRecord = Schema.Schema.Type<typeof DispatchRecord>

/**
 * Schema for a time-bounded, fenced delivery claim.
 *
 * @category schemas
 * @since 0.2.0
 */
export const Claim = Schema.Struct({
  deliveryId: Schema.String,
  workerId: Schema.String,
  fence: Schema.Number,
  attempt: Schema.Number,
  leaseExpiresAtEpochMillis: Schema.Number,
})

/**
 * Time-bounded ownership claim for one machine message or activity delivery.
 *
 * **Details**
 *
 * `fence` increases on redelivery and prevents a superseded worker from committing. `attempt`
 * identifies the at-least-once delivery attempt exposed to invoked work metadata.
 *
 * @category models
 * @since 0.2.0
 */
export type Claim = Schema.Schema.Type<typeof Claim>

/**
 * Failure to encode or decode a value crossing the durable persistence boundary.
 *
 * @category errors
 * @since 0.2.0
 */
export class DurableEncodingError extends Data.TaggedError("DurableEncodingError")<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Adapter-reported failure while reading or changing durable store state.
 *
 * @category errors
 * @since 0.2.0
 */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Machine-readable dimension that made a durable checkpoint incompatible.
 *
 * **Details**
 *
 * Switch on `_tag` to distinguish persisted format and definition mismatches from persistence
 * version or migration-path mismatches without parsing an error message.
 *
 * @category errors
 * @since 0.2.0
 */
export type CompatibilityReason =
  | Readonly<{
      _tag: "CheckpointFormatMismatch"
      expectedFormatVersion: number
      actualFormatVersion: number
    }>
  | Readonly<{
      _tag: "DefinitionMismatch"
      expectedDefinitionId: string
      actualDefinitionId: string
    }>
  | Readonly<{
      _tag: "PersistenceVersionMismatch"
      expected: PersistenceVersion
      actual: PersistenceVersion
    }>
  | Readonly<{
      _tag: "MissingMigration"
      from: PersistenceVersion
      target: PersistenceVersion
    }>

/**
 * Failure to resume a checkpoint that is incompatible with the requested durable run.
 *
 * **Gotchas**
 *
 * This pre-release API replaces the former top-level `expected` and `actual` fields. Branch on
 * `reason._tag`, then read the fields specific to that mismatch dimension.
 *
 * @category errors
 * @since 0.2.0
 */
export class CompatibilityError extends Data.TaggedError("CompatibilityError")<{
  readonly instanceId: InstanceId
  readonly reason: CompatibilityReason
}> {}

/**
 * Failure produced while selecting, running, validating, or committing a checkpoint migration.
 *
 * @category errors
 * @since 0.2.0
 */
export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly instanceId: InstanceId
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Rejection of a commit, renewal, or release made with an expired or superseded claim.
 *
 * @category errors
 * @since 0.2.0
 */
export class LeaseLost extends Data.TaggedError("LeaseLost")<{
  readonly deliveryId: DeliveryId
  readonly expectedFence: number
}> {}

/**
 * Rejection of an atomic update based on a stale checkpoint revision.
 *
 * @category errors
 * @since 0.2.0
 */
export class RevisionConflict extends Data.TaggedError("RevisionConflict")<{
  readonly instanceId: InstanceId
  readonly expected: Revision
  readonly actual: Revision
}> {}

/**
 * Reuse of a dispatch idempotency key with a different encoded event payload.
 *
 * @category errors
 * @since 0.2.0
 */
export class IdempotencyConflict extends Data.TaggedError("IdempotencyConflict")<{
  readonly instanceId: InstanceId
  readonly idempotencyKey: string
}> {}

/**
 * Rejection of an event offered after its durable instance has completed.
 *
 * @category errors
 * @since 0.2.0
 */
export class CompletedInstance extends Data.TaggedError("CompletedInstance")<{
  readonly instanceId: InstanceId
}> {}

/**
 * Durable-runner validation failure for a machine feature not yet supported by this interpreter.
 *
 * **Details**
 *
 * The initial durable runner rejects invoked child machines before it creates or claims any store
 * data. Ordinary `Machine.run` child behavior is unaffected.
 *
 * @category errors
 * @since 0.2.0
 */
export class UnsupportedDefinition extends Data.TaggedError("UnsupportedDefinition")<{
  readonly definitionId: string
  readonly stateTag: string
  readonly feature: "child"
}> {}

/**
 * Terminal defect persisted by a durable machine instance.
 *
 * **Details**
 *
 * The summary is restart-safe. `cause` is present only when the current process observed the live
 * Effect cause; it is not reconstructed from persistence.
 *
 * @category errors
 * @since 0.2.0
 */
export class DurableInstanceDefect extends Data.TaggedError("DurableInstanceDefect")<{
  readonly instanceId: InstanceId
  readonly defect: DurableDefectSummary
  readonly cause?: Cause.Cause<never>
}> {}

/**
 * Typed failure channel shared by durable runner handles and adapter conformance cases.
 *
 * @category errors
 * @since 0.2.0
 */
export type DurableError =
  | DurableEncodingError
  | StoreError
  | CompatibilityError
  | MigrationError
  | LeaseLost
  | RevisionConflict
  | IdempotencyConflict
  | CompletedInstance
  | UnsupportedDefinition
  | DurableInstanceDefect

/**
 * Claimed machine-mailbox message paired with its authoritative checkpoint and fence.
 *
 * @category models
 * @since 0.2.0
 */
export interface MachineDelivery {
  readonly checkpoint: Checkpoint
  readonly message: MachineMessage
  readonly claim: Claim
}

/**
 * Claimed activity command paired with its time-bounded fence.
 *
 * @category models
 * @since 0.2.0
 */
export interface ActivityDelivery {
  readonly command: ActivityCommand
  readonly claim: Claim
}

/**
 * Atomic initial checkpoint, mailbox, and activity publication for a new instance.
 *
 * @category models
 * @since 0.2.0
 */
export interface CreateRequest {
  readonly checkpoint: Checkpoint
  readonly messages: ReadonlyArray<MachineMessage>
  readonly activities: ReadonlyArray<ActivityCommand>
}

/**
 * Payload-sensitive, idempotent offer of an external event to one instance mailbox.
 *
 * @category models
 * @since 0.2.0
 */
export interface OfferRequest {
  readonly instanceId: InstanceId
  readonly idempotencyKey: string
  readonly payloadFingerprint: string
  readonly message: MachineMessage
}

/**
 * Atomic acknowledgement and state advance for one machine-message delivery.
 *
 * **Details**
 *
 * A store applies the checkpoint, derived publications, cancellations, and optional dispatch
 * result together, conditioned on both the delivery fence and expected checkpoint revision.
 *
 * @category models
 * @since 0.2.0
 */
export interface MachineCommit {
  readonly instanceId: InstanceId
  readonly deliveryId: DeliveryId
  readonly fence: number
  readonly expectedRevision: Revision
  readonly checkpoint: Checkpoint
  readonly publishMessages: ReadonlyArray<MachineMessage>
  readonly publishActivities: ReadonlyArray<ActivityCommand>
  readonly cancelMessageIds: ReadonlyArray<MessageId>
  readonly cancelExecutionKeys: ReadonlyArray<ExecutionKey>
  readonly dispatch: DispatchRecord | undefined
}

/**
 * Atomic checkpoint-and-queue protocol implemented by every durable store adapter.
 *
 * **When to use**
 *
 * Use to integrate a database, durable queue, or transactional-outbox design with
 * {@link run}. Application machine definitions remain independent of the adapter.
 *
 * **Details**
 *
 * The contract combines store-authoritative time, idempotent offers, delayed visibility,
 * time-bounded claims, fencing, optimistic checkpoint revisions, atomic derived publication, and
 * migration replacement. Advertised adapters should pass {@link storeConformance}.
 *
 * **Gotchas**
 *
 * Store-level atomicity is required even when persistence and queue infrastructure are separate.
 * Message, execution, and dispatch tombstones must remain effective for the lifetime of an
 * instance so redelivery cannot repeat an accepted state transition. Completed and defected
 * instances must not yield new machine or activity claims, including work claimed before the
 * terminal commit and presented afterward.
 *
 * @category services
 * @since 0.2.0
 */
export interface StoreService {
  /** Returns the adapter's authoritative Unix epoch time in milliseconds. */
  readonly now: Effect.Effect<number, StoreError>

  /** Loads the latest checkpoint, or `None` when the instance has not been created. */
  readonly load: (instanceId: InstanceId) => Effect.Effect<Option.Option<Checkpoint>, StoreError>

  /** Atomically creates an absent instance and returns `false` without replacing an existing one. */
  readonly create: (request: CreateRequest) => Effect.Effect<boolean, StoreError>

  /**
   * Offers an external event by caller key, returning its existing record on an identical retry.
   */
  readonly offer: (
    request: OfferRequest,
  ) => Effect.Effect<DispatchRecord, StoreError | IdempotencyConflict | CompletedInstance>

  /** Claims the earliest eligible message for a running instance, with one active machine claim. */
  readonly claimMachine: (
    instanceId: InstanceId,
    workerId: string,
    leaseMillis: number,
  ) => Effect.Effect<Option.Option<MachineDelivery>, StoreError>

  /** Extends a live machine-message claim without changing its fence. */
  readonly renewMachine: (
    deliveryId: DeliveryId,
    fence: number,
    leaseMillis: number,
  ) => Effect.Effect<Claim, StoreError | LeaseLost>

  /** Releases a live machine-message claim for redelivery. */
  readonly releaseMachine: (
    deliveryId: DeliveryId,
    fence: number,
  ) => Effect.Effect<void, StoreError | LeaseLost>

  /** Applies one fenced, revision-checked {@link MachineCommit} atomically. */
  readonly commitMachine: (
    commit: MachineCommit,
  ) => Effect.Effect<void, StoreError | LeaseLost | RevisionConflict>

  /** Claims an eligible activity for a running instance while honoring authored concurrency. */
  readonly claimActivity: (
    instanceId: InstanceId,
    workerId: string,
    leaseMillis: number,
  ) => Effect.Effect<Option.Option<ActivityDelivery>, StoreError>

  /** Extends a live activity claim without changing its fence. */
  readonly renewActivity: (
    deliveryId: DeliveryId,
    fence: number,
    leaseMillis: number,
  ) => Effect.Effect<Claim, StoreError | LeaseLost>

  /** Releases a live activity claim for at-least-once redelivery. */
  readonly releaseActivity: (
    deliveryId: DeliveryId,
    fence: number,
  ) => Effect.Effect<void, StoreError | LeaseLost>

  /** Atomically acknowledges an activity and publishes its uniquely keyed outcome message. */
  readonly completeActivity: (
    deliveryId: DeliveryId,
    fence: number,
    outcomeMessage: MachineMessage,
  ) => Effect.Effect<void, StoreError | LeaseLost>

  /** Waits for and returns the terminal record of a caller-keyed dispatch. */
  readonly observeDispatch: (
    instanceId: InstanceId,
    idempotencyKey: string,
  ) => Effect.Effect<DispatchRecord, StoreError>

  /** Loads the checkpoint and pending deliveries as one migration document. */
  readonly loadDocument: (
    instanceId: InstanceId,
  ) => Effect.Effect<Option.Option<MigrationDocument>, StoreError>

  /** Atomically replaces a migration document when its source revision is still current. */
  readonly commitMigration: (
    instanceId: InstanceId,
    expectedRevision: Revision,
    document: MigrationDocument,
  ) => Effect.Effect<void, StoreError | RevisionConflict>
}

/**
 * Context service through which {@link run} accesses atomic checkpoint and queue persistence.
 *
 * **When to use**
 *
 * Use as the service tag when providing a production adapter or the in-memory test implementation.
 *
 * @see {@link StoreService} for the adapter contract.
 * @category services
 * @since 0.2.0
 */
export class Store extends Context.Service<Store, StoreService>()(
  "effect-state-machine/Durable/Store",
) {}

/**
 * Schema for the complete checkpoint-and-delivery document passed through a migration.
 *
 * @category schemas
 * @since 0.2.0
 */
export const MigrationDocument = Schema.Struct({
  checkpoint: Checkpoint,
  messages: Schema.Array(MachineMessage),
  activities: Schema.Array(ActivityCommand),
})

/**
 * Checkpoint and unconsumed deliveries transformed together by a persistence migration.
 *
 * @category models
 * @since 0.2.0
 */
export type MigrationDocument = Schema.Schema.Type<typeof MigrationDocument>

/**
 * One directed persistence-version migration over an instance's complete durable document.
 *
 * **Details**
 *
 * The runner chains migrations by matching `from` to the current version, validates every returned
 * document, validates the final state against the current machine Schema, and commits the result
 * with an optimistic revision check.
 *
 * **Gotchas**
 *
 * A migration must preserve or deliberately rewrite pending messages, activities, entry identities,
 * and absolute timer deadlines. Returning only a new checkpoint discards work that was still
 * durable.
 *
 * @category models
 * @since 0.2.0
 */
export interface Migration {
  readonly from: PersistenceVersion
  readonly to: PersistenceVersion
  readonly migrate: (
    document: MigrationDocument,
  ) => Effect.Effect<MigrationDocument, MigrationError>
}

/**
 * Identity, compatibility, lease, polling, and worker configuration for {@link run}.
 *
 * @category configuration
 * @since 0.2.0
 */
export interface RunOptions {
  /** Stable application identity used to create or resume one durable instance. */
  readonly instanceId: InstanceId

  /** Current application-owned persistence version expected after any migrations. */
  readonly persistenceVersion: PersistenceVersion

  /** Directed migrations available to chain from a stored version to the current version. */
  readonly migrations?: ReadonlyArray<Migration>

  /**
   * Duration of each machine-message lease in milliseconds.
   *
   * @default 30000
   */
  readonly machineLeaseMillis?: number

  /**
   * Duration of each activity lease in milliseconds.
   *
   * @default 30000
   */
  readonly activityLeaseMillis?: number

  /**
   * Delay in milliseconds before an idle worker polls again.
   *
   * @default 25
   */
  readonly pollIntervalMillis?: number

  /**
   * Number of concurrent activity polling workers; values below one become one.
   *
   * @default 4
   */
  readonly activityWorkerCount?: number
}

/**
 * Caller-owned idempotency identity for one external event dispatch.
 *
 * @category configuration
 * @since 0.2.0
 */
export interface SendOptions {
  /** Key that may be safely retried only with the same Schema-encoded event payload. */
  readonly idempotencyKey: string
}

/**
 * Effect-native view and control surface for one scoped durable machine runner.
 *
 * **Details**
 *
 * Snapshot, capability, and status reads synchronize from the store before returning. `send` waits
 * for the caller-keyed dispatch to commit or reject. `completion` also resolves immediately when a
 * previously completed instance is resumed.
 *
 * **Gotchas**
 *
 * The runner's worker fibers live in the Scope that created this handle. Closing that Scope stops
 * local polling but leaves the checkpoint, deadlines, and uncommitted deliveries available to a
 * later runner.
 *
 * @category models
 * @since 0.2.0
 */
export interface Handle<State, Event, Completion> {
  /** Stable identity of the durable machine instance. */
  readonly instanceId: InstanceId

  /** Loads and decodes the latest committed state snapshot. */
  readonly snapshot: Effect.Effect<State, DurableError>

  /** Emits locally observed committed states until a final state is reached. */
  readonly changes: Stream.Stream<State, DurableError>

  /** Durably offers an event and waits for its keyed dispatch to commit or reject. */
  readonly send: (event: Event, options: SendOptions) => Effect.Effect<void, DurableError>

  /** Checks whether the latest committed state has a matching transition for an event. */
  readonly can: (event: Event) => Effect.Effect<boolean, DurableError>

  /** Awaits the final-state value, including a final value loaded during resume. */
  readonly completion: Effect.Effect<Completion, DurableError>

  /** Loads the latest durable lifecycle status. */
  readonly status: Effect.Effect<"running" | "completed" | "defected", DurableError>
}

/**
 * Checks whether a machine definition uses only nodes supported by durable execution.
 *
 * **Details**
 *
 * State, invocation, region, and final nodes are accepted. Invoked child-machine nodes fail with
 * {@link UnsupportedDefinition} before a runner writes or claims store data.
 *
 * @category guards
 * @since 0.2.0
 */
export const validateDefinition: (
  definition: Machine.DefinitionMetadata,
) => Effect.Effect<void, UnsupportedDefinition> = Effect.fnUntraced(function* (definition) {
  for (const node of Object.entries(definition.states)) {
    const value = node[1]
    if (
      typeof value === "object" &&
      value !== null &&
      "child" in value &&
      value.child !== undefined
    ) {
      return yield* Effect.fail(
        new UnsupportedDefinition({
          definitionId: definition.id,
          stateTag: node[0],
          feature: "child",
        }),
      )
    }
  }
})
