import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as MachineStore from "../src/MachineStore.js"
import * as Document from "../src/MachineStoreDocument.js"
import * as Runtime from "./MachineRuntimeTestKit.js"

const emptyDocument = (): MachineStore.MachineDocument => {
  const instanceId = MachineStore.deriveMachineInstanceId("safe-document", "one")
  const checkpoint: MachineStore.MachineDocument["checkpoint"] = {
    formatVersion: 1,
    definitionId: "safe-document",
    persistenceVersion: "1",
    instanceId,
    revision: 0,
    status: "running",
    state: { _tag: "Active" },
    rootEntryId: "entry:0",
    regionEntryIds: {},
    timers: [],
    aggregates: [],
    nextSequence: 0,
    defect: null,
  }
  return {
    formatVersion: 2,
    revision: 0,
    instanceId,
    ...MachineStore.documentMetadata(checkpoint),
    checkpoint,
    messages: [],
    activities: [],
    dispatches: [],
    messageTombstones: [],
    executionTombstones: [],
    nestedDocuments: [],
    nextSequence: 0,
    tree: { rootActorId: `actor:${instanceId}`, nextSequence: 0, records: [] },
  }
}

const message = (id: string): MachineStore.StoredMachineDelivery => ({
  value: {
    _tag: "External",
    messageId: Runtime.messageId(id),
    instanceId: Runtime.instanceId("safe-document"),
    availableAtEpochMillis: 0,
    idempotencyKey: id,
    payloadFingerprint: id,
    event: { _tag: "Event", id },
  },
  sequence: 0,
  status: "pending",
  claim: null,
  attempt: 0,
  fence: 0,
})

const activity = (id: string): MachineStore.StoredActivityDelivery => ({
  value: {
    deliveryId: id,
    instanceId: Runtime.instanceId("safe-document"),
    executionId: id,
    entryId: "entry:0",
    generation: 0,
    ownerPath: "Active",
    invocation: "work",
    lane: "",
    state: { _tag: "Active" },
    parentState: null,
    concurrencyGroup: "default",
    concurrencyLimit: 1,
  },
  sequence: 1,
  status: "pending",
  claim: null,
  attempt: 0,
  fence: 0,
})

const childDocument = (
  instanceId: MachineStore.MachineInstanceId,
  definitionId: string,
  rootEntryId: MachineStore.EntryId,
): MachineStore.MachineDocument => {
  const base = emptyDocument()
  const checkpoint: MachineStore.MachineDocument["checkpoint"] = {
    ...base.checkpoint,
    definitionId,
    instanceId,
    rootEntryId,
  }
  return {
    ...base,
    instanceId,
    ...MachineStore.documentMetadata(checkpoint),
    checkpoint,
    tree: { rootActorId: `actor:${instanceId}`, nextSequence: 0, records: [] },
  }
}

describe("MachineStoreDocument", () => {
  it("deduplicates dynamic keys without prototype-bearing records", () => {
    let document = emptyDocument()
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const delivery = message(key)
      document = Document.putMessage(document, delivery)
      document = Document.putMessage(document, delivery)
      document = Document.putActivity(document, activity(key))
      document = Document.putActivity(document, activity(key))
    }
    assert.deepStrictEqual(
      document.messages.map(({ value }) => value.messageId),
      ["__proto__", "constructor", "prototype"],
    )
    assert.deepStrictEqual(
      document.activities.map(({ value }) => value.deliveryId),
      ["__proto__", "constructor", "prototype"],
    )
    assert.strictEqual(Object.getPrototypeOf(document), Object.prototype)
  })

  it("increments fences and rejects a stale active claim", () => {
    const initial = Document.putMessage(emptyDocument(), message("claim"))
    const first = Document.claimMessage(initial, "claim", "worker-a", 0, 100)
    assert(first !== undefined)
    assert.strictEqual(first.claim.attempt, 1)
    assert.strictEqual(first.claim.fence, 1)
    assert.strictEqual(
      Document.claimMessage(first.document, "claim", "worker-b", 99, 100),
      undefined,
    )
    const replacement = Document.claimMessage(first.document, "claim", "worker-b", 100, 100)
    assert(replacement !== undefined)
    assert.strictEqual(replacement.claim.attempt, 2)
    assert.strictEqual(replacement.claim.fence, 2)
  })

  it("preserves completed activities while cancelling only live entry work", () => {
    const completed = { ...activity("completed"), status: "done" as const }
    const running = Document.putActivity(
      Document.putActivity(emptyDocument(), completed),
      activity("running"),
    )
    const planned = Document.planMachineCommit(running, {
      instanceId: Runtime.instanceId(running.instanceId),
      deliveryId: Runtime.deliveryId("commit"),
      fence: 1,
      expectedRevision: Runtime.revision(running.checkpoint.revision),
      checkpoint: running.checkpoint,
      publishMessages: [],
      publishActivities: [],
      cancelMessageIds: [],
      cancelExecutionIds: [Runtime.executionId("completed"), Runtime.executionId("running")],
      dispatch: undefined,
    })

    assert.strictEqual(
      planned.activities.find(({ value }) => value.executionId === "completed")?.status,
      "done",
    )
    assert.strictEqual(
      planned.activities.find(({ value }) => value.executionId === "running")?.status,
      "cancelled",
    )
  })

  it("cleans terminal work and compacts tombstones only with explicit proof", () => {
    const running = Document.putActivity(
      Document.putMessage(emptyDocument(), message("late-message")),
      activity("late-execution"),
    )
    const terminal = Document.terminate(running, "completed")
    assert.strictEqual(terminal.messages[0]?.status, "cancelled")
    assert.strictEqual(terminal.activities[0]?.status, "cancelled")
    assert.deepStrictEqual(terminal.timers, [])
    assert.deepStrictEqual(terminal.messageTombstones, ["late-message"])
    assert.deepStrictEqual(terminal.executionTombstones, ["late-execution"])

    const safeDefault = Document.compact(terminal)
    assert.deepStrictEqual(safeDefault.messageTombstones, ["late-message"])
    assert.deepStrictEqual(safeDefault.executionTombstones, ["late-execution"])
    const proven = Document.compact(terminal, {
      messageIds: new Set(["late-message"]),
      executionIds: new Set(["late-execution"]),
    })
    assert.deepStrictEqual(proven.messageTombstones, [])
    assert.deepStrictEqual(proven.executionTombstones, [])
  })

  it("cancels a nested child and all of its flattened descendants", () => {
    const root = emptyDocument()
    const childId = MachineStore.deriveChildMachineInstanceId(
      MachineStore.machineInstanceId(root.instanceId),
      MachineStore.entryId(root.checkpoint.rootEntryId),
      "branch",
    )
    const child = childDocument(childId, "branch", MachineStore.entryId("branch-entry"))
    const grandchildId = MachineStore.deriveChildMachineInstanceId(
      childId,
      MachineStore.entryId(child.checkpoint.rootEntryId),
      "leaf",
    )
    const grandchild = childDocument(grandchildId, "leaf", MachineStore.entryId("leaf-entry"))
    const document: MachineStore.MachineDocument = {
      ...root,
      nestedDocuments: [child, grandchild],
      runtime: {
        nodes: [
          ...root.runtime.nodes,
          {
            ...child.runtime.nodes[0],
            key: childId,
            parentActorId: `actor:${root.instanceId}`,
            definitionPath: "root/Active:branch",
          },
          {
            ...grandchild.runtime.nodes[0],
            key: grandchildId,
            parentActorId: `actor:${childId}`,
            definitionPath: "root/Active:branch/Active:leaf",
          },
        ],
      },
    }

    const cancelled = Document.cancelChildRuntimes(document, new Set([childId]))
    const cancelledChild = Schema.decodeUnknownSync(MachineStore.MachineDocument)(
      cancelled.nestedDocuments[0],
    )
    const cancelledGrandchild = Schema.decodeUnknownSync(MachineStore.MachineDocument)(
      cancelled.nestedDocuments[1],
    )

    assert.strictEqual(cancelledChild.status, "cancelled")
    assert.strictEqual(cancelledGrandchild.status, "cancelled")
    assert.strictEqual(
      cancelled.runtime.nodes.find(({ key }) => key === childId)?.status,
      "cancelled",
    )
    assert.strictEqual(
      cancelled.runtime.nodes.find(({ key }) => key === grandchildId)?.status,
      "cancelled",
    )
    const terminalActorIds = cancelled.tree.records
      .filter((record) => record.body._tag === "ActorTerminated")
      .map((record) => record.actorId)
    assert.deepStrictEqual(terminalActorIds, [`actor:${grandchildId}`, `actor:${childId}`])
    assert.deepStrictEqual(
      cancelled.tree.records.map((record) => record.sequence),
      [0, 1],
    )
    const terminated = Document.terminate(
      {
        ...cancelled,
        tree: {
          ...cancelled.tree,
          nextSequence: 3,
          records: [
            ...cancelled.tree.records,
            {
              key: "root:terminal-from-runtime",
              sequence: 2,
              actorId: `actor:${root.instanceId}`,
              definitionPath: "root",
              body: { _tag: "ActorTerminated", status: "completed" },
            },
          ],
        },
      },
      "completed",
    )
    assert.deepStrictEqual(
      terminated.tree.records
        .filter((record) => record.body._tag === "ActorTerminated")
        .map((record) => record.actorId),
      [`actor:${grandchildId}`, `actor:${childId}`, `actor:${root.instanceId}`],
    )
  })
})
