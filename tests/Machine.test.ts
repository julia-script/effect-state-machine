import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Machine from "../src/Machine.js"

const CounterInput = Schema.Struct({ count: Schema.Number })

const Active = Schema.TaggedStruct("Active", {
  count: Schema.Number,
}).annotate({
  title: "Active",
  description: "Accepts counter updates.",
})

const Paused = Schema.TaggedStruct("Paused", {
  count: Schema.Number,
}).annotate({
  title: "Paused",
  description: "Keeps the counter stable until resumed.",
})

const CounterState = Schema.Union([Active, Paused]).pipe(Schema.toTaggedUnion("_tag"))

const Increment = Schema.TaggedStruct("Increment", {
  amount: Schema.Number,
}).annotate({ description: "Increase the counter." })

const Pause = Schema.TaggedStruct("Pause", {}).annotate({
  description: "Stop accepting updates.",
})

const Resume = Schema.TaggedStruct("Resume", {}).annotate({
  description: "Accept updates again.",
})

const CounterEvent = Schema.Union([Increment, Pause, Resume]).pipe(Schema.toTaggedUnion("_tag"))

const counter = Machine.builder({
  input: CounterInput,
  state: CounterState,
  event: CounterEvent,
})

const counterDefinition = counter.make({
  id: "counter",
  description: "A minimal serialized counter protocol.",
  initial: (input) => ({ _tag: "Active", count: input.count }),
  nodes: [
    counter.state("Active", {
      on: {
        Increment: {
          target: "Active",
          description: "Apply the requested increment.",
          reduce: ({ state, event }) => ({
            _tag: "Active",
            count: state.count + event.amount,
          }),
        },
        Pause: {
          target: "Paused",
          reduce: ({ state }) => ({ _tag: "Paused", count: state.count }),
        },
      },
    }),
    counter.state("Paused", {
      on: {
        Resume: {
          target: "Active",
          reduce: ({ state }) => ({ _tag: "Active", count: state.count }),
        },
      },
    }),
  ],
})

describe("Machine", () => {
  it.effect("runs a Schema-first machine through an Effect-only handle", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(counterDefinition, { count: 1 })
      const changesFiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.changes, 3)),
      )
      yield* Effect.yieldNow

      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 1 })
      assert.strictEqual(yield* handle.can({ _tag: "Increment", amount: 2 }), true)
      assert.strictEqual(yield* handle.can({ _tag: "Resume" }), false)

      yield* handle.send({ _tag: "Increment", amount: 2 })
      yield* handle.send({ _tag: "Increment", amount: 4 })

      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 7 })
      assert.deepStrictEqual(yield* Fiber.join(changesFiber), [
        { _tag: "Active", count: 1 },
        { _tag: "Active", count: 3 },
        { _tag: "Active", count: 7 },
      ])
    }),
  )

  it.effect("terminates on a known event rejected by the live state", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(counterDefinition, { count: 1 })
      const exit = yield* Effect.exit(handle.send({ _tag: "Resume" }))

      assert.strictEqual(Exit.isFailure(exit), true)
      if (Exit.isFailure(exit)) {
        assert.strictEqual(Cause.hasDies(exit.cause), true)
        assert.strictEqual(Cause.squash(exit.cause) instanceof Machine.ProtocolDefect, true)
      }

      const afterTermination = yield* Effect.exit(handle.send({ _tag: "Increment", amount: 1 }))
      assert.strictEqual(Exit.isFailure(afterTermination), true)
    }),
  )

  it.effect("rejects an initial state that has no node before returning a handle", () => {
    const invalidDefinition = counter.make({
      id: "invalid-initial",
      initial: () =>
        ({ _tag: "Missing", count: 0 }) as unknown as { _tag: "Active"; count: number },
      nodes: [counter.state("Active", { on: {} })],
    })

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Machine.run(invalidDefinition, { count: 0 }))

      assert.strictEqual(Exit.isFailure(exit), true)
      if (Exit.isFailure(exit)) {
        assert.strictEqual(
          Cause.squash(exit.cause) instanceof Machine.MachineDefinitionDefect,
          true,
        )
      }
    })
  })

  it("rejects duplicate state tags when the definition is constructed", () => {
    assert.throws(
      () =>
        counter.make({
          id: "duplicate-states",
          initial: (input) => ({ _tag: "Active", count: input.count }),
          nodes: [counter.state("Active", { on: {} }), counter.state("Active", { on: {} })],
        }),
      Machine.MachineDefinitionDefect,
    )
  })

  it("rejects transition targets without a corresponding node", () => {
    assert.throws(
      () =>
        counter.make({
          id: "missing-target",
          initial: (input) => ({ _tag: "Active", count: input.count }),
          nodes: [
            counter.state("Active", {
              on: {
                Pause: {
                  target: "Missing" as "Paused",
                  reduce: ({ state }) => ({ _tag: "Paused", count: state.count }),
                },
              },
            }),
          ],
        }),
      Machine.MachineDefinitionDefect,
    )
  })

  it.effect("inspects semantic decisions without application payloads", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(counterDefinition, { count: 41 })
      const inspectionFiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.inspection, 4)),
      )
      yield* Effect.yieldNow

      yield* handle.send({ _tag: "Increment", amount: 1 })

      assert.deepStrictEqual(yield* Fiber.join(inspectionFiber), [
        {
          _tag: "MachineStarted",
          machineId: "counter",
          initialStateTag: "Active",
        },
        {
          _tag: "EventReceived",
          machineId: "counter",
          stateTag: "Active",
          eventTag: "Increment",
        },
        {
          _tag: "TransitionSelected",
          machineId: "counter",
          sourceStateTag: "Active",
          targetStateTag: "Active",
          eventTag: "Increment",
        },
        {
          _tag: "StateChanged",
          machineId: "counter",
          previousStateTag: "Active",
          nextStateTag: "Active",
        },
      ])
    }),
  )

  it.effect("leaves unknown external events at the Schema boundary", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Schema.decodeUnknownEffect(counterDefinition.schemas.event)({ _tag: "Unknown" }),
      )

      assert.strictEqual(Exit.isFailure(exit), true)
    }),
  )
})
