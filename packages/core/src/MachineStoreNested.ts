import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  type ActivityOutcome,
  deriveMessageId,
  instanceId as durableInstanceId,
  revision as durableRevision,
  type MachineMessage,
} from "./MachineRuntimeProtocol.js"
import * as MachineStore from "./MachineStore.js"
import * as MachineStoreDocument from "./MachineStoreDocument.js"

const failure = (
  operation: MachineStore.MachineStoreError["operation"],
  message: string,
  cause?: unknown,
): MachineStore.MachineStoreError =>
  new MachineStore.MachineStoreError({
    operation,
    message,
    ...(cause === undefined ? {} : { cause }),
  })

const decodeDocument = (
  value: unknown,
  operation: "load" | "compareAndSet",
): Effect.Effect<MachineStore.MachineDocument, MachineStore.MachineStoreError> =>
  Schema.decodeUnknownEffect(MachineStore.MachineDocument)(value).pipe(
    Effect.mapError((cause) =>
      failure(operation, `Invalid nested machine document: ${String(cause)}`, cause),
    ),
  )

const nestedIndex = (root: MachineStore.MachineDocument, instanceId: string): number =>
  root.nestedDocuments.findIndex(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "instanceId" in value &&
      value.instanceId === instanceId,
  )

const runtimeNode = (
  root: MachineStore.MachineDocument,
  document: MachineStore.MachineDocument,
): MachineStore.PersistedRuntimeNode => {
  const identity = MachineStore.parseChildMachineInstanceId(document.instanceId)
  const parent =
    identity === undefined
      ? undefined
      : root.runtime.nodes.find((node) => node.key === identity.parentInstanceId)
  const source = document.runtime.nodes[0]
  const actorId = `actor:${document.instanceId}`
  const started = document.tree.records.find(
    (record) => record.actorId === actorId && record.body._tag === "ActorStarted",
  )
  return {
    key: document.instanceId,
    actorId,
    definitionPath: started?.definitionPath ?? source?.definitionPath ?? "root",
    parentActorId:
      started?.body._tag === "ActorStarted"
        ? (started.body.parentActorId ?? null)
        : (parent?.actorId ?? null),
    ownerStateTag:
      started?.body._tag === "ActorStarted" ? (started.body.ownerStateTag ?? null) : null,
    invocation: started?.body._tag === "ActorStarted" ? (started.body.invocation ?? null) : null,
    ownerPath:
      identity === undefined
        ? document.definition.id
        : [parent?.ownerPath, identity.childName].filter(Boolean).join("/"),
    parentEntryId: identity?.parentEntryId ?? null,
    definitionId: document.definition.id,
    persistenceVersion: document.definition.version,
    input: document.input,
    state: document.checkpoint.state,
    status: document.status,
    rootEntryId: document.checkpoint.rootEntryId,
    regionEntryIds: source?.regionEntryIds ?? [],
  }
}

const completeChildActivity = (
  parent: MachineStore.MachineDocument,
  child: MachineStore.MachineDocument,
  now: number,
): MachineStore.MachineDocument => {
  if (child.status !== "completed" && child.status !== "defected") return parent
  const activityIndex = parent.activities.findIndex(
    (delivery) =>
      delivery.value.lane === child.instanceId &&
      delivery.value.invocation.startsWith("child:") &&
      (delivery.status === "pending" || delivery.status === "claimed"),
  )
  const stored = parent.activities[activityIndex]
  if (stored === undefined) return parent
  const command = stored.value
  const outcome: ActivityOutcome =
    child.status === "completed"
      ? { _tag: "Success", encodedValue: child.checkpoint.state }
      : {
          _tag: "Defect",
          defect:
            child.checkpoint.defect ??
            ({
              category: "activity",
              name: "ChildMachineDefect",
              message: `child ${child.instanceId} defected`,
            } as const),
        }
  const message: MachineMessage = {
    _tag: "ActivityOutcome",
    messageId: deriveMessageId(
      durableInstanceId(command.instanceId),
      durableRevision(0),
      command.ownerPath,
      `outcome:${command.executionId}`,
    ),
    instanceId: command.instanceId,
    availableAtEpochMillis: now,
    executionId: command.executionId,
    entryId: command.entryId,
    ownerPath: command.ownerPath,
    invocation: command.invocation,
    lane: command.lane,
    outcome,
  }
  const messages = parent.messages.some(
    (delivery) => delivery.value.messageId === message.messageId,
  )
    ? parent.messages
    : [
        ...parent.messages,
        {
          value: message,
          sequence: parent.nextSequence,
          status: "pending" as const,
          claim: null,
          attempt: 0,
          fence: 0,
        },
      ]
  return {
    ...parent,
    messages,
    activities: parent.activities.map((delivery, index) =>
      index === activityIndex ? { ...delivery, status: "done" as const, claim: null } : delivery,
    ),
    executions: parent.executions.map((execution) =>
      execution.id === command.executionId
        ? { ...execution, status: "done" as const, fence: stored.fence, attempt: stored.attempt }
        : execution,
    ),
    executionTombstones: [...new Set([...parent.executionTombstones, command.executionId])],
    nextSequence: messages === parent.messages ? parent.nextSequence : parent.nextSequence + 1,
  }
}

const nestedDocument = (
  root: MachineStore.MachineDocument,
  instanceId: string,
): MachineStore.MachineDocument | undefined => {
  if (instanceId === root.instanceId) return root
  const value = root.nestedDocuments[nestedIndex(root, instanceId)]
  // Nested documents enter the aggregate only after decodeDocument validates their full Schema.
  return value === undefined ? undefined : (value as MachineStore.MachineDocument)
}

const childOwnerIsActive = (
  root: MachineStore.MachineDocument,
  childInstanceId: string,
): boolean => {
  const identity = MachineStore.parseChildMachineInstanceId(childInstanceId)
  if (identity === undefined) return false
  const parent = nestedDocument(root, identity.parentInstanceId)
  return (
    parent !== undefined &&
    parent.status === "running" &&
    parent.checkpoint.rootEntryId === identity.parentEntryId &&
    parent.activities.some(
      (delivery) =>
        delivery.value.lane === childInstanceId &&
        delivery.value.invocation === `child:${identity.childName}` &&
        (delivery.status === "pending" || delivery.status === "claimed"),
    )
  )
}

const completeParentActivity = (
  root: MachineStore.MachineDocument,
  child: MachineStore.MachineDocument,
  now: number,
): MachineStore.MachineDocument => {
  const identity = MachineStore.parseChildMachineInstanceId(child.instanceId)
  if (identity === undefined) return root
  if (identity.parentInstanceId === root.instanceId) {
    return completeChildActivity(root, child, now)
  }
  const index = nestedIndex(root, identity.parentInstanceId)
  const parent = nestedDocument(root, identity.parentInstanceId)
  if (index < 0 || parent === undefined) return root
  const completed = completeChildActivity(parent, child, now)
  if (completed === parent) return root
  const nestedDocuments = [...root.nestedDocuments]
  nestedDocuments[index] = completed
  return { ...root, nestedDocuments }
}

/**
 * Creates a minimal-store view whose child documents are CAS-replaced inside one root aggregate.
 *
 * Every nested write first reloads the root and retries its root revision conflict. The revision
 * returned to the child runner remains the nested document revision, while the backing adapter
 * performs one atomic root replacement.
 */
export const make = (
  store: MachineStore.Service,
  rootInstanceId: MachineStore.MachineInstanceId,
): MachineStore.Service =>
  MachineStore.MachineStore.of({
    now: store.now,
    load: (instanceId) =>
      Effect.gen(function* () {
        const loaded = yield* store.load(rootInstanceId)
        if (Option.isNone(loaded)) return Option.none()
        const index = nestedIndex(loaded.value, instanceId)
        if (index < 0) return Option.none()
        return Option.some(yield* decodeDocument(loaded.value.nestedDocuments[index], "load"))
      }),
    compareAndSet: (request) =>
      Effect.gen(function* () {
        const candidate = yield* decodeDocument(request.document, "compareAndSet")
        if (candidate.instanceId !== request.instanceId) {
          return yield* failure(
            "compareAndSet",
            "Nested replacement document instanceId does not match the request",
          )
        }
        while (true) {
          const loaded = yield* store.load(rootInstanceId)
          if (Option.isNone(loaded)) {
            return {
              _tag: "Conflict",
              actualRevision: undefined,
              observedAt: yield* store.now,
            } as const
          }
          const root = loaded.value
          const index = nestedIndex(root, request.instanceId)
          const current =
            index < 0
              ? undefined
              : yield* decodeDocument(root.nestedDocuments[index], "compareAndSet")
          const actualRevision =
            current === undefined ? undefined : MachineStore.revision(current.revision)
          const matches =
            request.expectedRevision === undefined
              ? current === undefined
              : current !== undefined && current.revision === request.expectedRevision
          if (!matches) {
            return { _tag: "Conflict", actualRevision, observedAt: yield* store.now } as const
          }
          if (!childOwnerIsActive(root, request.instanceId)) {
            return { _tag: "Conflict", actualRevision, observedAt: yield* store.now } as const
          }
          const childRevision = MachineStore.revision((current?.revision ?? -1) + 1)
          const retainedTreeKeys = new Set(root.tree.records.map((record) => record.key))
          const treeRecords = [...root.tree.records]
          let nextTreeSequence = root.tree.nextSequence
          for (const record of candidate.tree.records) {
            if (retainedTreeKeys.has(record.key)) continue
            retainedTreeKeys.add(record.key)
            treeRecords.push({ ...record, sequence: nextTreeSequence++ })
          }
          const child: MachineStore.MachineDocument = {
            ...candidate,
            revision: childRevision,
            nestedDocuments: [],
            tree: {
              rootActorId: candidate.tree.rootActorId,
              nextSequence: 0,
              records: [],
            },
          }
          const nestedDocuments = [...root.nestedDocuments]
          if (index < 0) nestedDocuments.push(child)
          else nestedDocuments[index] = child
          const node = runtimeNode(root, candidate)
          const withNested: MachineStore.MachineDocument = {
            ...root,
            revision: root.revision + 1,
            nestedDocuments,
            runtime: {
              nodes: [
                ...root.runtime.nodes.filter((existing) => existing.key !== child.instanceId),
                node,
              ],
            },
            tree: {
              ...root.tree,
              nextSequence: nextTreeSequence,
              records: treeRecords,
            },
          }
          const cancelledChildren = new Set(
            child.activities
              .filter(
                (delivery) =>
                  delivery.status === "cancelled" && delivery.value.invocation.startsWith("child:"),
              )
              .map((delivery) => delivery.value.lane),
          )
          const withCancelledDescendants = MachineStoreDocument.cancelChildRuntimes(
            withNested,
            cancelledChildren,
          )
          const replacement = completeParentActivity(
            withCancelledDescendants,
            child,
            yield* store.now,
          )
          const committed = yield* store.compareAndSet({
            instanceId: rootInstanceId,
            expectedRevision: MachineStore.revision(root.revision),
            document: replacement,
            ...(request.notAfter === undefined ? {} : { notAfter: request.notAfter }),
          })
          if (committed._tag === "Committed") {
            return {
              _tag: "Committed",
              revision: childRevision,
              observedAt: committed.observedAt,
            } as const
          }
          if (committed._tag === "Expired") return committed
        }
        return yield* failure("compareAndSet", "unreachable nested compare-and-set loop")
      }),
  })
