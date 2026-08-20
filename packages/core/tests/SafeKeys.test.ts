import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Durable from "../src/Durable.js"
import * as Machine from "../src/Machine.js"

const Slot = Machine.taggedUnion({ Idle: { fields: {} }, Changed: { fields: {} } })
const State = Machine.taggedUnion({
  Active: {
    fields: {
      ["__proto__"]: Slot,
      constructor: Slot,
      prototype: Slot,
    },
  },
})
const Event = Machine.taggedUnion({ Step: { fields: {} } })
const keyed = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
const definition = keyed.define(
  {
    id: "prototype-overlapping-regions",
    initial: () => ({
      _tag: "Active",
      ["__proto__"]: { _tag: "Idle" },
      constructor: { _tag: "Idle" },
      prototype: { _tag: "Idle" },
    }),
  },
  {
    Active: keyed.regions({
      ["__proto__"]: {
        Idle: { Step: { target: "Changed", reduce: () => ({}) } },
        Changed: {},
      },
      constructor: {
        Idle: { Step: { target: "Changed", reduce: () => ({}) } },
        Changed: {},
      },
      prototype: {
        Idle: { Step: { target: "Changed", reduce: () => ({}) } },
        Changed: {},
      },
    }),
  },
)

const assertOwnSlots = (
  value: Machine.MachineState<typeof definition>,
  tag: "Idle" | "Changed",
) => {
  assert.strictEqual(Object.getPrototypeOf(value), Object.prototype)
  for (const slot of ["__proto__", "constructor", "prototype"] as const) {
    assert.strictEqual(Object.hasOwn(value, slot), true)
    assert.deepStrictEqual(value[slot], { _tag: tag })
  }
}

describe("prototype-overlapping runtime keys", () => {
  it.effect("commits every ordinary region slot independently in one macrostep", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(definition, {})
      assertOwnSlots(yield* handle.snapshot, "Idle")
      yield* handle.send({ _tag: "Step" })
      assertOwnSlots(yield* handle.snapshot, "Changed")
    }),
  )

  it.effect("persists and resumes exact durable region-entry keys", () =>
    Effect.gen(function* () {
      const store = yield* Durable.makeMemoryStore()
      const instance = Durable.instanceId("prototype-overlapping-regions")
      const options = {
        instanceId: instance,
        persistenceVersion: Durable.persistenceVersion("1"),
      }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Durable.run(definition, {}, options).pipe(
            Effect.provideService(Durable.Store, store),
          )
          yield* handle.send({ _tag: "Step" }, { idempotencyKey: "step" })
          assertOwnSlots(yield* handle.snapshot, "Changed")
        }),
      )

      const stored = yield* store.load(instance)
      assert.strictEqual(stored._tag, "Some")
      if (stored._tag !== "Some") return
      assert.strictEqual(Object.getPrototypeOf(stored.value.regionEntryIds), Object.prototype)
      assert.deepStrictEqual(Object.keys(stored.value.regionEntryIds), [
        "__proto__",
        "constructor",
        "prototype",
      ])

      yield* Effect.scoped(
        Effect.gen(function* () {
          const resumed = yield* Durable.run(definition, {}, options).pipe(
            Effect.provideService(Durable.Store, store),
          )
          assertOwnSlots(yield* resumed.snapshot, "Changed")
        }),
      )
    }),
  )
})
