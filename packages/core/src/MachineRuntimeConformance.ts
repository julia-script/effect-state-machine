import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import {
  type ActivityCommand,
  type Checkpoint,
  type DispatchRecord,
  deliveryId,
  type InstanceId,
  instanceId,
  type MachineError,
  type MachineMessage,
  type MessageId,
  type OfferRequest,
  type RuntimeExecutionId,
  revision,
  type StoreService,
} from "./MachineRuntimeProtocol.js"

/** Behavioral topics that every advertised durable Store adapter must satisfy. */
export const storeConformanceTopics = [
  "authoritative-time",
  "atomic-create-and-load",
  "payload-idempotency",
  "duplicate-observation",
  "terminal-offer-rejection",
  "delayed-ordering",
  "machine-serialization",
  "machine-renew-release-expiry-fencing",
  "revision-cas",
  "atomic-machine-commit",
  "activity-concurrency",
  "activity-renew-release-expiry-fencing",
  "atomic-activity-completion",
  "execution-tombstones",
  "terminal-claim-ineligibility",
  "migration-replacement",
] as const

/** One named behavior in {@link storeConformanceTopics}. */
export type StoreConformanceTopic = (typeof storeConformanceTopics)[number]

/**
 * Named executable assertion in the behavioral contract for durable store adapters.
 *
 * @category testing
 * @since 0.2.0
 */
export interface StoreConformanceCase {
  readonly name: string
  readonly covers: ReadonlyArray<StoreConformanceTopic>
  readonly run: Effect.Effect<void, MachineError>
}

const ensure = (condition: boolean, message: string): Effect.Effect<void> =>
  condition ? Effect.void : Effect.die(new Error(`Machine runtime store conformance: ${message}`))

const checkpoint = (
  id: InstanceId,
  currentRevision = 0,
  status: Checkpoint["status"] = "running",
): Checkpoint => ({
  formatVersion: 1,
  definitionId: "conformance",
  persistenceVersion: "1",
  instanceId: id,
  revision: currentRevision,
  status,
  state: { _tag: "Active" },
  rootEntryId: `entry-${currentRevision}`,
  regionEntryIds: {},
  timers: [],
  aggregates: [],
  nextSequence: 0,
  defect: null,
})

type ExternalMessage = Extract<MachineMessage, { readonly _tag: "External" }>

const message = (
  id: InstanceId,
  name: string,
  availableAtEpochMillis = 0,
  key = name,
): ExternalMessage => ({
  _tag: "External",
  messageId: name,
  instanceId: id,
  availableAtEpochMillis,
  idempotencyKey: key,
  payloadFingerprint: `payload:${name}`,
  event: { _tag: "Event", name },
})

const activity = (id: InstanceId, name: string, group = "default", limit = 1): ActivityCommand => ({
  deliveryId: `activity:${name}`,
  instanceId: id,
  executionId: `execution:${name}`,
  entryId: "entry-0",
  generation: 0,
  ownerPath: "Active",
  invocation: "work",
  lane: name,
  state: { _tag: "Active" },
  parentState: null,
  concurrencyGroup: group,
  concurrencyLimit: limit,
})

const outcome = (id: InstanceId, command: ActivityCommand): MachineMessage => ({
  _tag: "ActivityOutcome",
  messageId: `outcome:${command.executionId}`,
  instanceId: id,
  availableAtEpochMillis: 0,
  executionId: command.executionId,
  entryId: command.entryId,
  ownerPath: command.ownerPath,
  invocation: command.invocation,
  lane: command.lane,
  outcome: { _tag: "Success", encodedValue: true },
})

const expectFailureTag = <A, E extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E>,
  tag: E["_tag"],
): Effect.Effect<void> =>
  Effect.matchEffect(effect, {
    onFailure: (error) => ensure(error._tag === tag, `expected ${tag}, received ${error._tag}`),
    onSuccess: () => Effect.die(new Error(`Machine runtime store conformance: expected ${tag}`)),
  })

/**
 * Returns the complete framework-neutral executable contract for a durable Store adapter.
 *
 * **When to use**
 *
 * Register every returned `run` Effect with `@effect/vitest` or another Effect-aware test runner.
 * The factory must construct an isolated empty Store for each case.
 *
 * **Details**
 *
 * The bundled in-memory adapter is certified with this same corpus. Case coverage is declared with
 * {@link StoreConformanceCase.covers} and must collectively include every
 * {@link storeConformanceTopics} entry.
 *
 * **Gotchas**
 *
 * `advance` must move the same clock observed by the adapter. Supply a virtual-clock operation such
 * as `TestClock.adjust` for deterministic tests.
 *
 * @see {@link StoreService} for the complete adapter protocol.
 * @category testing
 * @since 0.2.0
 */
export const storeConformance = (
  makeStore: () => Effect.Effect<StoreService>,
  advance: (millis: number) => Effect.Effect<void> = Effect.sleep,
): ReadonlyArray<StoreConformanceCase> => {
  const id = instanceId("durable-store-conformance")
  return [
    {
      name: "creates and loads one instance with owned work atomically",
      covers: ["authoritative-time", "atomic-create-and-load"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const now = yield* store.now
        yield* ensure(Number.isFinite(now), "store time must be a finite epoch value")
        const timer = message(id, "timer", now + 100)
        const command = activity(id, "one")
        yield* ensure(
          yield* store.create({
            checkpoint: checkpoint(id),
            messages: [timer],
            activities: [command],
          }),
          "first create must win",
        )
        yield* ensure(
          !(yield* store.create({ checkpoint: checkpoint(id, 9), messages: [], activities: [] })),
          "duplicate create must not replace the instance",
        )
        const loaded = Option.getOrThrow(yield* store.load(id))
        yield* ensure(loaded.revision === 0, "load must return the first checkpoint")
        yield* ensure(
          Option.isSome(yield* store.claimActivity(id, "activity", 100)),
          "initial activities must be published atomically",
        )
      }),
    },
    {
      name: "deduplicates offers and reattaches duplicate observers",
      covers: ["payload-idempotency", "duplicate-observation"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({ checkpoint: checkpoint(id), messages: [], activities: [] })
        const offered = message(id, "event", 0, "request")
        const request: OfferRequest = {
          instanceId: id,
          idempotencyKey: "request",
          payloadFingerprint: offered.payloadFingerprint,
          message: offered,
        }
        yield* ensure((yield* store.offer(request)).status === "pending", "first offer must pend")
        yield* ensure((yield* store.offer(request)).status === "pending", "retry must reattach")
        yield* expectFailureTag(
          store.offer({ ...request, payloadFingerprint: "different" }),
          "IdempotencyConflict",
        )
        const firstObserver = yield* Effect.forkChild(store.observeDispatch(id, "request"))
        const secondObserver = yield* Effect.forkChild(store.observeDispatch(id, "request"))
        const delivery = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        const dispatch: DispatchRecord = {
          instanceId: id,
          idempotencyKey: "request",
          payloadFingerprint: offered.payloadFingerprint,
          status: "committed",
          revision: 1,
          reason: "",
        }
        yield* store.commitMachine({
          instanceId: id,
          deliveryId: deliveryId(delivery.message.messageId),
          fence: delivery.claim.fence,
          expectedRevision: revision(0),
          checkpoint: checkpoint(id, 1),
          publishMessages: [],
          publishActivities: [],
          cancelMessageIds: [],
          cancelExecutionIds: [],
          dispatch,
        })
        yield* ensure(
          (yield* Fiber.join(firstObserver)).status === "committed",
          "observer must finish",
        )
        yield* ensure((yield* Fiber.join(secondObserver)).revision === 1, "duplicates share result")
        yield* ensure((yield* store.offer(request)).status === "committed", "retry returns result")
      }),
    },
    {
      name: "rejects offers to terminal instances",
      covers: ["terminal-offer-rejection"],
      run: Effect.gen(function* () {
        for (const status of ["completed", "defected"] as const) {
          const store = yield* makeStore()
          yield* store.create({
            checkpoint: checkpoint(id, 1, status),
            messages: [],
            activities: [],
          })
          const late = message(id, `late-${status}`)
          yield* expectFailureTag(
            store.offer({
              instanceId: id,
              idempotencyKey: `late-${status}`,
              payloadFingerprint: late.payloadFingerprint,
              message: late,
            }),
            "CompletedInstance",
          )
        }
      }),
    },
    {
      name: "orders delayed messages and serializes machine claims",
      covers: ["delayed-ordering", "machine-serialization"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const now = yield* store.now
        yield* store.create({
          checkpoint: checkpoint(id),
          messages: [
            message(id, "late", now + 20),
            message(id, "first", now + 10),
            message(id, "second", now + 10),
          ],
          activities: [],
        })
        yield* ensure(
          Option.isNone(yield* store.claimMachine(id, "early", 5)),
          "future work hidden",
        )
        yield* advance(10)
        const first = Option.getOrThrow(yield* store.claimMachine(id, "one", 100))
        yield* ensure(first.message.messageId === "first", "deadline and insertion order must win")
        yield* ensure(Option.isNone(yield* store.claimMachine(id, "two", 100)), "claims serialize")
        yield* store.releaseMachine(deliveryId(first.message.messageId), first.claim.fence)
        const reclaimed = Option.getOrThrow(yield* store.claimMachine(id, "two", 100))
        yield* ensure(reclaimed.message.messageId === "first", "released work must redeliver")
      }),
    },
    {
      name: "renews machine claims and fences expired owners",
      covers: ["machine-renew-release-expiry-fencing"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(id),
          messages: [message(id, "event")],
          activities: [],
        })
        const first = Option.getOrThrow(yield* store.claimMachine(id, "first", 10))
        const renewed = yield* store.renewMachine(
          deliveryId(first.message.messageId),
          first.claim.fence,
          20,
        )
        yield* ensure(renewed.fence === first.claim.fence, "renewal must retain fence")
        yield* advance(21)
        const second = Option.getOrThrow(yield* store.claimMachine(id, "second", 10))
        yield* ensure(second.claim.attempt === 2, "redelivery must increment attempt")
        yield* ensure(second.claim.fence > first.claim.fence, "redelivery must advance fence")
        yield* expectFailureTag(
          store.releaseMachine(deliveryId(first.message.messageId), first.claim.fence),
          "LeaseLost",
        )
      }),
    },
    {
      name: "rejects stale revisions without consuming the live claim",
      covers: ["revision-cas"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.create({
          checkpoint: checkpoint(id, 2),
          messages: [message(id, "event")],
          activities: [],
        })
        const claimed = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        yield* expectFailureTag(
          store.commitMachine({
            instanceId: id,
            deliveryId: deliveryId(claimed.message.messageId),
            fence: claimed.claim.fence,
            expectedRevision: revision(1),
            checkpoint: checkpoint(id, 3),
            publishMessages: [],
            publishActivities: [],
            cancelMessageIds: [],
            cancelExecutionIds: [],
            dispatch: undefined,
          }),
          "RevisionConflict",
        )
        yield* store.releaseMachine(deliveryId(claimed.message.messageId), claimed.claim.fence)
      }),
    },
    {
      name: "commits checkpoints publications and cancellations atomically",
      covers: ["atomic-machine-commit"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const causal = message(id, "causal")
        const cancelled = message(id, "cancelled", 1_000)
        const oldActivity = activity(id, "old")
        yield* store.create({
          checkpoint: checkpoint(id),
          messages: [causal, cancelled],
          activities: [oldActivity],
        })
        const claimed = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        const published = message(id, "published")
        const newActivity = activity(id, "new")
        yield* store.commitMachine({
          instanceId: id,
          deliveryId: deliveryId(claimed.message.messageId),
          fence: claimed.claim.fence,
          expectedRevision: revision(0),
          checkpoint: checkpoint(id, 1),
          publishMessages: [published],
          publishActivities: [newActivity],
          cancelMessageIds: [cancelled.messageId as MessageId],
          cancelExecutionIds: [oldActivity.executionId as RuntimeExecutionId],
          dispatch: undefined,
        })
        const nextMessage = Option.getOrThrow(yield* store.claimMachine(id, "next", 100))
        yield* ensure(
          nextMessage.message.messageId === "published",
          "published message must be visible",
        )
        const nextActivity = Option.getOrThrow(yield* store.claimActivity(id, "activity", 100))
        yield* ensure(nextActivity.command.lane === "new", "cancelled activity must not be claimed")
      }),
    },
    {
      name: "honors activity concurrency renewal and release",
      covers: ["activity-concurrency", "activity-renew-release-expiry-fencing"],
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
        const first = Option.getOrThrow(yield* store.claimActivity(id, "one", 10))
        const second = Option.getOrThrow(yield* store.claimActivity(id, "two", 10))
        yield* ensure(
          first.command.lane === "a" && second.command.lane === "c",
          "group limits apply",
        )
        const renewed = yield* store.renewActivity(
          deliveryId(first.command.deliveryId),
          first.claim.fence,
          20,
        )
        yield* ensure(renewed.fence === first.claim.fence, "activity renewal retains fence")
        yield* store.releaseActivity(deliveryId(first.command.deliveryId), first.claim.fence)
        const released = Option.getOrThrow(yield* store.claimActivity(id, "three", 10))
        yield* ensure(released.command.lane === "a", "released activity must redeliver")
      }),
    },
    {
      name: "records retry facts distinctly across activity redelivery",
      covers: ["activity-renew-release-expiry-fencing"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const command = { ...activity(id, "retry"), generation: 7 }
        yield* store.create({ checkpoint: checkpoint(id), messages: [], activities: [command] })
        const first = Option.getOrThrow(yield* store.claimActivity(id, "one", 100))
        const retryDraft = (attempt: number, fence: number) => ({
          key: `${command.executionId}:retry:${attempt}:${fence}:1`,
          actorId: `actor:${id}`,
          definitionPath: "root",
          body: {
            _tag: "Inspection" as const,
            metadata: {
              _tag: "InvocationRetryScheduled" as const,
              machineId: "conformance",
              stateTag: "Active",
              invocation: command.invocation,
              generation: command.generation,
              policy: "once",
              attempt: 1,
              delayMillis: 10,
              ownerPath: command.ownerPath,
              workKind: "effect" as const,
            },
          },
        })
        yield* store.appendActivityTree(deliveryId(command.deliveryId), first.claim.fence, [
          retryDraft(first.claim.attempt, first.claim.fence),
        ])
        yield* store.releaseActivity(deliveryId(command.deliveryId), first.claim.fence)
        const second = Option.getOrThrow(yield* store.claimActivity(id, "two", 100))
        yield* store.appendActivityTree(deliveryId(command.deliveryId), second.claim.fence, [
          retryDraft(second.claim.attempt, second.claim.fence),
        ])

        const retries = (yield* store.loadTree(id)).filter(
          (record) =>
            record.body._tag === "Inspection" &&
            record.body.metadata._tag === "InvocationRetryScheduled",
        )
        yield* ensure(retries.length === 2, "each claim must retain its retry fact")
        yield* ensure(
          retries[0]?.key !== retries[1]?.key,
          "retry record keys must include the fence",
        )
        yield* ensure(
          retries.every(
            (record) =>
              record.body._tag === "Inspection" &&
              record.body.metadata._tag === "InvocationRetryScheduled" &&
              record.body.metadata.generation === 7,
          ),
          "redelivery must retain the owning entry generation",
        )
      }),
    },
    {
      name: "fences expired activity completion",
      covers: ["activity-renew-release-expiry-fencing"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const command = activity(id, "expiring")
        yield* store.create({ checkpoint: checkpoint(id), messages: [], activities: [command] })
        const first = Option.getOrThrow(yield* store.claimActivity(id, "one", 10))
        yield* advance(11)
        const second = Option.getOrThrow(yield* store.claimActivity(id, "two", 10))
        yield* expectFailureTag(
          store.completeActivity(
            deliveryId(first.command.deliveryId),
            first.claim.fence,
            outcome(id, command),
          ),
          "LeaseLost",
        )
        yield* store.completeActivity(
          deliveryId(second.command.deliveryId),
          second.claim.fence,
          outcome(id, command),
        )
      }),
    },
    {
      name: "completes activities once and retains execution tombstones",
      covers: ["atomic-activity-completion", "execution-tombstones"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const command = activity(id, "done")
        yield* store.create({ checkpoint: checkpoint(id), messages: [], activities: [command] })
        const claimed = Option.getOrThrow(yield* store.claimActivity(id, "worker", 100))
        yield* store.completeActivity(
          deliveryId(command.deliveryId),
          claimed.claim.fence,
          outcome(id, command),
        )
        yield* expectFailureTag(
          store.completeActivity(
            deliveryId(command.deliveryId),
            claimed.claim.fence,
            outcome(id, command),
          ),
          "LeaseLost",
        )
        const machine = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        yield* store.commitMachine({
          instanceId: id,
          deliveryId: deliveryId(machine.message.messageId),
          fence: machine.claim.fence,
          expectedRevision: revision(0),
          checkpoint: checkpoint(id, 1),
          publishMessages: [],
          publishActivities: [{ ...command, deliveryId: "activity:duplicate" }],
          cancelMessageIds: [],
          cancelExecutionIds: [],
          dispatch: undefined,
        })
        yield* ensure(
          Option.isNone(yield* store.claimActivity(id, "again", 100)),
          "tombstone suppresses rerun",
        )
      }),
    },
    {
      name: "does not claim work from terminal instances",
      covers: ["terminal-claim-ineligibility"],
      run: Effect.gen(function* () {
        for (const status of ["completed", "defected"] as const) {
          const store = yield* makeStore()
          yield* store.create({
            checkpoint: checkpoint(id, 1, status),
            messages: [message(id, `message-${status}`)],
            activities: [activity(id, `activity-${status}`)],
          })
          yield* ensure(
            Option.isNone(yield* store.claimMachine(id, "machine", 100)),
            `${status} machine claim`,
          )
          yield* ensure(
            Option.isNone(yield* store.claimActivity(id, "activity", 100)),
            `${status} activity claim`,
          )
        }
        const store = yield* makeStore()
        const causal = message(id, "terminal-causal")
        const running = activity(id, "terminal-running")
        yield* store.create({
          checkpoint: checkpoint(id),
          messages: [causal],
          activities: [running],
        })
        const machine = Option.getOrThrow(yield* store.claimMachine(id, "machine", 100))
        const claimedActivity = Option.getOrThrow(yield* store.claimActivity(id, "activity", 100))
        yield* store.commitMachine({
          instanceId: id,
          deliveryId: deliveryId(machine.message.messageId),
          fence: machine.claim.fence,
          expectedRevision: revision(0),
          checkpoint: checkpoint(id, 1, "defected"),
          publishMessages: [],
          publishActivities: [],
          cancelMessageIds: [],
          cancelExecutionIds: [running.executionId as RuntimeExecutionId],
          dispatch: undefined,
        })
        yield* expectFailureTag(
          store.completeActivity(
            deliveryId(claimedActivity.command.deliveryId),
            claimedActivity.claim.fence,
            outcome(id, running),
          ),
          "LeaseLost",
        )
      }),
    },
    {
      name: "replaces migration documents only at the expected revision",
      covers: ["migration-replacement"],
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
        yield* expectFailureTag(
          store.commitMigration(id, revision(1), migrated),
          "RevisionConflict",
        )
        yield* store.commitMigration(id, revision(2), migrated)
        const loaded = Option.getOrThrow(yield* store.loadDocument(id))
        yield* ensure(loaded.checkpoint.persistenceVersion === "2", "migration replaces checkpoint")
        yield* ensure(
          loaded.messages.length === 1 && loaded.activities.length === 1,
          "migration retains work",
        )
      }),
    },
  ]
}
