import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type {
  ActivityCommand,
  ActivityDelivery,
  Claim,
  DispatchRecord,
  MachineDelivery,
  MachineMessage,
  MigrationDocument,
  StoreService,
} from "./MachineRuntimeProtocol.js"
import {
  CompletedInstance,
  revision as durableRevision,
  IdempotencyConflict,
  LeaseLost,
  RevisionConflict,
  Store,
  StoreError,
} from "./MachineRuntimeProtocol.js"
import {
  type CompareAndSetResult,
  documentMetadata,
  type MachineDocument,
  type MachineInstanceId,
  type MachineStoreError,
  type Service as MachineStoreService,
  machineInstanceId,
  revision,
} from "./MachineStore.js"
import { planMachineCommit } from "./MachineStoreDocument.js"
import * as MachineStoreNested from "./MachineStoreNested.js"

interface MutableDelivery<Value> {
  readonly value: Value
  readonly sequence: number
  status: "pending" | "claimed" | "done" | "cancelled"
  claim: Claim | null
  attempt: number
  fence: number
}

interface MutableDocument {
  formatVersion: 2
  revision: number
  instanceId: string
  checkpoint: MachineDocument["checkpoint"]
  input: MachineDocument["input"]
  readonly children: ReadonlyArray<MachineDocument["runtime"]["nodes"][number]>
  readonly messages: Map<string, MutableDelivery<MachineMessage>>
  readonly activities: Map<string, MutableDelivery<ActivityCommand>>
  readonly dispatches: Map<string, DispatchRecord>
  readonly messageTombstones: Set<string>
  readonly executionTombstones: Set<string>
  readonly nestedDocuments: ReadonlyArray<MachineDocument["nestedDocuments"][number]>
  nextSequence: number
  readonly tree: MachineDocument["tree"]
}

type Result<Value, Error> =
  | Readonly<{ _tag: "Success"; value: Value }>
  | Readonly<{ _tag: "Failure"; error: Error }>

interface Mutation<Value, Error> {
  readonly result: Result<Value, Error>
  readonly write: boolean
  readonly notAfter?: number
  readonly replacement?: MutableDocument
}

const success = <Value>(value: Value): Result<Value, never> => ({ _tag: "Success", value })
const failure = <Error>(error: Error): Result<never, Error> => ({ _tag: "Failure", error })

const storeFailure = (operation: string, error: MachineStoreError): StoreError =>
  new StoreError({
    operation,
    message: error.message,
    cause: error.cause ?? error,
  })

const mutableDocument = (document: MachineDocument): MutableDocument => ({
  formatVersion: document.formatVersion,
  revision: document.revision,
  instanceId: document.instanceId,
  checkpoint: document.checkpoint,
  input: document.input,
  children: document.runtime.nodes.filter((node) => node.key !== "root"),
  messages: new Map(
    document.messages.map((delivery) => [
      delivery.value.messageId,
      { ...delivery, claim: delivery.claim },
    ]),
  ),
  activities: new Map(
    document.activities.map((delivery) => [
      delivery.value.deliveryId,
      { ...delivery, claim: delivery.claim },
    ]),
  ),
  dispatches: new Map(
    document.dispatches.map((dispatch) => [dispatch.idempotencyKey, dispatch.record]),
  ),
  messageTombstones: new Set(document.messageTombstones),
  executionTombstones: new Set(document.executionTombstones),
  nestedDocuments: document.nestedDocuments,
  nextSequence: document.nextSequence,
  tree: document.tree,
})

const persistedDocument = (document: MutableDocument): MachineDocument => ({
  formatVersion: document.formatVersion,
  revision: document.revision + 1,
  instanceId: document.instanceId,
  ...documentMetadata(document.checkpoint, document.input, document.children),
  checkpoint: document.checkpoint,
  messages: [...document.messages.values()].sort((left, right) => left.sequence - right.sequence),
  activities: [...document.activities.values()].sort(
    (left, right) => left.sequence - right.sequence,
  ),
  timers: document.checkpoint.timers,
  dispatches: [...document.dispatches.entries()].map(([idempotencyKey, record]) => ({
    idempotencyKey,
    record,
  })),
  executions: [...document.activities.values()].map((activity) => ({
    id: activity.value.executionId,
    entryId: activity.value.entryId,
    ownerPath: activity.value.ownerPath,
    invocation: activity.value.invocation,
    lane: activity.value.lane,
    status: activity.status,
    attempt: activity.attempt,
    fence: activity.fence,
  })),
  messageTombstones: [...document.messageTombstones],
  executionTombstones: [...document.executionTombstones],
  nestedDocuments: document.nestedDocuments,
  nextSequence: document.nextSequence,
  tree: document.tree,
})

const putMessage = (document: MutableDocument, message: MachineMessage): void => {
  if (
    document.messageTombstones.has(message.messageId) ||
    document.messages.has(message.messageId)
  ) {
    return
  }
  document.messages.set(message.messageId, {
    value: message,
    sequence: document.nextSequence++,
    status: "pending",
    claim: null,
    attempt: 0,
    fence: 0,
  })
}

const putActivity = (document: MutableDocument, command: ActivityCommand): void => {
  if (
    document.executionTombstones.has(command.executionId) ||
    document.activities.has(command.deliveryId)
  ) {
    return
  }
  document.activities.set(command.deliveryId, {
    value: command,
    sequence: document.nextSequence++,
    status: "pending",
    claim: null,
    attempt: 0,
    fence: 0,
  })
}

const claimMatches = (
  stored: MutableDelivery<unknown>,
  expectedFence: number,
  now: number,
): boolean =>
  stored.status === "claimed" &&
  stored.claim?.fence === expectedFence &&
  stored.claim.leaseExpiresAtEpochMillis > now

const makeClaim = (
  stored: MutableDelivery<unknown>,
  id: string,
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

const modify = <Value, Error>(
  store: MachineStoreService,
  instanceId: string,
  operation: string,
  transform: (document: MutableDocument, now: number) => Mutation<Value, Error>,
  onExpired?: () => Error,
): Effect.Effect<Value, Error | StoreError> =>
  Effect.gen(function* () {
    while (true) {
      const loaded = yield* store
        .load(machineInstanceId(instanceId))
        .pipe(Effect.mapError((error) => storeFailure(operation, error)))
      if (Option.isNone(loaded)) {
        return yield* new StoreError({ operation, message: "instance does not exist" })
      }
      const current = mutableDocument(loaded.value)
      const now = yield* store.now.pipe(Effect.mapError((error) => storeFailure(operation, error)))
      const mutation = transform(current, now)
      if (mutation.result._tag === "Failure") return yield* Effect.fail(mutation.result.error)
      if (!mutation.write) return mutation.result.value
      const replaced = yield* store
        .compareAndSet({
          instanceId: machineInstanceId(instanceId),
          expectedRevision: revision(loaded.value.revision),
          document: persistedDocument(mutation.replacement ?? current),
          ...(mutation.notAfter === undefined ? {} : { notAfter: mutation.notAfter }),
        })
        .pipe(Effect.mapError((error) => storeFailure(operation, error)))
      if (replaced._tag === "Committed") return mutation.result.value
      if (replaced._tag === "Expired") {
        return onExpired === undefined
          ? yield* new StoreError({ operation, message: "store-time precondition expired" })
          : yield* Effect.fail(onExpired())
      }
    }
    // The loop returns on commit, a no-write result, or a typed failure.
    return yield* new StoreError({ operation, message: "unreachable compare-and-set loop" })
  })

const activeDocument = (document: MutableDocument): boolean =>
  document.checkpoint.status === "running"

/** Builds the package-private queue, lease, and fencing protocol over the aggregate store. */
export const makeMachineRuntimeStore = (
  baseStore: MachineStoreService,
  rootInstanceId?: MachineInstanceId,
): Effect.Effect<StoreService> =>
  Effect.gen(function* () {
    const nestedStore =
      rootInstanceId === undefined ? undefined : MachineStoreNested.make(baseStore, rootInstanceId)
    const target = (instanceId: MachineInstanceId): MachineStoreService =>
      rootInstanceId === undefined || instanceId === rootInstanceId || nestedStore === undefined
        ? baseStore
        : nestedStore
    const store: MachineStoreService = {
      now: baseStore.now,
      load: (instanceId) => target(instanceId).load(instanceId),
      compareAndSet: (request) => target(request.instanceId).compareAndSet(request),
    }
    const deliveryOwners = new Map<string, string>()

    return Store.of({
      now: store.now.pipe(Effect.mapError((error) => storeFailure("now", error))),

      load: Effect.fnUntraced(function* (id) {
        const loaded = yield* store
          .load(machineInstanceId(id))
          .pipe(Effect.mapError((error) => storeFailure("load", error)))
        return Option.map(loaded, (document) => document.checkpoint)
      }),

      loadTree: Effect.fnUntraced(function* (id) {
        const owner = rootInstanceId ?? machineInstanceId(id)
        const loaded = yield* baseStore
          .load(owner)
          .pipe(Effect.mapError((error) => storeFailure("loadTree", error)))
        return Option.isSome(loaded) ? loaded.value.tree.records : []
      }),

      create: Effect.fnUntraced(function* (request) {
        const document: MachineDocument = {
          formatVersion: 2,
          revision: 0,
          instanceId: request.checkpoint.instanceId,
          ...documentMetadata(request.checkpoint),
          checkpoint: request.checkpoint,
          messages: [],
          activities: [],
          timers: request.checkpoint.timers,
          dispatches: [],
          executions: [],
          messageTombstones: [],
          executionTombstones: [],
          nestedDocuments: [],
          nextSequence: request.checkpoint.nextSequence,
          tree: {
            rootActorId: `actor:${request.checkpoint.instanceId}`,
            nextSequence: request.treeRecords?.length ?? 0,
            records: (request.treeRecords ?? []).map((record, sequence) => ({
              ...record,
              sequence,
            })),
          },
        }
        const mutable = mutableDocument(document)
        for (const message of request.messages) putMessage(mutable, message)
        for (const activity of request.activities) putActivity(mutable, activity)
        const result = yield* store
          .compareAndSet({
            instanceId: machineInstanceId(request.checkpoint.instanceId),
            expectedRevision: undefined,
            document: persistedDocument(mutable),
          })
          .pipe(Effect.mapError((error) => storeFailure("create", error)))
        return result._tag === "Committed"
      }),

      offer: (request) =>
        modify<DispatchRecord, IdempotencyConflict | CompletedInstance>(
          store,
          request.instanceId,
          "offer",
          (document) => {
            const existing = document.dispatches.get(request.idempotencyKey)
            if (existing !== undefined) {
              return {
                result:
                  existing.payloadFingerprint === request.payloadFingerprint
                    ? success(existing)
                    : failure(
                        new IdempotencyConflict({
                          instanceId: request.instanceId,
                          idempotencyKey: request.idempotencyKey,
                        }),
                      ),
                write: false,
              }
            }
            if (!activeDocument(document)) {
              return {
                result: failure(new CompletedInstance({ instanceId: request.instanceId })),
                write: false,
              }
            }
            const record: DispatchRecord = {
              instanceId: request.instanceId,
              idempotencyKey: request.idempotencyKey,
              payloadFingerprint: request.payloadFingerprint,
              status: "pending",
              revision: document.checkpoint.revision,
              reason: "",
            }
            document.dispatches.set(request.idempotencyKey, record)
            putMessage(document, request.message)
            return { result: success(record), write: true }
          },
        ),

      claimMachine: (id, workerId, leaseMillis) =>
        modify(store, id, "claimMachine", (document, now) => {
          if (!activeDocument(document)) {
            return { result: success(Option.none<MachineDelivery>()), write: false }
          }
          const active = [...document.messages.values()].some(
            (stored) =>
              stored.status === "claimed" && (stored.claim?.leaseExpiresAtEpochMillis ?? 0) > now,
          )
          if (active) return { result: success(Option.none<MachineDelivery>()), write: false }
          const eligible = [...document.messages.values()]
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
          if (eligible === undefined) {
            return { result: success(Option.none<MachineDelivery>()), write: false }
          }
          const claim = makeClaim(eligible, eligible.value.messageId, workerId, now, leaseMillis)
          deliveryOwners.set(eligible.value.messageId, id)
          return {
            result: success(
              Option.some({ checkpoint: document.checkpoint, message: eligible.value, claim }),
            ),
            write: true,
          }
        }),

      renewMachine: (id, expectedFence, leaseMillis) => {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) {
          return Effect.fail(new LeaseLost({ deliveryId: id, expectedFence }))
        }
        return modify<Claim, LeaseLost>(
          store,
          owner,
          "renewMachine",
          (document, now) => {
            const stored = document.messages.get(id)
            const currentClaim = stored?.claim
            if (
              stored === undefined ||
              currentClaim === null ||
              currentClaim === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, expectedFence, now)
            ) {
              return {
                result: failure(new LeaseLost({ deliveryId: id, expectedFence })),
                write: false,
              }
            }
            const expires = currentClaim.leaseExpiresAtEpochMillis
            const renewed: Claim = {
              ...currentClaim,
              leaseExpiresAtEpochMillis: now + leaseMillis,
            }
            stored.claim = renewed
            return { result: success(renewed), write: true, notAfter: expires }
          },
          () => new LeaseLost({ deliveryId: id, expectedFence }),
        )
      },

      releaseMachine: (id, expectedFence) => {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) {
          return Effect.fail(new LeaseLost({ deliveryId: id, expectedFence }))
        }
        return modify(
          store,
          owner,
          "releaseMachine",
          (document, now) => {
            const stored = document.messages.get(id)
            if (
              stored === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, expectedFence, now)
            ) {
              return {
                result: failure(new LeaseLost({ deliveryId: id, expectedFence })),
                write: false,
              }
            }
            const expires = stored.claim?.leaseExpiresAtEpochMillis
            stored.status = "pending"
            stored.claim = null
            return { result: success(undefined), write: true, notAfter: expires }
          },
          () => new LeaseLost({ deliveryId: id, expectedFence }),
        )
      },

      commitMachine: (commit) =>
        modify<void, LeaseLost | RevisionConflict>(
          store,
          commit.instanceId,
          "commitMachine",
          (document, now) => {
            const stored = document.messages.get(commit.deliveryId)
            if (
              stored === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, commit.fence, now)
            ) {
              return {
                result: failure(
                  new LeaseLost({
                    deliveryId: commit.deliveryId,
                    expectedFence: commit.fence,
                  }),
                ),
                write: false,
              }
            }
            if (document.checkpoint.revision !== commit.expectedRevision) {
              return {
                result: failure(
                  new RevisionConflict({
                    instanceId: commit.instanceId,
                    expected: commit.expectedRevision,
                    actual: durableRevision(document.checkpoint.revision),
                  }),
                ),
                write: false,
              }
            }
            const expires = stored.claim?.leaseExpiresAtEpochMillis
            const replacement = mutableDocument(
              planMachineCommit(persistedDocument(document), commit),
            )
            return {
              result: success(undefined),
              write: true,
              notAfter: expires,
              replacement,
            }
          },
          () =>
            new LeaseLost({
              deliveryId: commit.deliveryId,
              expectedFence: commit.fence,
            }),
        ),

      claimActivity: (id, workerId, leaseMillis) =>
        modify(store, id, "claimActivity", (document, now) => {
          if (!activeDocument(document)) {
            return { result: success(Option.none<ActivityDelivery>()), write: false }
          }
          const eligible = [...document.activities.values()]
            .filter((stored) => {
              if (
                stored.status !== "pending" &&
                !(
                  stored.status === "claimed" &&
                  (stored.claim?.leaseExpiresAtEpochMillis ?? 0) <= now
                )
              ) {
                return false
              }
              const activeInGroup = [...document.activities.values()].filter(
                (other) =>
                  other.status === "claimed" &&
                  (other.claim?.leaseExpiresAtEpochMillis ?? 0) > now &&
                  other.value.concurrencyGroup === stored.value.concurrencyGroup,
              ).length
              return activeInGroup < stored.value.concurrencyLimit
            })
            .sort((left, right) => left.sequence - right.sequence)[0]
          if (eligible === undefined) {
            return { result: success(Option.none<ActivityDelivery>()), write: false }
          }
          const claim = makeClaim(eligible, eligible.value.deliveryId, workerId, now, leaseMillis)
          deliveryOwners.set(eligible.value.deliveryId, id)
          return {
            result: success(Option.some({ command: eligible.value, claim })),
            write: true,
          }
        }),

      activityClaimActive: Effect.fnUntraced(function* (id, expectedFence) {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) return false
        const loaded = yield* store
          .load(machineInstanceId(owner))
          .pipe(Effect.mapError((error) => storeFailure("load", error)))
        if (Option.isNone(loaded)) return false
        const now = yield* store.now.pipe(Effect.mapError((error) => storeFailure("now", error)))
        const document = mutableDocument(loaded.value)
        const stored = document.activities.get(id)
        return (
          stored !== undefined &&
          activeDocument(document) &&
          claimMatches(stored, expectedFence, now)
        )
      }),

      appendActivityTree: (id, expectedFence, records) => {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) {
          return Effect.fail(new LeaseLost({ deliveryId: id, expectedFence }))
        }
        return modify(
          store,
          owner,
          "appendActivityTree",
          (document, now) => {
            const stored = document.activities.get(id)
            if (
              stored === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, expectedFence, now)
            ) {
              return {
                result: failure(new LeaseLost({ deliveryId: id, expectedFence })),
                write: false,
              }
            }
            const keys = new Set(document.tree.records.map((record) => record.key))
            let nextSequence = document.tree.nextSequence
            const additions = records
              .filter((record) => !keys.has(record.key))
              .map((record) => ({ ...record, sequence: nextSequence++ }))
            if (additions.length === 0) {
              return { result: success(undefined), write: false }
            }
            const replacement = mutableDocument({
              ...persistedDocument(document),
              tree: {
                ...document.tree,
                nextSequence,
                records: [...document.tree.records, ...additions],
              },
            })
            return {
              result: success(undefined),
              write: true,
              notAfter: stored.claim?.leaseExpiresAtEpochMillis,
              replacement,
            }
          },
          () => new LeaseLost({ deliveryId: id, expectedFence }),
        )
      },

      renewActivity: (id, expectedFence, leaseMillis) => {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) {
          return Effect.fail(new LeaseLost({ deliveryId: id, expectedFence }))
        }
        return modify<Claim, LeaseLost>(
          store,
          owner,
          "renewActivity",
          (document, now) => {
            const stored = document.activities.get(id)
            const currentClaim = stored?.claim
            if (
              stored === undefined ||
              currentClaim === null ||
              currentClaim === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, expectedFence, now)
            ) {
              return {
                result: failure(new LeaseLost({ deliveryId: id, expectedFence })),
                write: false,
              }
            }
            const expires = currentClaim.leaseExpiresAtEpochMillis
            const renewed: Claim = {
              ...currentClaim,
              leaseExpiresAtEpochMillis: now + leaseMillis,
            }
            stored.claim = renewed
            return { result: success(renewed), write: true, notAfter: expires }
          },
          () => new LeaseLost({ deliveryId: id, expectedFence }),
        )
      },

      releaseActivity: (id, expectedFence) => {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) {
          return Effect.fail(new LeaseLost({ deliveryId: id, expectedFence }))
        }
        return modify(
          store,
          owner,
          "releaseActivity",
          (document, now) => {
            const stored = document.activities.get(id)
            if (
              stored === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, expectedFence, now)
            ) {
              return {
                result: failure(new LeaseLost({ deliveryId: id, expectedFence })),
                write: false,
              }
            }
            const expires = stored.claim?.leaseExpiresAtEpochMillis
            stored.status = "pending"
            stored.claim = null
            return { result: success(undefined), write: true, notAfter: expires }
          },
          () => new LeaseLost({ deliveryId: id, expectedFence }),
        )
      },

      completeActivity: (id, expectedFence, outcomeMessage) => {
        const owner = deliveryOwners.get(id)
        if (owner === undefined) {
          return Effect.fail(new LeaseLost({ deliveryId: id, expectedFence }))
        }
        return modify(
          store,
          owner,
          "completeActivity",
          (document, now) => {
            const stored = document.activities.get(id)
            if (
              stored === undefined ||
              !activeDocument(document) ||
              !claimMatches(stored, expectedFence, now)
            ) {
              return {
                result: failure(new LeaseLost({ deliveryId: id, expectedFence })),
                write: false,
              }
            }
            const expires = stored.claim?.leaseExpiresAtEpochMillis
            stored.status = "done"
            stored.claim = null
            document.executionTombstones.add(stored.value.executionId)
            putMessage(document, outcomeMessage)
            return { result: success(undefined), write: true, notAfter: expires }
          },
          () => new LeaseLost({ deliveryId: id, expectedFence }),
        )
      },

      observeDispatch: Effect.fnUntraced(function* (id, key) {
        while (true) {
          const loaded = yield* store
            .load(machineInstanceId(id))
            .pipe(Effect.mapError((error) => storeFailure("observeDispatch", error)))
          const record = Option.isSome(loaded)
            ? loaded.value.dispatches.find((dispatch) => dispatch.idempotencyKey === key)?.record
            : undefined
          if (record === undefined) {
            return yield* new StoreError({
              operation: "observeDispatch",
              message: "dispatch does not exist",
            })
          }
          if (record.status !== "pending") return record
          yield* Effect.sleep(10)
        }
      }),

      loadDocument: Effect.fnUntraced(function* (id) {
        const loaded = yield* store
          .load(machineInstanceId(id))
          .pipe(Effect.mapError((error) => storeFailure("loadDocument", error)))
        return Option.map(
          loaded,
          (document): MigrationDocument => ({
            checkpoint: document.checkpoint,
            messages: document.messages
              .filter((delivery) => delivery.status === "pending" || delivery.status === "claimed")
              .map((delivery) => delivery.value),
            activities: document.activities
              .filter((delivery) => delivery.status === "pending" || delivery.status === "claimed")
              .map((delivery) => delivery.value),
          }),
        )
      }),

      commitMigration: (id, expectedRevision, migration) =>
        modify(store, id, "commitMigration", (document) => {
          if (document.checkpoint.revision !== expectedRevision) {
            return {
              result: failure(
                new RevisionConflict({
                  instanceId: id,
                  expected: expectedRevision,
                  actual: durableRevision(document.checkpoint.revision),
                }),
              ),
              write: false,
            }
          }
          const migrationFence = Math.max(
            0,
            ...[...document.messages.values(), ...document.activities.values()].map(
              (delivery) => delivery.fence,
            ),
          )
          document.checkpoint = migration.checkpoint
          document.messages.clear()
          document.activities.clear()
          for (const message of migration.messages) putMessage(document, message)
          for (const activity of migration.activities) putActivity(document, activity)
          for (const delivery of [...document.messages.values(), ...document.activities.values()]) {
            delivery.fence = migrationFence
          }
          return { result: success(undefined), write: true }
        }),
    })
  })

/** Converts a public compare-and-set result to its observable tag for adapter tests. */
export const resultTag = (result: CompareAndSetResult): CompareAndSetResult["_tag"] => result._tag
