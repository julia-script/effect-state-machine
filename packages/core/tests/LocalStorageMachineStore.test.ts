import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import { TestClock } from "effect/testing"
import * as LocalStorageMachineStore from "../src/LocalStorageMachineStore.js"
import * as Machine from "../src/Machine.js"
import * as MachineEngine from "../src/MachineEngine.js"
import * as MachineEngineConformance from "../src/MachineEngineConformance.js"
import * as MachineStore from "../src/MachineStore.js"
import * as MachineStoreConformance from "../src/MachineStoreConformance.js"

const storage = (): LocalStorageMachineStore.Storage => {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

const locks = (): Effect.Effect<LocalStorageMachineStore.Locks> =>
  Effect.gen(function* () {
    const semaphore = yield* Semaphore.make(1)
    return {
      withLock: (_name, effect) => semaphore.withPermits(1)(effect),
    }
  })

const makeStore = (): Effect.Effect<MachineStore.Service> =>
  Effect.gen(function* () {
    const lock = yield* locks()
    return yield* LocalStorageMachineStore.make({ storage: storage(), locks: lock }).pipe(
      Effect.orDie,
    )
  })

const TimerState = Machine.taggedUnion({
  Waiting: { fields: {} },
  Done: { fields: {} },
})
const TimerEvent = Machine.taggedUnion({ Noop: { fields: {} } })
const timerMachine = Machine.builder({
  input: Schema.String,
  state: TimerState,
  event: TimerEvent,
})
const timerDefinition = timerMachine.define(
  {
    id: "local-storage-timer",
    idempotencyKey: (id) => id,
    initial: () => ({ _tag: "Waiting" }),
  },
  {
    Waiting: timerMachine.state(
      {},
      {
        after: { duration: "60 seconds", target: "Done", reduce: () => ({}) },
      },
    ),
    Done: timerMachine.final(),
  },
)

describe("LocalStorageMachineStore", () => {
  for (const conformance of MachineStoreConformance.make(makeStore, (millis) =>
    TestClock.adjust(`${millis} millis`),
  )) {
    it.effect(conformance.name, () => conformance.run)
  }

  it.effect("survives layer reconstruction and serializes competing writers", () =>
    Effect.gen(function* () {
      const sharedStorage = storage()
      const sharedLocks = yield* locks()
      const first = yield* LocalStorageMachineStore.make({
        storage: sharedStorage,
        locks: sharedLocks,
      })
      const second = yield* LocalStorageMachineStore.make({
        storage: sharedStorage,
        locks: sharedLocks,
      })
      const id = MachineStore.deriveMachineInstanceId("local", "shared")
      const checkpoint: MachineStore.MachineDocument["checkpoint"] = {
        formatVersion: 1,
        definitionId: "local",
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
      const base = {
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
      } satisfies MachineStore.MachineDocument

      const attempts = yield* Effect.all(
        [first, second].map((store) =>
          store.compareAndSet({
            instanceId: id,
            expectedRevision: undefined,
            document: base,
          }),
        ),
        { concurrency: "unbounded" },
      )
      assert.strictEqual(attempts.filter((result) => result._tag === "Committed").length, 1)
      assert.strictEqual(attempts.filter((result) => result._tag === "Conflict").length, 1)
      const loaded = yield* second.load(id)
      assert(Option.isSome(loaded))
      assert.strictEqual(loaded.value.instanceId, id)
    }),
  )

  it.effect("rejects unsafe cross-context construction without locks", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(LocalStorageMachineStore.make({ storage: storage() }))
      assert.strictEqual(result._tag, "Failure")
    }),
  )

  it.effect("supports explicitly named single-context operation", () =>
    Effect.gen(function* () {
      const layer = LocalStorageMachineStore.layerSingleContext({ storage: storage() })
      const absent = yield* Effect.gen(function* () {
        const store = yield* MachineStore.MachineStore
        return yield* store.load(MachineStore.deriveMachineInstanceId("local", "single"))
      }).pipe(Effect.provide(layer))
      assert(Option.isNone(absent))
    }),
  )

  it.effect("preserves an absolute timer deadline across engine layer reconstruction", () =>
    Effect.gen(function* () {
      const sharedStorage = storage()
      const sharedLocks = yield* locks()
      const storeLayer = () =>
        LocalStorageMachineStore.layer({
          storage: sharedStorage,
          locks: sharedLocks,
          namespace: "timer-reload",
        })
      const engineLayer = () =>
        MachineEngine.layer({ pollIntervalMillis: 1 }).pipe(Layer.provide(storeLayer()))

      yield* Effect.scoped(Effect.asVoid(timerDefinition.run("one"))).pipe(
        Effect.provide(engineLayer()),
      )
      yield* TestClock.adjust("30 seconds")

      yield* TestClock.adjust("29 seconds")
      const beforeDeadline = yield* Effect.scoped(
        Effect.flatMap(timerDefinition.open("one"), (handle) => handle.snapshot),
      ).pipe(Effect.provide(engineLayer()))
      assert.deepStrictEqual(beforeDeadline, { _tag: "Waiting" })
      yield* TestClock.adjust("1 second")
      const completed = yield* Effect.scoped(
        Effect.flatMap(timerDefinition.open("one"), (handle) => handle.completion),
      ).pipe(Effect.provide(engineLayer()))
      assert.deepStrictEqual(completed, { _tag: "Done" })
    }),
  )
})

const corpusStorage = storage()
const corpusEngine = MachineEngine.layer().pipe(
  Layer.provide(
    LocalStorageMachineStore.layerSingleContext({
      storage: corpusStorage,
      namespace: "engine-conformance",
    }),
  ),
)

describe("LocalStorageMachineStore engine semantic conformance", () => {
  for (const conformance of MachineEngineConformance.make(corpusEngine, (millis) =>
    TestClock.adjust(`${millis} millis`),
  )) {
    it.effect(conformance.name, () => conformance.run)
  }
})
