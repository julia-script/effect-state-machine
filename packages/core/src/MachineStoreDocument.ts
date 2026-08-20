import type { Claim, Json, MachineCommit } from "./MachineRuntimeProtocol.js"
import type {
  MachineDocument,
  PersistedTerminalStatus,
  StoredActivityDelivery,
  StoredMachineDelivery,
} from "./MachineStore.js"
import { documentMetadata, parseChildMachineInstanceId } from "./MachineStore.js"

/** Result of a pure delivery claim plan. */
export interface ClaimedDelivery<Delivery> {
  readonly document: MachineDocument
  readonly delivery: Delivery
  readonly claim: Claim
}

/** Looks up a mailbox delivery without using caller-authored strings as object properties. */
export const findMessage = (
  document: MachineDocument,
  messageId: string,
): StoredMachineDelivery | undefined =>
  document.messages.find((delivery) => delivery.value.messageId === messageId)

/** Looks up an activity delivery without using caller-authored strings as object properties. */
export const findActivity = (
  document: MachineDocument,
  deliveryId: string,
): StoredActivityDelivery | undefined =>
  document.activities.find((delivery) => delivery.value.deliveryId === deliveryId)

/** Appends one keyed mailbox delivery unless it is present or permanently tombstoned. */
export const putMessage = (
  document: MachineDocument,
  delivery: StoredMachineDelivery,
): MachineDocument =>
  findMessage(document, delivery.value.messageId) !== undefined ||
  document.messageTombstones.includes(delivery.value.messageId)
    ? document
    : { ...document, messages: [...document.messages, delivery] }

/** Appends one keyed activity unless its delivery or stable execution was already recorded. */
export const putActivity = (
  document: MachineDocument,
  delivery: StoredActivityDelivery,
): MachineDocument =>
  findActivity(document, delivery.value.deliveryId) !== undefined ||
  document.executionTombstones.includes(delivery.value.executionId)
    ? document
    : {
        ...document,
        activities: [...document.activities, delivery],
        executions: [
          ...document.executions,
          {
            id: delivery.value.executionId,
            entryId: delivery.value.entryId,
            ownerPath: delivery.value.ownerPath,
            invocation: delivery.value.invocation,
            lane: delivery.value.lane,
            status: delivery.status,
            attempt: delivery.attempt,
            fence: delivery.fence,
          },
        ],
      }

const claim = <Delivery extends StoredMachineDelivery | StoredActivityDelivery>(
  deliveries: ReadonlyArray<Delivery>,
  index: number,
  deliveryId: string,
  workerId: string,
  now: number,
  leaseMillis: number,
  replace: (deliveries: ReadonlyArray<Delivery>) => MachineDocument,
): ClaimedDelivery<Delivery> | undefined => {
  const delivery = deliveries[index]
  if (
    delivery === undefined ||
    (delivery.status !== "pending" &&
      !(
        delivery.status === "claimed" &&
        (delivery.claim?.leaseExpiresAtEpochMillis ?? Number.POSITIVE_INFINITY) <= now
      ))
  ) {
    return undefined
  }
  const nextClaim: Claim = {
    deliveryId,
    workerId,
    fence: delivery.fence + 1,
    attempt: delivery.attempt + 1,
    leaseExpiresAtEpochMillis: now + leaseMillis,
  }
  const nextDelivery: Delivery = {
    ...delivery,
    status: "claimed",
    claim: nextClaim,
    attempt: nextClaim.attempt,
    fence: nextClaim.fence,
  }
  const next = deliveries.map((candidate, candidateIndex) =>
    candidateIndex === index ? nextDelivery : candidate,
  )
  return { document: replace(next), delivery: nextDelivery, claim: nextClaim }
}

/** Plans a mailbox claim with monotonically increasing attempt and fence values. */
export const claimMessage = (
  document: MachineDocument,
  messageId: string,
  workerId: string,
  now: number,
  leaseMillis: number,
): ClaimedDelivery<StoredMachineDelivery> | undefined =>
  claim(
    document.messages,
    document.messages.findIndex((delivery) => delivery.value.messageId === messageId),
    messageId,
    workerId,
    now,
    leaseMillis,
    (messages) => ({ ...document, messages }),
  )

/** Plans an activity claim with monotonically increasing attempt and fence values. */
export const claimActivity = (
  document: MachineDocument,
  deliveryId: string,
  workerId: string,
  now: number,
  leaseMillis: number,
): ClaimedDelivery<StoredActivityDelivery> | undefined =>
  claim(
    document.activities,
    document.activities.findIndex((delivery) => delivery.value.deliveryId === deliveryId),
    deliveryId,
    workerId,
    now,
    leaseMillis,
    (activities) => ({ ...document, activities }),
  )

type ActorTerminalStatus = "completed" | "cancelled" | "defected"

const appendActorTerminations = (
  document: MachineDocument,
  terminations: ReadonlyArray<
    Readonly<{ node: MachineDocument["runtime"]["nodes"][number]; status: ActorTerminalStatus }>
  >,
): MachineDocument => {
  const terminalActors = new Set(
    document.tree.records
      .filter((record) => record.body._tag === "ActorTerminated")
      .map((record) => record.actorId),
  )
  const keys = new Set(document.tree.records.map((record) => record.key))
  const records = [...document.tree.records]
  let nextSequence = document.tree.nextSequence
  const nodesByActorId = new Map(
    document.runtime.nodes.map((node) => [node.actorId, node] as const),
  )
  const actorDepth = (node: MachineDocument["runtime"]["nodes"][number]): number => {
    let depth = 0
    let parentActorId = node.parentActorId
    const visited = new Set<string>()
    while (parentActorId !== null && !visited.has(parentActorId)) {
      visited.add(parentActorId)
      const parent = nodesByActorId.get(parentActorId)
      if (parent === undefined) break
      depth++
      parentActorId = parent.parentActorId
    }
    return depth
  }
  const deepestFirst = [...terminations].sort(
    (left, right) => actorDepth(right.node) - actorDepth(left.node),
  )
  for (const { node, status } of deepestFirst) {
    if (terminalActors.has(node.actorId)) continue
    terminalActors.add(node.actorId)
    let key = `${node.actorId}:terminated`
    let collision = 0
    while (keys.has(key)) key = `${node.actorId}:terminated:${++collision}`
    keys.add(key)
    records.push({
      key,
      sequence: nextSequence++,
      actorId: node.actorId,
      definitionPath: node.definitionPath,
      body: { _tag: "ActorTerminated", status },
    })
  }
  return records.length === document.tree.records.length
    ? document
    : { ...document, tree: { ...document.tree, nextSequence, records } }
}

/**
 * Plans terminal cleanup atomically with the final aggregate status.
 *
 * Pending or claimed deliveries become cancelled, timers are removed, and their stable identities
 * become tombstones so a late publisher cannot revive the terminated runtime.
 */
export const terminate = (
  document: MachineDocument,
  status: Exclude<PersistedTerminalStatus, "running">,
): MachineDocument => {
  const rootActorId = document.runtime.nodes.find((node) => node.key === "root")?.actorId
  const retainedRecords = document.tree.records
    .filter((record) => !(record.actorId === rootActorId && record.body._tag === "ActorTerminated"))
    .map((record, sequence) => ({ ...record, sequence }))
  const orderedDocument =
    retainedRecords.length === document.tree.records.length
      ? document
      : {
          ...document,
          tree: {
            ...document.tree,
            nextSequence: retainedRecords.length,
            records: retainedRecords,
          },
        }
  const withTerminals = appendActorTerminations(
    orderedDocument,
    orderedDocument.runtime.nodes
      .filter((node) => node.key === "root" || node.status === "running")
      .map((node) => ({
        node,
        status: node.key === "root" ? status : ("cancelled" as const),
      })),
  )
  const messages = document.messages.map((delivery) =>
    delivery.status === "pending" || delivery.status === "claimed"
      ? { ...delivery, status: "cancelled" as const, claim: null }
      : delivery,
  )
  const activities = document.activities.map((delivery) =>
    delivery.status === "pending" || delivery.status === "claimed"
      ? { ...delivery, status: "cancelled" as const, claim: null }
      : delivery,
  )
  const nestedDocuments = document.nestedDocuments.map((value) =>
    nestedDocumentStatus(value) === "running" ? cancelNestedDocument(value) : value,
  )
  return {
    ...withTerminals,
    status,
    checkpoint: { ...document.checkpoint, status: status === "cancelled" ? "defected" : status },
    messages,
    activities,
    runtime: {
      nodes: document.runtime.nodes.map((node) =>
        node.key === "root"
          ? { ...node, status }
          : node.status === "running"
            ? { ...node, status: "cancelled" }
            : node,
      ),
    },
    nestedDocuments,
    timers: [],
    messageTombstones: [
      ...new Set([...document.messageTombstones, ...messages.map(({ value }) => value.messageId)]),
    ],
    executionTombstones: [
      ...new Set([
        ...document.executionTombstones,
        ...activities.map(({ value }) => value.executionId),
      ]),
    ],
  }
}

/** Cancels child runtime documents and every descendant rooted below them. */
export const cancelChildRuntimes = (
  document: MachineDocument,
  childIds: ReadonlySet<string>,
): MachineDocument => {
  const cancelledChildIds = new Set(childIds)
  let discoveredChild = true
  while (discoveredChild) {
    discoveredChild = false
    for (const value of document.nestedDocuments) {
      const instanceId = nestedDocumentInstanceId(value)
      if (instanceId === undefined || cancelledChildIds.has(instanceId)) continue
      const identity = parseChildMachineInstanceId(instanceId)
      if (identity !== undefined && cancelledChildIds.has(identity.parentInstanceId)) {
        cancelledChildIds.add(instanceId)
        discoveredChild = true
      }
    }
  }
  const withTerminals = appendActorTerminations(
    document,
    document.runtime.nodes
      .filter((node) => cancelledChildIds.has(node.key) && node.status === "running")
      .map((node) => ({ node, status: "cancelled" as const })),
  )
  return {
    ...withTerminals,
    nestedDocuments: withTerminals.nestedDocuments.map((value) => {
      const instanceId = nestedDocumentInstanceId(value)
      return instanceId !== undefined && cancelledChildIds.has(instanceId)
        ? cancelNestedDocument(value)
        : value
    }),
    runtime: {
      nodes: withTerminals.runtime.nodes.map((node) =>
        cancelledChildIds.has(node.key) ? { ...node, status: "cancelled" as const } : node,
      ),
    },
  }
}

/**
 * Plans one complete aggregate replacement for an already validated accepted machine transition.
 *
 * Claim and revision eligibility are checked by the caller against authoritative store time. This
 * function performs no persistence or clock effects; a CAS retry can discard the value and plan
 * again from the newly loaded document.
 */
export const planMachineCommit = (
  document: MachineDocument,
  commit: MachineCommit,
): MachineDocument => {
  let nextSequence = document.nextSequence
  const messages = document.messages.map((delivery) => {
    if (delivery.value.messageId === commit.deliveryId) {
      return { ...delivery, status: "done" as const, claim: null }
    }
    if (commit.cancelMessageIds.some((messageId) => messageId === delivery.value.messageId)) {
      return { ...delivery, status: "cancelled" as const, claim: null }
    }
    return delivery
  })
  const activities = document.activities.map((delivery) =>
    (delivery.status === "pending" || delivery.status === "claimed") &&
    commit.cancelExecutionIds.some((executionId) => executionId === delivery.value.executionId)
      ? { ...delivery, status: "cancelled" as const, claim: null }
      : delivery,
  )
  const cancelledChildIds = new Set(
    document.activities
      .filter(
        (delivery) =>
          (delivery.status === "pending" || delivery.status === "claimed") &&
          delivery.value.invocation.startsWith("child:") &&
          commit.cancelExecutionIds.some(
            (executionId) => executionId === delivery.value.executionId,
          ),
      )
      .map((delivery) => delivery.value.lane),
  )
  const cancelled = cancelChildRuntimes(document, cancelledChildIds)
  const runtimeChildren = cancelled.runtime.nodes.filter((node) => node.key !== "root")
  let planned: MachineDocument = {
    ...cancelled,
    ...documentMetadata(commit.checkpoint, document.input, runtimeChildren),
    checkpoint: commit.checkpoint,
    messages,
    activities,
    messageTombstones: [
      ...new Set([...document.messageTombstones, commit.deliveryId, ...commit.cancelMessageIds]),
    ],
    executionTombstones: [
      ...new Set([...document.executionTombstones, ...commit.cancelExecutionIds]),
    ],
  }
  for (const value of commit.publishMessages) {
    planned = putMessage(planned, {
      value,
      sequence: nextSequence++,
      status: "pending",
      claim: null,
      attempt: 0,
      fence: 0,
    })
  }
  for (const value of commit.publishActivities) {
    planned = putActivity(planned, {
      value,
      sequence: nextSequence++,
      status: "pending",
      claim: null,
      attempt: 0,
      fence: 0,
    })
  }
  if (commit.dispatch !== undefined) {
    planned = {
      ...planned,
      dispatches: [
        ...planned.dispatches.filter(
          (dispatch) => dispatch.idempotencyKey !== commit.dispatch?.idempotencyKey,
        ),
        { idempotencyKey: commit.dispatch.idempotencyKey, record: commit.dispatch },
      ],
    }
  }
  if ((commit.treeRecords?.length ?? 0) > 0) {
    const retained = new Set(planned.tree.records.map((record) => record.key))
    const records = [...planned.tree.records]
    let nextSequence = planned.tree.nextSequence
    for (const record of commit.treeRecords ?? []) {
      if (retained.has(record.key)) continue
      retained.add(record.key)
      records.push({ ...record, sequence: nextSequence++ })
    }
    planned = { ...planned, tree: { ...planned.tree, records, nextSequence } }
  }
  planned = { ...planned, nextSequence }
  return commit.checkpoint.status === "running"
    ? planned
    : terminate(planned, commit.checkpoint.status)
}

const nestedDocumentInstanceId = (value: Json): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "instanceId" in value &&
  typeof value.instanceId === "string"
    ? value.instanceId
    : undefined

const nestedDocumentStatus = (value: Json): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "status" in value &&
  typeof value.status === "string"
    ? value.status
    : undefined

const cancelNestedDocument = (value: Json): Json => {
  // Nested documents can only enter this aggregate through the schema-decoding nested CAS view.
  const document = value as MachineDocument
  return { ...terminate(document, "cancelled"), revision: document.revision + 1 }
}

/** Explicit proof supplied by a store that old idempotency identities are safe to forget. */
export interface CompactionProof {
  readonly messageIds?: ReadonlySet<string>
  readonly executionIds?: ReadonlySet<string>
}

/**
 * Removes terminal deliveries and only those tombstones explicitly covered by a compaction proof.
 *
 * Without a proof, tombstones remain forever: silently bounding the arrays would allow a late
 * duplicate to re-enter the aggregate.
 */
export const compact = (
  document: MachineDocument,
  proof: CompactionProof = {},
): MachineDocument => ({
  ...document,
  messages: document.messages.filter(
    (delivery) => delivery.status !== "done" && delivery.status !== "cancelled",
  ),
  activities: document.activities.filter(
    (delivery) => delivery.status !== "done" && delivery.status !== "cancelled",
  ),
  messageTombstones: document.messageTombstones.filter(
    (messageId) => !proof.messageIds?.has(messageId),
  ),
  executionTombstones: document.executionTombstones.filter(
    (executionId) => !proof.executionIds?.has(executionId),
  ),
})
