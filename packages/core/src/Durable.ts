import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import type * as Machine from "./Machine.js"

declare const InstanceIdTypeId: unique symbol
declare const EntryIdTypeId: unique symbol
declare const MessageIdTypeId: unique symbol
declare const ExecutionKeyTypeId: unique symbol
declare const DeliveryIdTypeId: unique symbol
declare const RevisionTypeId: unique symbol
declare const PersistenceVersionTypeId: unique symbol

export type InstanceId = string & { readonly [InstanceIdTypeId]: typeof InstanceIdTypeId }
export type EntryId = string & { readonly [EntryIdTypeId]: typeof EntryIdTypeId }
export type MessageId = string & { readonly [MessageIdTypeId]: typeof MessageIdTypeId }
export type ExecutionKey = string & {
  readonly [ExecutionKeyTypeId]: typeof ExecutionKeyTypeId
}
export type DeliveryId = string & { readonly [DeliveryIdTypeId]: typeof DeliveryIdTypeId }
export type Revision = number & { readonly [RevisionTypeId]: typeof RevisionTypeId }
export type PersistenceVersion = string & {
  readonly [PersistenceVersionTypeId]: typeof PersistenceVersionTypeId
}

export const instanceId = (value: string): InstanceId => value as InstanceId
export const entryId = (value: string): EntryId => value as EntryId
export const messageId = (value: string): MessageId => value as MessageId
export const executionKey = (value: string): ExecutionKey => value as ExecutionKey
export const deliveryId = (value: string): DeliveryId => value as DeliveryId
export const revision = (value: number): Revision => value as Revision
export const persistenceVersion = (value: string): PersistenceVersion => value as PersistenceVersion

const component = (value: string): string => encodeURIComponent(value)

export const deriveEntryId = (
  instance: InstanceId,
  targetRevision: Revision,
  ownerPath: string,
): EntryId => entryId(`${component(instance)}:${targetRevision}:${component(ownerPath)}`)

export const deriveMessageId = (
  instance: InstanceId,
  targetRevision: Revision,
  ownerPath: string,
  name: string,
): MessageId =>
  messageId(`${component(instance)}:${targetRevision}:${component(ownerPath)}:${component(name)}`)

export const deriveExecutionKey = (
  instance: InstanceId,
  entry: EntryId,
  ownerPath: string,
  invocation: string,
  lane = "",
): ExecutionKey =>
  executionKey(
    `${component(instance)}:${component(entry)}:${component(ownerPath)}:${component(invocation)}:${component(lane)}`,
  )

export type Json = Schema.Schema.Type<typeof Schema.Json>

export const DurableDefectSummary = Schema.Struct({
  category: Schema.Literals(["protocol", "definition", "encoding", "activity", "store", "unknown"]),
  name: Schema.String,
  message: Schema.String,
})
export type DurableDefectSummary = Schema.Schema.Type<typeof DurableDefectSummary>

export const PersistedTimer = Schema.Struct({
  entryId: Schema.String,
  ownerPath: Schema.String,
  name: Schema.String,
  durationMillis: Schema.Number,
  dueAtEpochMillis: Schema.Number,
  messageId: Schema.String,
})
export type PersistedTimer = Schema.Schema.Type<typeof PersistedTimer>

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
export type AggregateProgress = Schema.Schema.Type<typeof AggregateProgress>

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
export type Checkpoint = Schema.Schema.Type<typeof Checkpoint>

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
export type MachineMessage = Schema.Schema.Type<typeof MachineMessage>

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
export type ActivityCommand = Schema.Schema.Type<typeof ActivityCommand>

export const ActivityOutcome = Schema.TaggedUnion({
  Success: { encodedValue: Schema.Json },
  Failure: { encodedError: Schema.Json },
  Defect: { defect: DurableDefectSummary },
})
export type ActivityOutcome = Schema.Schema.Type<typeof ActivityOutcome>

export const DispatchRecord = Schema.Struct({
  instanceId: Schema.String,
  idempotencyKey: Schema.String,
  payloadFingerprint: Schema.String,
  status: Schema.Literals(["pending", "committed", "rejected"]),
  revision: Schema.Number,
  reason: Schema.String,
})
export type DispatchRecord = Schema.Schema.Type<typeof DispatchRecord>

export const Claim = Schema.Struct({
  deliveryId: Schema.String,
  workerId: Schema.String,
  fence: Schema.Number,
  attempt: Schema.Number,
  leaseExpiresAtEpochMillis: Schema.Number,
})
export type Claim = Schema.Schema.Type<typeof Claim>

export class DurableEncodingError extends Data.TaggedError("DurableEncodingError")<{
  readonly operation: string
  readonly message: string
}> {}

export class StoreError extends Data.TaggedError("StoreError")<{
  readonly operation: string
  readonly message: string
}> {}

export class CompatibilityError extends Data.TaggedError("CompatibilityError")<{
  readonly instanceId: InstanceId
  readonly expected: PersistenceVersion
  readonly actual: PersistenceVersion
}> {}

export class MigrationError extends Data.TaggedError("MigrationError")<{
  readonly instanceId: InstanceId
  readonly message: string
}> {}

export class LeaseLost extends Data.TaggedError("LeaseLost")<{
  readonly deliveryId: DeliveryId
  readonly expectedFence: number
}> {}

export class RevisionConflict extends Data.TaggedError("RevisionConflict")<{
  readonly instanceId: InstanceId
  readonly expected: Revision
  readonly actual: Revision
}> {}

export class IdempotencyConflict extends Data.TaggedError("IdempotencyConflict")<{
  readonly instanceId: InstanceId
  readonly idempotencyKey: string
}> {}

export class CompletedInstance extends Data.TaggedError("CompletedInstance")<{
  readonly instanceId: InstanceId
}> {}

export class UnsupportedDefinition extends Data.TaggedError("UnsupportedDefinition")<{
  readonly definitionId: string
  readonly stateTag: string
  readonly feature: "child"
}> {}

export class DurableInstanceDefect extends Data.TaggedError("DurableInstanceDefect")<{
  readonly instanceId: InstanceId
  readonly defect: DurableDefectSummary
  readonly cause?: Cause.Cause<never>
}> {}

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

export interface MachineDelivery {
  readonly checkpoint: Checkpoint
  readonly message: MachineMessage
  readonly claim: Claim
}

export interface ActivityDelivery {
  readonly command: ActivityCommand
  readonly claim: Claim
}

export interface CreateRequest {
  readonly checkpoint: Checkpoint
  readonly messages: ReadonlyArray<MachineMessage>
  readonly activities: ReadonlyArray<ActivityCommand>
}

export interface OfferRequest {
  readonly instanceId: InstanceId
  readonly idempotencyKey: string
  readonly payloadFingerprint: string
  readonly message: MachineMessage
}

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

export interface StoreService {
  readonly now: Effect.Effect<number, StoreError>
  readonly load: (instanceId: InstanceId) => Effect.Effect<Option.Option<Checkpoint>, StoreError>
  readonly create: (request: CreateRequest) => Effect.Effect<boolean, StoreError>
  readonly offer: (
    request: OfferRequest,
  ) => Effect.Effect<DispatchRecord, StoreError | IdempotencyConflict | CompletedInstance>
  readonly claimMachine: (
    instanceId: InstanceId,
    workerId: string,
    leaseMillis: number,
  ) => Effect.Effect<Option.Option<MachineDelivery>, StoreError>
  readonly renewMachine: (
    deliveryId: DeliveryId,
    fence: number,
    leaseMillis: number,
  ) => Effect.Effect<Claim, StoreError | LeaseLost>
  readonly releaseMachine: (
    deliveryId: DeliveryId,
    fence: number,
  ) => Effect.Effect<void, StoreError | LeaseLost>
  readonly commitMachine: (
    commit: MachineCommit,
  ) => Effect.Effect<void, StoreError | LeaseLost | RevisionConflict>
  readonly claimActivity: (
    instanceId: InstanceId,
    workerId: string,
    leaseMillis: number,
  ) => Effect.Effect<Option.Option<ActivityDelivery>, StoreError>
  readonly renewActivity: (
    deliveryId: DeliveryId,
    fence: number,
    leaseMillis: number,
  ) => Effect.Effect<Claim, StoreError | LeaseLost>
  readonly releaseActivity: (
    deliveryId: DeliveryId,
    fence: number,
  ) => Effect.Effect<void, StoreError | LeaseLost>
  readonly completeActivity: (
    deliveryId: DeliveryId,
    fence: number,
    outcomeMessage: MachineMessage,
  ) => Effect.Effect<void, StoreError | LeaseLost>
  readonly observeDispatch: (
    instanceId: InstanceId,
    idempotencyKey: string,
  ) => Effect.Effect<DispatchRecord, StoreError>
  readonly loadDocument: (
    instanceId: InstanceId,
  ) => Effect.Effect<Option.Option<MigrationDocument>, StoreError>
  readonly commitMigration: (
    instanceId: InstanceId,
    expectedRevision: Revision,
    document: MigrationDocument,
  ) => Effect.Effect<void, StoreError | RevisionConflict>
}

export class Store extends Context.Service<Store, StoreService>()(
  "effect-state-machine/Durable/Store",
) {}

export const MigrationDocument = Schema.Struct({
  checkpoint: Checkpoint,
  messages: Schema.Array(MachineMessage),
  activities: Schema.Array(ActivityCommand),
})
export type MigrationDocument = Schema.Schema.Type<typeof MigrationDocument>

export interface Migration {
  readonly from: PersistenceVersion
  readonly to: PersistenceVersion
  readonly migrate: (
    document: MigrationDocument,
  ) => Effect.Effect<MigrationDocument, MigrationError>
}

export interface RunOptions {
  readonly instanceId: InstanceId
  readonly persistenceVersion: PersistenceVersion
  readonly migrations?: ReadonlyArray<Migration>
  readonly machineLeaseMillis?: number
  readonly activityLeaseMillis?: number
  readonly pollIntervalMillis?: number
  readonly activityWorkerCount?: number
}

export interface SendOptions {
  readonly idempotencyKey: string
}

export interface Handle<State, Event, Completion> {
  readonly instanceId: InstanceId
  readonly snapshot: Effect.Effect<State, DurableError>
  readonly changes: Stream.Stream<State, DurableError>
  readonly send: (event: Event, options: SendOptions) => Effect.Effect<void, DurableError>
  readonly can: (event: Event) => Effect.Effect<boolean, DurableError>
  readonly completion: Effect.Effect<Completion, DurableError>
  readonly status: Effect.Effect<"running" | "completed" | "defected", DurableError>
}

export const validateDefinition = (
  definition: Machine.DefinitionMetadata,
): Effect.Effect<void, UnsupportedDefinition> => {
  for (const node of Object.entries(definition.states)) {
    const value = node[1] as Readonly<Record<string, unknown>>
    if (value.child !== undefined) {
      return Effect.fail(
        new UnsupportedDefinition({
          definitionId: definition.id,
          stateTag: node[0],
          feature: "child",
        }),
      )
    }
  }
  return Effect.void
}

export { type StoreConformanceCase, storeConformance } from "./DurableConformance.js"
export { layerMemory, makeMemoryStore } from "./DurableMemory.js"
export { run } from "./DurableRunner.js"
