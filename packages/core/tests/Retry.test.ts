import { assert, describe, it } from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"

class TransientFailure extends Data.TaggedError("TransientFailure")<{
  readonly attempt: number
}> {}

const Input = Schema.Void
const Attempting = Schema.TaggedStruct("Attempting", {})
const Succeeded = Schema.TaggedStruct("Succeeded", { attempts: Schema.Number })
const Failed = Schema.TaggedStruct("Failed", { attempts: Schema.Number })
const Cancelled = Schema.TaggedStruct("Cancelled", {})
const State = Schema.Union([Attempting, Succeeded, Failed, Cancelled]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Cancel = Schema.TaggedStruct("Cancel", {})
const Event = Schema.Union([Cancel]).pipe(Schema.toTaggedUnion("_tag"))

const ModeledAttempting = Schema.TaggedStruct("ModeledAttempting", { attempt: Schema.Number })
const ModeledWaiting = Schema.TaggedStruct("ModeledWaiting", { attempt: Schema.Number })
const ModeledSucceeded = Schema.TaggedStruct("ModeledSucceeded", { attempt: Schema.Number })
const ModeledState = Schema.Union([ModeledAttempting, ModeledWaiting, ModeledSucceeded]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Retry = Schema.TaggedStruct("Retry", {})
const ModeledEvent = Schema.Union([Retry]).pipe(Schema.toTaggedUnion("_tag"))

const makeOperationalDefinition = (options: {
  readonly id: string
  readonly attempts: Ref.Ref<number>
  readonly succeedAt: number
  readonly schedule: Schedule.Schedule<number, TransientFailure>
}) => {
  const machine = Machine.builder({ input: Input, state: State, event: Event })
  return machine.make({
    id: options.id,
    initial: () => ({ _tag: "Attempting" }),
    nodes: [
      machine.invoke("Attempting", {
        name: "unstable-operation",
        effect: () =>
          Ref.updateAndGet(options.attempts, (attempt) => attempt + 1).pipe(
            Effect.flatMap((attempt) =>
              attempt < options.succeedAt
                ? Effect.fail(new TransientFailure({ attempt }))
                : Effect.succeed(attempt),
            ),
          ),
        retry: {
          name: "retry-transient-failures",
          description: "Retry transient failures without leaving Attempting.",
          schedule: options.schedule,
        },
        onSuccess: {
          target: "Succeeded",
          reduce: ({ value }) => ({ _tag: "Succeeded", attempts: value }),
        },
        onFailure: {
          target: "Failed",
          reduce: ({ error }) => ({
            _tag: "Failed",
            attempts: error instanceof TransientFailure ? error.attempt : -1,
          }),
        },
        on: {
          Cancel: {
            target: "Cancelled",
            reduce: () => ({ _tag: "Cancelled" }),
          },
        },
      }),
      machine.final("Succeeded"),
      machine.final("Failed"),
      machine.final("Cancelled"),
    ],
  })
}

describe("invocation retry", () => {
  it.effect("retries typed failures in the invoked state and reports each decision", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const definition = makeOperationalDefinition({
        id: "retry-success",
        attempts,
        succeedAt: 3,
        schedule: Schedule.recurs(2),
      })

      const handle = yield* Machine.run(definition, undefined)
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Succeeded", attempts: 3 })

      const retryEvents = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter((event) => event._tag === "InvocationRetryScheduled"),
          Stream.take(2),
        ),
      )
      assert.deepStrictEqual(
        retryEvents.map(({ attempt, delayMillis }) => ({ attempt, delayMillis })),
        [
          { attempt: 1, delayMillis: 0 },
          { attempt: 2, delayMillis: 0 },
        ],
      )
    }),
  )

  it.effect("routes the last typed failure after the Schedule is exhausted", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const definition = makeOperationalDefinition({
        id: "retry-exhaustion",
        attempts,
        succeedAt: 99,
        schedule: Schedule.recurs(2),
      })

      const handle = yield* Machine.run(definition, undefined)
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Failed", attempts: 3 })
      assert.strictEqual(yield* Ref.get(attempts), 3)
    }),
  )

  it.effect("uses TestClock for delays and cancels a pending retry on state exit", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const definition = makeOperationalDefinition({
        id: "retry-cancel",
        attempts,
        succeedAt: 2,
        schedule: Schedule.recurs(1).pipe(Schedule.addDelay(() => Effect.succeed("1 hour"))),
      })
      const handle = yield* Machine.run(definition, undefined)

      const scheduled = yield* Stream.runHead(
        handle.inspection.pipe(Stream.filter((event) => event._tag === "InvocationRetryScheduled")),
      )
      assert.strictEqual(scheduled._tag, "Some")
      if (scheduled._tag === "Some") {
        assert.strictEqual(scheduled.value.delayMillis, 3_600_000)
      }

      yield* handle.send({ _tag: "Cancel" })
      yield* TestClock.adjust("2 hours")

      assert.deepStrictEqual(yield* handle.completion, { _tag: "Cancelled" })
      assert.strictEqual(yield* Ref.get(attempts), 1)
    }),
  )

  it.effect("exposes only authored retry metadata in the static graph", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const definition = makeOperationalDefinition({
        id: "retry-graph",
        attempts,
        succeedAt: 1,
        schedule: Schedule.recurs(7),
      })

      const graph = Graph.fromDefinition(definition)
      assert.deepStrictEqual(graph.nodes[0]?.invocation?.retry, {
        name: "retry-transient-failures",
        description: "Retry transient failures without leaving Attempting.",
      })
      assert.strictEqual("schedule" in (graph.nodes[0]?.invocation?.retry ?? {}), false)
    }),
  )

  it.effect("models attempts as ordinary state when they affect application behavior", () =>
    Effect.gen(function* () {
      const machine = Machine.builder({
        input: Input,
        state: ModeledState,
        event: ModeledEvent,
      })
      const definition = machine.make({
        id: "modeled-retry",
        initial: () => ({ _tag: "ModeledAttempting", attempt: 1 }),
        nodes: [
          machine.invoke("ModeledAttempting", {
            name: "save-attempt",
            effect: (state) =>
              state.attempt < 2
                ? Effect.fail(new TransientFailure({ attempt: state.attempt }))
                : Effect.succeed(state.attempt),
            onSuccess: {
              target: "ModeledSucceeded",
              reduce: ({ value }) => ({ _tag: "ModeledSucceeded", attempt: value }),
            },
            onFailure: {
              target: "ModeledWaiting",
              reduce: ({ error }) => ({ _tag: "ModeledWaiting", attempt: error.attempt }),
            },
          }),
          machine.state("ModeledWaiting", {
            on: {
              Retry: {
                target: "ModeledAttempting",
                reduce: ({ state }) => ({
                  _tag: "ModeledAttempting",
                  attempt: state.attempt + 1,
                }),
              },
            },
          }),
          machine.final("ModeledSucceeded"),
        ],
      })

      const handle = yield* Machine.run(definition, undefined)
      const waiting = yield* Stream.runHead(
        handle.changes.pipe(Stream.filter((state) => state._tag === "ModeledWaiting")),
      )
      assert.strictEqual(waiting._tag, "Some")
      if (waiting._tag === "Some") {
        assert.deepStrictEqual(waiting.value, { _tag: "ModeledWaiting", attempt: 1 })
      }
      assert.strictEqual(yield* handle.can({ _tag: "Retry" }), true)

      yield* handle.send({ _tag: "Retry" })
      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "ModeledSucceeded",
        attempt: 2,
      })
    }),
  )
})
