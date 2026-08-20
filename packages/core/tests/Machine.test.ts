import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Machine from "../src/Machine.js"
import { runMachine } from "./runMachine.js"

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

const CounterState = Schema.Union([Active, Paused])

const Increment = Schema.TaggedStruct("Increment", {
  amount: Schema.Number,
}).annotate({ description: "Increase the counter." })

const Pause = Schema.TaggedStruct("Pause", {}).annotate({
  description: "Stop accepting updates.",
})

const Resume = Schema.TaggedStruct("Resume", {}).annotate({
  description: "Accept updates again.",
})

const CounterEvent = Schema.Union([Increment, Pause, Resume])

const counter = Machine.builder({
  input: CounterInput,
  state: CounterState,
  event: CounterEvent,
})

const counterDefinition = counter.define(
  {
    id: "counter",
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
    description: "A minimal serialized counter protocol.",
    initial: (input) => ({ _tag: "Active", count: input.count }),
  },
  {
    Active: counter.state({
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
    }),
    Paused: counter.state({
      Resume: {
        target: "Active",
        reduce: ({ state }) => ({ _tag: "Active", count: state.count }),
      },
    }),
  },
)

describe("Machine", () => {
  it.effect("runs a Schema-first machine through an Effect-only handle", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(counterDefinition, { count: 1 })
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

  it.effect("runs in data-last style", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(counterDefinition, { count: 2 })

      yield* handle.send({ _tag: "Increment", amount: 3 })
      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 5 })
    }),
  )

  it.effect("replays one ordered actor-tree journal for a root-only machine", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(counterDefinition, { count: 1 })

      yield* handle.send({ _tag: "Increment", amount: 2 })
      const records = yield* Stream.runCollect(Stream.take(handle.tree.records, 7))

      assert.strictEqual(handle.actorId, handle.tree.rootActorId)
      assert.strictEqual(handle.definitionPath, "root")
      assert.deepStrictEqual(
        records.map(({ sequence }) => sequence),
        [0, 1, 2, 3, 4, 5, 6],
      )
      assert.deepStrictEqual(
        records.map(({ actorId }) => actorId),
        Array.from({ length: 7 }, () => handle.actorId),
      )
      assert.deepStrictEqual(
        records.map(({ body }) => body._tag),
        [
          "ActorStarted",
          "Inspection",
          "StateSnapshot",
          "Inspection",
          "Inspection",
          "Inspection",
          "StateSnapshot",
        ],
      )
      const finalRecord = records[6]
      assert.strictEqual(finalRecord?.body._tag, "StateSnapshot")
      if (finalRecord?.body._tag === "StateSnapshot") {
        assert.deepStrictEqual(finalRecord.body.state, { _tag: "Active", count: 3 })
      }
    }),
  )

  it.effect("terminates on a known event rejected by the live state", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(counterDefinition, { count: 1 })
      const error = yield* Effect.flip(handle.send({ _tag: "Resume" }))
      assert.strictEqual(error._tag, "MachineInstanceDefect")
      if (error._tag !== "MachineInstanceDefect") return
      assert.strictEqual(String(error.instanceId), String(handle.instanceId))
      assert.deepStrictEqual(error.defect, {
        category: "protocol",
        name: "Error",
        message: "machine counter does not accept Resume in Active",
      })

      const afterTermination = yield* Effect.flip(handle.send({ _tag: "Increment", amount: 1 }))
      assert.strictEqual(afterTermination._tag, "CompletedInstance")
      if (afterTermination._tag !== "CompletedInstance") return
      assert.strictEqual(String(afterTermination.instanceId), String(handle.instanceId))
    }),
  )

  it.effect("rejects an initial state that has no node before returning a handle", () => {
    const invalidDefinition = counter.define(
      {
        id: "invalid-initial",
        idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        initial: () =>
          ({ _tag: "Missing", count: 0 }) as unknown as { _tag: "Active"; count: number },
      },
      {
        Active: counter.state({}),
        Paused: counter.state({}),
      },
    )

    return Effect.gen(function* () {
      const error = yield* Effect.flip(runMachine(invalidDefinition, { count: 0 }))
      assert.strictEqual(error._tag, "MachineEncodingError")
      if (error._tag !== "MachineEncodingError") return
      assert.strictEqual(error.operation, "initialize")
      assert.strictEqual(
        error.message,
        "machine invalid-initial initialized to missing state Missing",
      )
    })
  })

  it("rejects transition targets without a corresponding node", () => {
    assert.throws(
      () =>
        counter.define(
          {
            id: "missing-target",
            idempotencyKey: (input) => JSON.stringify(input) ?? "default",
            initial: (input) => ({ _tag: "Active", count: input.count }),
          },
          {
            Active: counter.state({
              Pause: {
                target: "Missing" as "Paused",
                reduce: ({ state }) => ({ _tag: "Paused", count: state.count }),
              },
            }),
            Paused: counter.state({}),
          },
        ),
      Machine.MachineDefinitionDefect,
    )
  })

  it.effect("inspects semantic decisions without application payloads", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(counterDefinition, { count: 41 })
      const inspectionFiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.inspection, 4)),
      )
      const projectedFiber = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            handle.inspect((event) => event),
            4,
          ),
        ),
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
      assert.deepStrictEqual(yield* Fiber.join(projectedFiber), [
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
          details: { _tag: "Increment", amount: 1 },
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
