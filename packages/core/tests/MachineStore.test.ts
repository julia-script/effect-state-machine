import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { TestClock } from "effect/testing"
import * as MachineStore from "../src/MachineStore.js"
import * as MachineStoreConformance from "../src/MachineStoreConformance.js"

const document = (id: MachineStore.MachineInstanceId): MachineStore.MachineDocument => {
  const checkpoint: MachineStore.MachineDocument["checkpoint"] = {
    formatVersion: 1,
    definitionId: "test",
    persistenceVersion: "1",
    instanceId: id,
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
    instanceId: id,
    ...MachineStore.documentMetadata(checkpoint),
    checkpoint,
    messages: [],
    activities: [],
    dispatches: [],
    messageTombstones: [],
    executionTombstones: [],
    nestedDocuments: [],
    nextSequence: 0,
    tree: { rootActorId: `actor:${id}`, nextSequence: 0, records: [] },
  }
}

describe("MachineStore", () => {
  it("derives separated, deterministic, total identities", () => {
    const first = MachineStore.deriveMachineInstanceId("Order", "42")
    const repeated = MachineStore.deriveMachineInstanceId("Order", "42")
    const anotherDefinition = MachineStore.deriveMachineInstanceId("Invoice", "42")
    const malformed = MachineStore.deriveMachineInstanceId("Order\ud800", "42\udc00")
    const entry = MachineStore.deriveEntryId(first, 3)

    assert.strictEqual(first, repeated)
    assert.notStrictEqual(first, anotherDefinition)
    assert.match(malformed, /^machine:v1:/)
    assert.notStrictEqual(
      MachineStore.deriveExecutionId(first, entry, "Active", "charge"),
      MachineStore.deriveExecutionId(first, entry, "Active", "charge", "secondary"),
    )
  })

  it.effect("atomically creates, replaces, conflicts, and expires", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const id = MachineStore.deriveMachineInstanceId("test", "one")
      const initial = document(id)

      const created = yield* store.compareAndSet({
        instanceId: id,
        expectedRevision: undefined,
        document: initial,
      })
      assert.strictEqual(created._tag, "Committed")

      const loaded = yield* store.load(id)
      assert(Option.isSome(loaded))
      assert.strictEqual(loaded.value.revision, 0)

      const conflict = yield* store.compareAndSet({
        instanceId: id,
        expectedRevision: undefined,
        document: initial,
      })
      assert.strictEqual(conflict._tag, "Conflict")

      const now = yield* store.now
      const expired = yield* store.compareAndSet({
        instanceId: id,
        expectedRevision: MachineStore.revision(0),
        document: { ...initial, revision: 1 },
        notAfter: now,
      })
      assert.strictEqual(expired._tag, "Expired")

      yield* TestClock.adjust("1 millis")
      const replaced = yield* store.compareAndSet({
        instanceId: id,
        expectedRevision: MachineStore.revision(0),
        document: { ...initial, revision: 1 },
      })
      assert.strictEqual(replaced._tag, "Committed")
    }),
  )

  it.effect("rejects malformed documents at the persistence boundary", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const id = MachineStore.deriveMachineInstanceId("test", "invalid")
      const invalid = { ...document(id), messages: [{ value: "bad" }] }
      const exit = yield* Effect.exit(
        store.compareAndSet({
          instanceId: id,
          expectedRevision: undefined,
          // This cast deliberately crosses the adapter boundary to exercise runtime validation.
          document: invalid as unknown as MachineStore.MachineDocument,
        }),
      )
      assert.strictEqual(exit._tag, "Failure")
    }),
  )

  it.effect("round-trips root and nested runtime-tree envelopes", () =>
    Effect.gen(function* () {
      const id = MachineStore.deriveMachineInstanceId("tree", "one")
      const base = document(id)
      const child = (
        key: string,
        ownerPath: string,
        parentEntryId: string,
        status: MachineStore.PersistedTerminalStatus,
      ): MachineStore.PersistedRuntimeNode => ({
        key,
        actorId: `actor:${key}`,
        definitionPath: `root/Active:${key}`,
        parentActorId: `actor:${id}`,
        ownerStateTag: "Active",
        invocation: key,
        ownerPath,
        parentEntryId,
        definitionId: key,
        persistenceVersion: "1",
        input: { key },
        state: { _tag: status === "completed" ? "Done" : "Active" },
        status,
        rootEntryId: `${key}:entry`,
        regionEntryIds: [],
      })
      const checkpoint = base.checkpoint
      const candidate: MachineStore.MachineDocument = {
        ...base,
        ...MachineStore.documentMetadata(checkpoint, { root: true }, [
          child("active", "Root/active", checkpoint.rootEntryId, "running"),
          child("completed", "Root/completed", checkpoint.rootEntryId, "completed"),
          child("cancelled", "Root/cancelled", checkpoint.rootEntryId, "cancelled"),
          child("nested", "Root/active/nested", "active:entry", "running"),
        ]),
      }
      const encoded = yield* Schema.encodeUnknownEffect(MachineStore.MachineDocument)(candidate)
      const decoded = yield* Schema.decodeUnknownEffect(MachineStore.MachineDocument)(encoded)
      assert.deepStrictEqual(decoded, candidate)
    }),
  )

  it.effect("rejects malformed aggregate envelopes independently", () =>
    Effect.gen(function* () {
      const id = MachineStore.deriveMachineInstanceId("envelopes", "invalid")
      const valid = document(id)
      const malformed: ReadonlyArray<unknown> = [
        { ...valid, status: "paused" },
        { ...valid, runtime: { nodes: [{ key: "missing-fields" }] } },
        { ...valid, messages: [{}] },
        { ...valid, timers: [{ entryId: "missing-fields" }] },
        { ...valid, activities: [{ claim: {} }] },
        { ...valid, dispatches: [{}] },
        { ...valid, executions: [{ id: "missing-fields" }] },
        { ...valid, migration: { definitionId: "missing-fields" } },
      ]
      for (const candidate of malformed) {
        const exit = yield* Effect.exit(
          Schema.decodeUnknownEffect(MachineStore.MachineDocument)(candidate),
        )
        assert.strictEqual(exit._tag, "Failure")
      }
    }),
  )

  it.effect("rejects ambiguous tree journals at the document boundary", () =>
    Effect.gen(function* () {
      const id = MachineStore.deriveMachineInstanceId("tree", "invalid-journal")
      const valid = document(id)
      const record = {
        key: "snapshot",
        sequence: 0,
        actorId: `actor:${id}`,
        definitionPath: "root",
        body: { _tag: "StateSnapshot" as const, state: { _tag: "Active" } },
      }
      const malformed: ReadonlyArray<unknown> = [
        { ...valid, tree: { ...valid.tree, rootActorId: "actor:another" } },
        { ...valid, tree: { ...valid.tree, nextSequence: 1, records: [] } },
        {
          ...valid,
          tree: { ...valid.tree, nextSequence: 1, records: [{ ...record, sequence: 2 }] },
        },
        {
          ...valid,
          tree: {
            ...valid.tree,
            nextSequence: 2,
            records: [record, { ...record, sequence: 1 }],
          },
        },
      ]
      for (const candidate of malformed) {
        const exit = yield* Effect.exit(
          Schema.decodeUnknownEffect(MachineStore.MachineDocument)(candidate),
        )
        assert.strictEqual(exit._tag, "Failure")
      }
    }),
  )
})

describe("MachineStore primitive conformance", () => {
  for (const conformance of MachineStoreConformance.make(MachineStore.makeMemory, (millis) =>
    TestClock.adjust(`${millis} millis`),
  )) {
    it.effect(conformance.name, () => conformance.run)
  }
})
