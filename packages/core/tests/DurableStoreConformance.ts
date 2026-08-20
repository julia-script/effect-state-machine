import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { TestClock } from "effect/testing"
import * as Durable from "../src/Durable.js"

const id = Durable.instanceId("order-1")
type ExternalMessage = Extract<Durable.MachineMessage, { readonly _tag: "External" }>

const checkpoint = (
  currentRevision = 0,
  status: Durable.Checkpoint["status"] = "running",
): Durable.Checkpoint => ({
  formatVersion: 1,
  definitionId: "orders",
  persistenceVersion: "1",
  instanceId: id,
  revision: currentRevision,
  status,
  state: { _tag: "Waiting" },
  rootEntryId: `entry-${currentRevision}`,
  regionEntryIds: {},
  timers: [],
  aggregates: [],
  nextSequence: 0,
  defect: null,
})

const external = (name: string, availableAtEpochMillis = 0, key = name): ExternalMessage => ({
  _tag: "External",
  messageId: name,
  instanceId: id,
  availableAtEpochMillis,
  idempotencyKey: key,
  payloadFingerprint: `fingerprint:${name}`,
  event: { _tag: "Continue", name },
})

const activity = (
  name: string,
  concurrencyGroup = "default",
  concurrencyLimit = 1,
): Durable.ActivityCommand => ({
  deliveryId: `activity:${name}`,
  instanceId: id,
  executionKey: `execution:${name}`,
  entryId: "entry-0",
  ownerPath: "root",
  invocation: "perform",
  lane: name,
  state: { _tag: "Waiting" },
  parentState: null,
  concurrencyGroup,
  concurrencyLimit,
})

const outcome = (command: Durable.ActivityCommand): Durable.MachineMessage => ({
  _tag: "ActivityOutcome",
  messageId: `outcome:${command.executionKey}`,
  instanceId: id,
  availableAtEpochMillis: 0,
  executionKey: command.executionKey,
  entryId: command.entryId,
  ownerPath: command.ownerPath,
  invocation: command.invocation,
  lane: command.lane,
  outcome: { _tag: "Success", encodedValue: "done" },
})

const expectFailureTag = <A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E>,
  tag: E["_tag"],
): Effect.Effect<void, never> =>
  Effect.matchEffect(effect, {
    onFailure: (error) =>
      Effect.sync(() => {
        assert.strictEqual(error._tag, tag)
      }),
    onSuccess: () => Effect.die(new Error(`expected ${tag}`)),
  })

/** Reusable behavioral contract for every Durable.Store adapter. */
export const storeConformance = (
  name: string,
  makeStore: () => Effect.Effect<Durable.StoreService>,
): void => {
  describe(`${name} Durable.Store conformance`, () => {
    it.effect("creates an absent instance and its owned work atomically", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        const timer = external("timer", 1_000)
        const command = activity("one")

        assert.strictEqual(
          yield* store.create({
            checkpoint: checkpoint(),
            messages: [timer],
            activities: [command],
          }),
          true,
        )
        assert.strictEqual(
          yield* store.create({ checkpoint: checkpoint(), messages: [], activities: [] }),
          false,
        )
        assert.deepStrictEqual(Option.getOrThrow(yield* store.load(id)), checkpoint())
        assert.strictEqual(Option.isNone(yield* store.claimMachine(id, "machine", 100)), true)
        assert.strictEqual(Option.isSome(yield* store.claimActivity(id, "activity", 100)), true)
      }),
    )

    it.effect("offers one payload per key and reattaches duplicate callers", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({ checkpoint: checkpoint(), messages: [], activities: [] })
        const message = external("event-1", 0, "request-1")
        const request: Durable.OfferRequest = {
          instanceId: id,
          idempotencyKey: "request-1",
          payloadFingerprint: message.payloadFingerprint,
          message,
        }

        assert.strictEqual((yield* store.offer(request)).status, "pending")
        assert.strictEqual((yield* store.offer(request)).status, "pending")
        yield* expectFailureTag(
          store.offer({ ...request, payloadFingerprint: "different" }),
          "IdempotencyConflict",
        )

        const observed = yield* Effect.forkChild(store.observeDispatch(id, "request-1"))
        const delivery = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        const committed: Durable.DispatchRecord = {
          ...request,
          status: "committed",
          revision: 1,
          reason: "",
        }
        yield* store.commitMachine({
          instanceId: id,
          deliveryId: Durable.deliveryId(delivery.message.messageId),
          fence: delivery.claim.fence,
          expectedRevision: Durable.revision(0),
          checkpoint: checkpoint(1),
          publishMessages: [],
          publishActivities: [],
          cancelMessageIds: [],
          cancelExecutionKeys: [],
          dispatch: committed,
        })

        assert.deepStrictEqual(yield* Fiber.join(observed), committed)
        assert.deepStrictEqual(yield* store.offer(request), committed)
      }),
    )

    it.effect("rejects offers after completion", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(1, "completed"),
          messages: [],
          activities: [],
        })
        const message = external("late")
        yield* expectFailureTag(
          store.offer({
            instanceId: id,
            idempotencyKey: "late",
            payloadFingerprint: message.payloadFingerprint,
            message,
          }),
          "CompletedInstance",
        )
      }),
    )

    it.effect("orders due machine messages by store time then insertion sequence", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        const late = external("late", 1_000)
        const first = external("first", 500)
        const second = external("second", 500)
        yield* store.create({
          checkpoint: checkpoint(),
          messages: [late, first, second],
          activities: [],
        })

        assert.strictEqual(Option.isNone(yield* store.claimMachine(id, "machine", 100)), true)
        yield* TestClock.adjust("500 millis")
        const claimed = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        assert.strictEqual(claimed.message.messageId, "first")
        assert.strictEqual(Option.isNone(yield* store.claimMachine(id, "other", 100)), true)
        yield* store.releaseMachine(
          Durable.deliveryId(claimed.message.messageId),
          claimed.claim.fence,
        )
      }),
    )

    it.effect("expires claims, increments attempts and fences stale machine workers", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(),
          messages: [external("event")],
          activities: [],
        })
        const first = Option.getOrThrow(yield* store.claimMachine(id, "first", 100))
        yield* TestClock.adjust("101 millis")
        const second = Option.getOrThrow(yield* store.claimMachine(id, "second", 100))

        assert.strictEqual(second.claim.attempt, 2)
        assert.strictEqual(second.claim.fence, first.claim.fence + 1)
        yield* expectFailureTag(
          store.commitMachine({
            instanceId: id,
            deliveryId: Durable.deliveryId(first.message.messageId),
            fence: first.claim.fence,
            expectedRevision: Durable.revision(0),
            checkpoint: checkpoint(1),
            publishMessages: [],
            publishActivities: [],
            cancelMessageIds: [],
            cancelExecutionKeys: [],
            dispatch: undefined,
          }),
          "LeaseLost",
        )
        yield* store.renewMachine(
          Durable.deliveryId(second.message.messageId),
          second.claim.fence,
          100,
        )
      }),
    )

    it.effect("rejects stale revisions without consuming the live claim", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(2),
          messages: [external("event")],
          activities: [],
        })
        const delivery = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        yield* expectFailureTag(
          store.commitMachine({
            instanceId: id,
            deliveryId: Durable.deliveryId(delivery.message.messageId),
            fence: delivery.claim.fence,
            expectedRevision: Durable.revision(1),
            checkpoint: checkpoint(3),
            publishMessages: [],
            publishActivities: [],
            cancelMessageIds: [],
            cancelExecutionKeys: [],
            dispatch: undefined,
          }),
          "RevisionConflict",
        )
        yield* store.releaseMachine(
          Durable.deliveryId(delivery.message.messageId),
          delivery.claim.fence,
        )
      }),
    )

    it.effect("claims activities concurrently while honoring authored group limits", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(),
          messages: [],
          activities: [
            activity("a", "serial", 1),
            activity("b", "serial", 1),
            activity("c", "other", 1),
          ],
        })

        const first = Option.getOrThrow(yield* store.claimActivity(id, "one", 100))
        const second = Option.getOrThrow(yield* store.claimActivity(id, "two", 100))
        assert.strictEqual(first.command.lane, "a")
        assert.strictEqual(second.command.lane, "c")
        assert.strictEqual(Option.isNone(yield* store.claimActivity(id, "three", 100)), true)
      }),
    )

    it.effect("completes activities once and retains execution tombstones", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        const command = activity("a")
        yield* store.create({ checkpoint: checkpoint(), messages: [], activities: [command] })
        const claimed = Option.getOrThrow(yield* store.claimActivity(id, "worker", 100))
        yield* store.completeActivity(
          Durable.deliveryId(claimed.command.deliveryId),
          claimed.claim.fence,
          outcome(command),
        )
        yield* expectFailureTag(
          store.completeActivity(
            Durable.deliveryId(claimed.command.deliveryId),
            claimed.claim.fence,
            outcome(command),
          ),
          "LeaseLost",
        )

        const machine = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        assert.strictEqual(machine.message.messageId, `outcome:${command.executionKey}`)
        yield* store.commitMachine({
          instanceId: id,
          deliveryId: Durable.deliveryId(machine.message.messageId),
          fence: machine.claim.fence,
          expectedRevision: Durable.revision(0),
          checkpoint: checkpoint(1),
          publishMessages: [],
          publishActivities: [{ ...command, deliveryId: "activity:duplicate" }],
          cancelMessageIds: [],
          cancelExecutionKeys: [],
          dispatch: undefined,
        })
        assert.strictEqual(Option.isNone(yield* store.claimActivity(id, "worker", 100)), true)
      }),
    )

    it.effect("replaces a migration document only at the expected revision", () =>
      Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(2),
          messages: [external("pending")],
          activities: [activity("pending")],
        })
        const document = Option.getOrThrow(yield* store.loadDocument(id))
        const migrated: Durable.MigrationDocument = {
          ...document,
          checkpoint: {
            ...document.checkpoint,
            persistenceVersion: "2",
            revision: 3,
          },
        }
        yield* expectFailureTag(
          store.commitMigration(id, Durable.revision(1), migrated),
          "RevisionConflict",
        )
        yield* store.commitMigration(id, Durable.revision(2), migrated)
        assert.strictEqual(Option.getOrThrow(yield* store.load(id)).persistenceVersion, "2")
        const reloaded = Option.getOrThrow(yield* store.loadDocument(id))
        assert.strictEqual(reloaded.messages.length, 1)
        assert.strictEqual(reloaded.activities.length, 1)
      }),
    )
  })
}
