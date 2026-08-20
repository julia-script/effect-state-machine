import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as MachineStore from "../src/MachineStore.js"
import * as Document from "../src/MachineStoreDocument.js"
import * as MachineStoreNested from "../src/MachineStoreNested.js"

const document = (
  definitionId: string,
  instanceId: MachineStore.MachineInstanceId,
  rootEntryId: MachineStore.EntryId,
): MachineStore.MachineDocument => {
  const checkpoint: MachineStore.MachineDocument["checkpoint"] = {
    formatVersion: 1,
    definitionId,
    persistenceVersion: "1",
    instanceId,
    revision: 0,
    status: "running",
    state: { _tag: "Active" },
    rootEntryId,
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

const childActivity = (
  parent: MachineStore.MachineDocument,
  childId: MachineStore.MachineInstanceId,
  childName: string,
): MachineStore.StoredActivityDelivery => ({
  value: {
    deliveryId: `delivery:${childName}`,
    instanceId: parent.instanceId,
    executionId: `execution:${childName}`,
    entryId: parent.checkpoint.rootEntryId,
    generation: parent.checkpoint.revision,
    ownerPath: "Active",
    invocation: `child:${childName}`,
    lane: childId,
    state: parent.checkpoint.state,
    parentState: null,
    concurrencyGroup: "default",
    concurrencyLimit: 1,
  },
  sequence: 0,
  status: "pending",
  claim: null,
  attempt: 0,
  fence: 0,
})

const decodeNested = (
  root: MachineStore.MachineDocument,
  instanceId: string,
): MachineStore.MachineDocument =>
  Schema.decodeUnknownSync(MachineStore.MachineDocument)(
    root.nestedDocuments.find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "instanceId" in value &&
        value.instanceId === instanceId,
    ),
  )

const load = (
  store: MachineStore.Service,
  instanceId: MachineStore.MachineInstanceId,
): Effect.Effect<MachineStore.MachineDocument, MachineStore.MachineStoreError> =>
  store.load(instanceId).pipe(Effect.map(Option.getOrThrow))

describe("MachineStoreNested", () => {
  it.effect("commits a grandchild completion and one immediate-parent outcome atomically", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const rootId = MachineStore.deriveMachineInstanceId("root", "one")
      const rootEntryId = MachineStore.deriveEntryId(rootId, 0)
      const branchId = MachineStore.deriveChildMachineInstanceId(rootId, rootEntryId, "branch")
      const branchEntryId = MachineStore.deriveEntryId(branchId, 0)
      const leafId = MachineStore.deriveChildMachineInstanceId(branchId, branchEntryId, "leaf")
      const root = Document.putActivity(
        document("root", rootId, rootEntryId),
        childActivity(document("root", rootId, rootEntryId), branchId, "branch"),
      )
      const initialized = yield* store.compareAndSet({
        instanceId: rootId,
        expectedRevision: undefined,
        document: root,
      })
      assert.strictEqual(initialized._tag, "Committed")

      const nested = MachineStoreNested.make(store, rootId)
      const branch = Document.putActivity(
        document("branch", branchId, branchEntryId),
        childActivity(document("branch", branchId, branchEntryId), leafId, "leaf"),
      )
      const inserted = yield* nested.compareAndSet({
        instanceId: branchId,
        expectedRevision: undefined,
        document: branch,
      })
      assert.strictEqual(inserted._tag, "Committed")

      const leaf = Document.terminate(
        document("leaf", leafId, MachineStore.deriveEntryId(leafId, 0)),
        "completed",
      )
      const completed = yield* nested.compareAndSet({
        instanceId: leafId,
        expectedRevision: undefined,
        document: leaf,
      })
      assert.strictEqual(completed._tag, "Committed")

      const aggregate = yield* load(store, rootId)
      const storedBranch = decodeNested(aggregate, branchId)
      const storedLeaf = decodeNested(aggregate, leafId)
      assert.strictEqual(storedLeaf.status, "completed")
      assert.strictEqual(storedBranch.activities[0]?.status, "done")
      assert.strictEqual(
        storedBranch.messages.filter(({ value }) => value._tag === "ActivityOutcome").length,
        1,
      )

      const replay = yield* nested.compareAndSet({
        instanceId: leafId,
        expectedRevision: undefined,
        document: leaf,
      })
      assert.strictEqual(replay._tag, "Conflict")
      const afterReplay = decodeNested(yield* load(store, rootId), branchId)
      assert.strictEqual(
        afterReplay.messages.filter(({ value }) => value._tag === "ActivityOutcome").length,
        1,
      )
    }),
  )

  it.effect("rejects stale child initialization after its owning aggregate exits", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const rootId = MachineStore.deriveMachineInstanceId("root", "cancelled")
      const rootEntryId = MachineStore.deriveEntryId(rootId, 0)
      const childId = MachineStore.deriveChildMachineInstanceId(rootId, rootEntryId, "child")
      const active = Document.putActivity(
        document("root", rootId, rootEntryId),
        childActivity(document("root", rootId, rootEntryId), childId, "child"),
      )
      const cancelled = Document.terminate(active, "cancelled")
      yield* store.compareAndSet({
        instanceId: rootId,
        expectedRevision: undefined,
        document: cancelled,
      })

      const stale = yield* MachineStoreNested.make(store, rootId).compareAndSet({
        instanceId: childId,
        expectedRevision: undefined,
        document: document("child", childId, MachineStore.deriveEntryId(childId, 0)),
      })
      assert.strictEqual(stale._tag, "Conflict")
      assert.deepStrictEqual((yield* load(store, rootId)).nestedDocuments, [])
    }),
  )
})
