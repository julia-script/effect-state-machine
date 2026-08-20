import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import {
  type ActivityCommand,
  type ActivityDelivery,
  type Checkpoint,
  type Claim,
  CompletedInstance,
  type DeliveryId,
  type DispatchRecord,
  deliveryId,
  IdempotencyConflict,
  LeaseLost,
  type MachineDelivery,
  type MachineMessage,
  RevisionConflict,
  revision,
  Store,
  StoreError,
  type StoreService,
} from "./Durable.js"

interface StoredDelivery<Value> {
  readonly value: Value
  readonly sequence: number
  status: "pending" | "claimed" | "done" | "cancelled"
  claim: Claim | undefined
  attempt: number
  fence: number
}

interface StoredDispatch {
  record: DispatchRecord
  readonly completion: Deferred.Deferred<DispatchRecord>
}

interface InstanceState {
  checkpoint: Checkpoint
  readonly messages: Map<string, StoredDelivery<MachineMessage>>
  readonly activities: Map<string, StoredDelivery<ActivityCommand>>
  readonly dispatches: Map<string, StoredDispatch>
  readonly messageTombstones: Set<string>
  readonly executionTombstones: Set<string>
  nextSequence: number
}

interface MemoryState {
  readonly instances: Map<string, InstanceState>
}

type Result<Value, Error> =
  | Readonly<{ _tag: "Success"; value: Value }>
  | Readonly<{ _tag: "Failure"; error: Error }>

const success = <Value>(value: Value): Result<Value, never> => ({ _tag: "Success", value })
const failure = <Error>(error: Error): Result<never, Error> => ({ _tag: "Failure", error })

const fromResult = <Value, Error>(result: Result<Value, Error>): Effect.Effect<Value, Error> =>
  result._tag === "Success" ? Effect.succeed(result.value) : Effect.fail(result.error)

const modifyResult = <Value, Error>(
  state: Ref.Ref<MemoryState>,
  f: (memory: MemoryState) => readonly [Result<Value, Error>, MemoryState],
): Effect.Effect<Value, Error> => Ref.modify(state, f).pipe(Effect.flatMap(fromResult))

const messageKey = (message: MachineMessage): string => message.messageId

const putMessage = (instance: InstanceState, message: MachineMessage): void => {
  const key = messageKey(message)
  if (instance.messageTombstones.has(key) || instance.messages.has(key)) return
  instance.messages.set(key, {
    value: message,
    sequence: instance.nextSequence++,
    status: "pending",
    claim: undefined,
    attempt: 0,
    fence: 0,
  })
}

const putActivity = (instance: InstanceState, command: ActivityCommand): void => {
  const key = command.deliveryId
  if (instance.executionTombstones.has(command.executionKey) || instance.activities.has(key)) return
  instance.activities.set(key, {
    value: command,
    sequence: instance.nextSequence++,
    status: "pending",
    claim: undefined,
    attempt: 0,
    fence: 0,
  })
}

const makeClaim = (
  stored: StoredDelivery<unknown>,
  id: DeliveryId,
  workerId: string,
  now: number,
  leaseMillis: number,
): Claim => {
  stored.attempt += 1
  stored.fence += 1
  const claim: Claim = {
    deliveryId: id,
    workerId,
    fence: stored.fence,
    attempt: stored.attempt,
    leaseExpiresAtEpochMillis: now + leaseMillis,
  }
  stored.status = "claimed"
  stored.claim = claim
  return claim
}

const claimMatches = (stored: StoredDelivery<unknown>, fence: number, now: number): boolean =>
  stored.status === "claimed" &&
  stored.claim?.fence === fence &&
  stored.claim.leaseExpiresAtEpochMillis > now

const findMessage = (
  state: MemoryState,
  id: string,
): Readonly<{ instance: InstanceState; stored: StoredDelivery<MachineMessage> }> | undefined => {
  for (const instance of state.instances.values()) {
    const stored = instance.messages.get(id)
    if (stored !== undefined) return { instance, stored }
  }
  return undefined
}

const findActivity = (
  state: MemoryState,
  id: string,
): Readonly<{ instance: InstanceState; stored: StoredDelivery<ActivityCommand> }> | undefined => {
  for (const instance of state.instances.values()) {
    const stored = instance.activities.get(id)
    if (stored !== undefined) return { instance, stored }
  }
  return undefined
}

export const makeMemoryStore = (): Effect.Effect<StoreService> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<MemoryState>({ instances: new Map() })

    const service: StoreService = {
      now: Clock.currentTimeMillis,

      load: (id) =>
        Ref.get(state).pipe(
          Effect.map((memory) => Option.fromNullishOr(memory.instances.get(id)?.checkpoint)),
        ),

      create: (request) =>
        Ref.modify(state, (memory) => {
          const key = request.checkpoint.instanceId
          if (memory.instances.has(key)) return [false, memory]
          const stored: InstanceState = {
            checkpoint: request.checkpoint,
            messages: new Map(),
            activities: new Map(),
            dispatches: new Map(),
            messageTombstones: new Set(),
            executionTombstones: new Set(),
            nextSequence: request.checkpoint.nextSequence,
          }
          for (const message of request.messages) putMessage(stored, message)
          for (const activity of request.activities) putActivity(stored, activity)
          memory.instances.set(key, stored)
          return [true, memory]
        }),

      offer: (request) =>
        Effect.gen(function* () {
          const completion = yield* Deferred.make<DispatchRecord>()
          return yield* modifyResult<
            DispatchRecord,
            StoreError | CompletedInstance | IdempotencyConflict
          >(state, (memory) => {
            const stored = memory.instances.get(request.instanceId)
            if (stored === undefined) {
              return [
                failure(new StoreError({ operation: "offer", message: "instance does not exist" })),
                memory,
              ] as const
            }
            const existing = stored.dispatches.get(request.idempotencyKey)
            if (existing !== undefined) {
              return [
                existing.record.payloadFingerprint === request.payloadFingerprint
                  ? success(existing.record)
                  : failure(
                      new IdempotencyConflict({
                        instanceId: request.instanceId,
                        idempotencyKey: request.idempotencyKey,
                      }),
                    ),
                memory,
              ] as const
            }
            if (stored.checkpoint.status !== "running") {
              return [failure(new CompletedInstance({ instanceId: request.instanceId })), memory]
            }
            const record: DispatchRecord = {
              instanceId: request.instanceId,
              idempotencyKey: request.idempotencyKey,
              payloadFingerprint: request.payloadFingerprint,
              status: "pending",
              revision: stored.checkpoint.revision,
              reason: "",
            }
            stored.dispatches.set(request.idempotencyKey, { record, completion })
            putMessage(stored, request.message)
            return [success(record), memory] as const
          })
        }),

      claimMachine: (id, workerId, leaseMillis) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* Ref.modify(state, (memory) => {
            const instance = memory.instances.get(id)
            if (instance === undefined) return [Option.none<MachineDelivery>(), memory]
            const active = [...instance.messages.values()].some(
              (stored) =>
                stored.status === "claimed" && (stored.claim?.leaseExpiresAtEpochMillis ?? 0) > now,
            )
            if (active) return [Option.none<MachineDelivery>(), memory]
            const eligible = [...instance.messages.values()]
              .filter(
                (stored) =>
                  (stored.status === "pending" ||
                    (stored.status === "claimed" &&
                      (stored.claim?.leaseExpiresAtEpochMillis ?? 0) <= now)) &&
                  stored.value.availableAtEpochMillis <= now,
              )
              .sort(
                (left, right) =>
                  left.value.availableAtEpochMillis - right.value.availableAtEpochMillis ||
                  left.sequence - right.sequence,
              )[0]
            if (eligible === undefined) return [Option.none<MachineDelivery>(), memory]
            const claim = makeClaim(
              eligible,
              deliveryId(eligible.value.messageId),
              workerId,
              now,
              leaseMillis,
            )
            return [
              Option.some({ checkpoint: instance.checkpoint, message: eligible.value, claim }),
              memory,
            ]
          })
        }),

      renewMachine: (id, fence, leaseMillis) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* modifyResult<Claim, LeaseLost>(state, (memory) => {
            const found = findMessage(memory, id)
            if (found === undefined || !claimMatches(found.stored, fence, now)) {
              return [failure(new LeaseLost({ deliveryId: id, expectedFence: fence })), memory]
            }
            const claim = {
              ...found.stored.claim,
              leaseExpiresAtEpochMillis: now + leaseMillis,
            } as Claim
            found.stored.claim = claim
            return [success(claim), memory]
          })
        }),

      releaseMachine: (id, fence) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* modifyResult<void, LeaseLost>(state, (memory) => {
            const found = findMessage(memory, id)
            if (found === undefined || !claimMatches(found.stored, fence, now)) {
              return [failure(new LeaseLost({ deliveryId: id, expectedFence: fence })), memory]
            }
            found.stored.status = "pending"
            found.stored.claim = undefined
            return [success(undefined), memory]
          })
        }),

      commitMachine: (commit) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const notify = yield* modifyResult<
            StoredDispatch | undefined,
            LeaseLost | RevisionConflict
          >(state, (memory) => {
            const instance = memory.instances.get(commit.instanceId)
            const found = findMessage(memory, commit.deliveryId)
            if (
              instance === undefined ||
              found === undefined ||
              found.instance !== instance ||
              !claimMatches(found.stored, commit.fence, now)
            ) {
              return [
                failure(
                  new LeaseLost({
                    deliveryId: commit.deliveryId,
                    expectedFence: commit.fence,
                  }),
                ),
                memory,
              ] as const
            }
            if (instance.checkpoint.revision !== commit.expectedRevision) {
              return [
                failure(
                  new RevisionConflict({
                    instanceId: commit.instanceId,
                    expected: commit.expectedRevision,
                    actual: revision(instance.checkpoint.revision),
                  }),
                ),
                memory,
              ] as const
            }
            found.stored.status = "done"
            found.stored.claim = undefined
            instance.messageTombstones.add(found.stored.value.messageId)
            instance.checkpoint = commit.checkpoint
            for (const id of commit.cancelMessageIds) {
              const message = instance.messages.get(id)
              if (message !== undefined && message.status !== "done") message.status = "cancelled"
              instance.messageTombstones.add(id)
            }
            for (const key of commit.cancelExecutionKeys) {
              for (const activity of instance.activities.values()) {
                if (activity.value.executionKey === key && activity.status !== "done") {
                  activity.status = "cancelled"
                }
              }
              instance.executionTombstones.add(key)
            }
            for (const message of commit.publishMessages) putMessage(instance, message)
            for (const activity of commit.publishActivities) putActivity(instance, activity)
            let notify: StoredDispatch | undefined
            if (commit.dispatch !== undefined) {
              notify = instance.dispatches.get(commit.dispatch.idempotencyKey)
              if (notify !== undefined) notify.record = commit.dispatch
            }
            return [success(notify), memory] as const
          })
          if (notify !== undefined) yield* Deferred.succeed(notify.completion, notify.record)
        }).pipe(Effect.uninterruptible),

      claimActivity: (id, workerId, leaseMillis) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* Ref.modify(state, (memory) => {
            const eligible: Array<
              Readonly<{
                instance: InstanceState
                stored: StoredDelivery<ActivityCommand>
              }>
            > = []
            const target = memory.instances.get(id)
            for (const instance of target === undefined ? [] : [target]) {
              for (const stored of instance.activities.values()) {
                if (
                  stored.status !== "pending" &&
                  !(
                    stored.status === "claimed" &&
                    (stored.claim?.leaseExpiresAtEpochMillis ?? 0) <= now
                  )
                ) {
                  continue
                }
                const activeInGroup = [...instance.activities.values()].filter(
                  (other) =>
                    other.status === "claimed" &&
                    (other.claim?.leaseExpiresAtEpochMillis ?? 0) > now &&
                    other.value.concurrencyGroup === stored.value.concurrencyGroup,
                ).length
                if (activeInGroup < stored.value.concurrencyLimit) {
                  eligible.push({ instance, stored })
                }
              }
            }
            eligible.sort((left, right) => left.stored.sequence - right.stored.sequence)
            const selected = eligible[0]
            if (selected === undefined) return [Option.none<ActivityDelivery>(), memory]
            const claim = makeClaim(
              selected.stored,
              deliveryId(selected.stored.value.deliveryId),
              workerId,
              now,
              leaseMillis,
            )
            return [Option.some({ command: selected.stored.value, claim }), memory]
          })
        }),

      renewActivity: (id, fence, leaseMillis) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* modifyResult<Claim, LeaseLost>(state, (memory) => {
            const found = findActivity(memory, id)
            if (found === undefined || !claimMatches(found.stored, fence, now)) {
              return [failure(new LeaseLost({ deliveryId: id, expectedFence: fence })), memory]
            }
            const claim = {
              ...found.stored.claim,
              leaseExpiresAtEpochMillis: now + leaseMillis,
            } as Claim
            found.stored.claim = claim
            return [success(claim), memory]
          })
        }),

      releaseActivity: (id, fence) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* modifyResult<void, LeaseLost>(state, (memory) => {
            const found = findActivity(memory, id)
            if (found === undefined || !claimMatches(found.stored, fence, now)) {
              return [failure(new LeaseLost({ deliveryId: id, expectedFence: fence })), memory]
            }
            found.stored.status = "pending"
            found.stored.claim = undefined
            return [success(undefined), memory]
          })
        }),

      completeActivity: (id, fence, outcomeMessage) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return yield* modifyResult<void, LeaseLost>(state, (memory) => {
            const found = findActivity(memory, id)
            if (found === undefined || !claimMatches(found.stored, fence, now)) {
              return [failure(new LeaseLost({ deliveryId: id, expectedFence: fence })), memory]
            }
            found.stored.status = "done"
            found.stored.claim = undefined
            found.instance.executionTombstones.add(found.stored.value.executionKey)
            putMessage(found.instance, outcomeMessage)
            return [success(undefined), memory]
          })
        }),

      observeDispatch: (id, key) =>
        Effect.gen(function* () {
          const stored = yield* Ref.get(state).pipe(
            Effect.map((memory) => memory.instances.get(id)?.dispatches.get(key)),
          )
          if (stored === undefined) {
            return yield* new StoreError({
              operation: "observeDispatch",
              message: "dispatch does not exist",
            })
          }
          return stored.record.status === "pending"
            ? yield* Deferred.await(stored.completion)
            : stored.record
        }),

      loadDocument: (id) =>
        Ref.get(state).pipe(
          Effect.map((memory) => {
            const stored = memory.instances.get(id)
            if (stored === undefined) return Option.none()
            return Option.some({
              checkpoint: stored.checkpoint,
              messages: [...stored.messages.values()]
                .filter(
                  (delivery) => delivery.status === "pending" || delivery.status === "claimed",
                )
                .sort((left, right) => left.sequence - right.sequence)
                .map((delivery) => delivery.value),
              activities: [...stored.activities.values()]
                .filter(
                  (delivery) => delivery.status === "pending" || delivery.status === "claimed",
                )
                .sort((left, right) => left.sequence - right.sequence)
                .map((delivery) => delivery.value),
            })
          }),
        ),

      commitMigration: (id, expectedRevision, document) =>
        modifyResult<void, StoreError | RevisionConflict>(state, (memory) => {
          const stored = memory.instances.get(id)
          if (stored === undefined) {
            return [
              failure(
                new StoreError({
                  operation: "commitMigration",
                  message: "instance does not exist",
                }),
              ),
              memory,
            ]
          }
          if (stored.checkpoint.revision !== expectedRevision) {
            return [
              failure(
                new RevisionConflict({
                  instanceId: id,
                  expected: expectedRevision,
                  actual: revision(stored.checkpoint.revision),
                }),
              ),
              memory,
            ]
          }
          const migrationFence = Math.max(
            0,
            ...[...stored.messages.values(), ...stored.activities.values()].map(
              (delivery) => delivery.fence,
            ),
          )
          stored.checkpoint = document.checkpoint
          stored.messages.clear()
          stored.activities.clear()
          for (const message of document.messages) putMessage(stored, message)
          for (const activity of document.activities) putActivity(stored, activity)
          for (const delivery of [...stored.messages.values(), ...stored.activities.values()]) {
            delivery.fence = migrationFence
          }
          return [success(undefined), memory]
        }).pipe(Effect.uninterruptible),
    }

    return service
  })

export const layerMemory: Layer.Layer<Store> = Layer.effect(Store, makeMemoryStore())
