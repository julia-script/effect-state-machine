import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  type ActivityCommand,
  type Checkpoint,
  type DurableError,
  deliveryId,
  type InstanceId,
  instanceId,
  type MachineMessage,
  revision,
  type StoreService,
} from "./Durable.js"

export interface StoreConformanceCase {
  readonly name: string
  readonly run: Effect.Effect<void, DurableError>
}

const ensure = (condition: boolean, message: string): Effect.Effect<void> =>
  condition ? Effect.void : Effect.die(new Error(`Durable.Store conformance: ${message}`))

const checkpoint = (id: InstanceId, currentRevision = 0): Checkpoint => ({
  formatVersion: 1,
  definitionId: "conformance",
  persistenceVersion: "1",
  instanceId: id,
  revision: currentRevision,
  status: "running",
  state: { _tag: "Active" },
  rootEntryId: `entry-${currentRevision}`,
  regionEntryIds: {},
  timers: [],
  aggregates: [],
  nextSequence: 0,
  defect: null,
})

const message = (id: InstanceId, name: string, availableAtEpochMillis = 0): MachineMessage => ({
  _tag: "External",
  messageId: name,
  instanceId: id,
  availableAtEpochMillis,
  idempotencyKey: name,
  payloadFingerprint: `payload:${name}`,
  event: { _tag: "Event", name },
})

const activity = (id: InstanceId, name: string, group = "default"): ActivityCommand => ({
  deliveryId: `activity:${name}`,
  instanceId: id,
  executionKey: `execution:${name}`,
  entryId: "entry-0",
  ownerPath: "Active",
  invocation: "work",
  lane: name,
  state: { _tag: "Active" },
  parentState: null,
  concurrencyGroup: group,
  concurrencyLimit: 1,
})

/**
 * Returns framework-neutral executable cases for validating a Durable.Store adapter.
 * Adapter packages can register each `run` Effect with `@effect/vitest` or another Effect runner.
 */
export const storeConformance = (
  makeStore: () => Effect.Effect<StoreService>,
  advance: (millis: number) => Effect.Effect<void> = Effect.sleep,
): ReadonlyArray<StoreConformanceCase> => {
  const id = instanceId("durable-store-conformance")
  return [
    {
      name: "atomic creation and payload-sensitive keyed offers",
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* ensure(
          yield* store.create({
            checkpoint: checkpoint(id),
            messages: [],
            activities: [],
          }),
          "first create must win",
        )
        yield* ensure(
          !(yield* store.create({
            checkpoint: checkpoint(id),
            messages: [],
            activities: [],
          })),
          "duplicate create must not replace the instance",
        )
        const event = message(id, "request")
        const request = {
          instanceId: id,
          idempotencyKey: "request",
          payloadFingerprint: "payload:request",
          message: event,
        }
        yield* store.offer(request)
        yield* store.offer(request)
        const conflict = yield* Effect.exit(
          store.offer({ ...request, payloadFingerprint: "different" }),
        )
        yield* ensure(conflict._tag === "Failure", "conflicting payload must fail")
      }),
    },
    {
      name: "delayed ordering, machine serialization, expiry, fencing, and revision CAS",
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const now = yield* store.now
        yield* store.create({
          checkpoint: checkpoint(id),
          messages: [message(id, "later", now + 20), message(id, "first", now + 10)],
          activities: [],
        })
        yield* ensure(
          Option.isNone(yield* store.claimMachine(id, "early", 5)),
          "future messages must remain unavailable",
        )
        yield* advance(10)
        const claimed = Option.getOrThrow(yield* store.claimMachine(id, "one", 5))
        yield* ensure(claimed.message.messageId === "first", "earliest deadline must win")
        yield* ensure(
          Option.isNone(yield* store.claimMachine(id, "two", 5)),
          "one instance cannot have two active machine claims",
        )
        yield* advance(5)
        const redelivered = Option.getOrThrow(yield* store.claimMachine(id, "two", 5))
        yield* ensure(
          redelivered.claim.fence > claimed.claim.fence,
          "redelivery must advance fence",
        )
        const stale = yield* Effect.exit(
          store.commitMachine({
            instanceId: id,
            deliveryId: deliveryId(claimed.claim.deliveryId),
            fence: claimed.claim.fence,
            expectedRevision: revision(0),
            checkpoint: checkpoint(id, 1),
            publishMessages: [],
            publishActivities: [],
            cancelMessageIds: [],
            cancelExecutionKeys: [],
            dispatch: undefined,
          }),
        )
        yield* ensure(stale._tag === "Failure", "superseded claim must be fenced")
        const wrongRevision = yield* Effect.exit(
          store.commitMachine({
            instanceId: id,
            deliveryId: deliveryId(redelivered.claim.deliveryId),
            fence: redelivered.claim.fence,
            expectedRevision: revision(9),
            checkpoint: checkpoint(id, 1),
            publishMessages: [],
            publishActivities: [],
            cancelMessageIds: [],
            cancelExecutionKeys: [],
            dispatch: undefined,
          }),
        )
        yield* ensure(wrongRevision._tag === "Failure", "stale revision must fail atomically")
      }),
    },
    {
      name: "activity concurrency, completion publication, and execution tombstones",
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(id),
          messages: [],
          activities: [
            activity(id, "a", "serial"),
            activity(id, "b", "serial"),
            activity(id, "c", "other"),
          ],
        })
        const first = Option.getOrThrow(yield* store.claimActivity(id, "one", 100))
        const second = Option.getOrThrow(yield* store.claimActivity(id, "two", 100))
        yield* ensure(first.command.lane === "a", "first activity must preserve insertion order")
        yield* ensure(second.command.lane === "c", "independent group must remain claimable")
        const outcome: MachineMessage = {
          _tag: "ActivityOutcome",
          messageId: "outcome:a",
          instanceId: id,
          availableAtEpochMillis: yield* store.now,
          executionKey: first.command.executionKey,
          entryId: first.command.entryId,
          ownerPath: first.command.ownerPath,
          invocation: first.command.invocation,
          lane: first.command.lane,
          outcome: { _tag: "Success", encodedValue: true },
        }
        yield* store.completeActivity(
          deliveryId(first.claim.deliveryId),
          first.claim.fence,
          outcome,
        )
        const machine = yield* store.claimMachine(id, "machine", 100)
        yield* ensure(Option.isSome(machine), "activity completion must publish its outcome")
      }),
    },
    {
      name: "migration documents use optimistic revision replacement",
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(id, 2),
          messages: [message(id, "pending")],
          activities: [activity(id, "pending")],
        })
        const document = Option.getOrThrow(yield* store.loadDocument(id))
        const migrated = {
          ...document,
          checkpoint: { ...document.checkpoint, revision: 3, persistenceVersion: "2" },
        }
        const stale = yield* Effect.exit(store.commitMigration(id, revision(1), migrated))
        yield* ensure(stale._tag === "Failure", "stale migration revision must fail")
        yield* store.commitMigration(id, revision(2), migrated)
        const loaded = Option.getOrThrow(yield* store.loadDocument(id))
        yield* ensure(loaded.messages.length === 1, "migration must retain supplied messages")
        yield* ensure(loaded.activities.length === 1, "migration must retain supplied activities")
      }),
    },
  ]
}
