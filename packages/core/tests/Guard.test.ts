import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import { runMachine } from "./runMachine.js"

const Input = Schema.Void
const Ready = Schema.TaggedStruct("Ready", {})
const Positive = Schema.TaggedStruct("Positive", { value: Schema.Number })
const Even = Schema.TaggedStruct("Even", { value: Schema.Number })
const Other = Schema.TaggedStruct("Other", { value: Schema.Number })
const State = Schema.Union([Ready, Positive, Even, Other]).pipe(Schema.toTaggedUnion("_tag"))
const Decide = Schema.TaggedStruct("Decide", { value: Schema.Number }).annotate({
  description: "Classify a number.",
})
const Ping = Schema.TaggedStruct("Ping", {}).annotate({
  description: "An intentionally irrelevant heartbeat.",
})
const Event = Schema.Union([Decide, Ping]).pipe(Schema.toTaggedUnion("_tag"))

const classifier = Machine.builder({ input: Input, state: State, event: Event })
const definition = classifier.define(
  {
    id: "classifier",
    initial: () => ({ _tag: "Ready" }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Ready: classifier.state({
      Decide: {
        branches: [
          {
            when: {
              name: "is-positive",
              description: "Positive values take precedence over even values.",
              guard: ({ event }) => event.value > 0,
            },
            target: "Positive",
            reduce: ({ event }) => ({ _tag: "Positive", value: event.value }),
          },
          {
            when: {
              name: "is-even",
              guard: ({ event }) => event.value % 2 === 0,
            },
            target: "Even",
            reduce: ({ event }) => ({ _tag: "Even", value: event.value }),
          },
          {
            otherwise: true,
            target: "Other",
            description: "Classify every remaining value.",
            reduce: ({ event }) => ({ _tag: "Other", value: event.value }),
          },
        ],
      },
      Ping: {
        ignore: {
          description: "Heartbeats do not affect classification.",
        },
      },
    }),
    Positive: classifier.final(),
    Even: classifier.final(),
    Other: classifier.final(),
  },
)

const withoutFallback = classifier.define(
  {
    id: "classifier-without-fallback",
    initial: () => ({ _tag: "Ready" }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Ready: classifier.state({
      Decide: {
        branches: [
          {
            when: {
              name: "is-positive",
              guard: ({ event }) => event.value > 0,
            },
            target: "Positive",
            reduce: ({ event }) => ({ _tag: "Positive", value: event.value }),
          },
        ],
      },
    }),
    Positive: classifier.final(),
    Even: classifier.final(),
    Other: classifier.final(),
  },
)

describe("guarded transitions", () => {
  it.effect("selects the first matching named guard and inspects that branch", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(definition, undefined)
      const inspectionFiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.inspection, 4)),
      )
      yield* Effect.yieldNow

      yield* handle.send({ _tag: "Decide", value: 4 })

      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Positive", value: 4 })
      const inspection = yield* Fiber.join(inspectionFiber)
      assert.deepStrictEqual(inspection[2], {
        _tag: "TransitionSelected",
        machineId: "classifier",
        sourceStateTag: "Ready",
        targetStateTag: "Positive",
        eventTag: "Decide",
        branch: {
          kind: "guard",
          index: 0,
          name: "is-positive",
        },
      })
    }),
  )

  it.effect("uses later guards and the final fallback when earlier guards do not match", () =>
    Effect.gen(function* () {
      const even = yield* runMachine(definition, undefined)
      yield* even.send({ _tag: "Decide", value: -2 })
      assert.deepStrictEqual(yield* even.snapshot, { _tag: "Even", value: -2 })

      const other = yield* runMachine(definition, undefined)
      yield* other.send({ _tag: "Decide", value: -3 })
      assert.deepStrictEqual(yield* other.snapshot, { _tag: "Other", value: -3 })
    }),
  )

  it.effect("defects when no guard matches and no fallback exists", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(withoutFallback, undefined)
      const error = yield* Effect.flip(handle.send({ _tag: "Decide", value: -1 }))
      assert.strictEqual(error._tag, "MachineInstanceDefect")
      if (error._tag !== "MachineInstanceDefect") return
      assert.strictEqual(String(error.instanceId), String(handle.instanceId))
      assert.deepStrictEqual(error.defect, {
        category: "protocol",
        name: "Error",
        message: "machine classifier-without-fallback does not accept Decide in Ready",
      })
    }),
  )

  it.effect("makes an explicitly ignored event an observable no-op", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(definition, undefined)
      const inspectionFiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(handle.inspection, 3)),
      )
      yield* Effect.yieldNow

      assert.strictEqual(yield* handle.can({ _tag: "Ping" }), true)
      yield* handle.send({ _tag: "Ping" })

      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Ready" })
      assert.deepStrictEqual((yield* Fiber.join(inspectionFiber))[2], {
        _tag: "EventIgnored",
        machineId: "classifier",
        stateTag: "Ready",
        eventTag: "Ping",
      })
    }),
  )

  it("preserves branch order, guard metadata, fallbacks, and ignores in the graph", () => {
    const graph = Graph.fromDefinition(definition)

    assert.deepStrictEqual(
      graph.edges.map(({ location: _, ...edge }) => edge),
      [
        {
          id: "Ready:Decide:0:Positive:0",
          source: "Ready",
          target: "Positive",
          event: { tag: "Decide", description: "Classify a number." },
          branch: {
            kind: "guard",
            index: 0,
            name: "is-positive",
            description: "Positive values take precedence over even values.",
          },
        },
        {
          id: "Ready:Decide:1:Even:1",
          source: "Ready",
          target: "Even",
          event: { tag: "Decide", description: "Classify a number." },
          branch: { kind: "guard", index: 1, name: "is-even" },
        },
        {
          id: "Ready:Decide:2:Other:2",
          source: "Ready",
          target: "Other",
          event: { tag: "Decide", description: "Classify a number." },
          description: "Classify every remaining value.",
          branch: { kind: "otherwise", index: 2 },
        },
      ],
    )
    assert.deepStrictEqual(graph.ignores, [
      {
        source: "Ready",
        event: {
          tag: "Ping",
          description: "An intentionally irrelevant heartbeat.",
        },
        description: "Heartbeats do not affect classification.",
      },
    ])
  })
})
