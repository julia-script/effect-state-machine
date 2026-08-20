import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { TestClock } from "effect/testing"
import * as Machine from "../src/Machine.js"
import * as Runtime from "./MachineRuntimeTestKit.js"

const State = Machine.taggedUnion({
  Working: { fields: {} },
  Done: { fields: { result: Schema.String } },
})
const Event = Machine.taggedUnion({ Noop: { fields: {} } })

const runWith = (
  id: string,
  effect: Effect.Effect<string, string>,
  store: Runtime.StoreService,
) => {
  const machine = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
  const definition = machine.define(
    {
      id,
      idempotencyKey: () => id,
      initial: () => ({ _tag: "Working" }),
    },
    {
      Working: machine.invoke({
        name: "work",
        success: Schema.String,
        error: Schema.String,
        effect: () => effect,
        onSuccess: { target: "Done", reduce: ({ value }) => ({ result: value }) },
        onFailure: { target: "Done", reduce: ({ error }) => ({ result: `failed:${error}` }) },
      }),
      Done: machine.final(),
    },
  )
  return Runtime.run(
    definition,
    {},
    {
      instanceId: Runtime.instanceId(id),
      persistenceVersion: Runtime.persistenceVersion("1"),
      activityLeaseMillis: 100,
      pollIntervalMillis: 25,
    },
  ).pipe(Effect.provideService(Runtime.Store, store))
}

describe("Runtime activity Cause classification", () => {
  it.effect("routes a pure typed failure through the authored failure transition", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const completed = yield* Effect.scoped(
        Effect.flatMap(
          runWith("pure-fail", Effect.fail("allowed"), store),
          (handle) => handle.completion,
        ),
      )
      assert.deepStrictEqual(completed, { _tag: "Done", result: "failed:allowed" })
    }),
  )

  it.effect("classifies a compound Fail and Die Cause as a durable defect", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const boom = new Error("parallel defect")
      const cause = Cause.combine(Cause.fail("allowed"), Cause.die(boom))
      const error = yield* Effect.scoped(
        Effect.flatMap(runWith("fail-and-die", Effect.failCause(cause), store), (handle) =>
          Effect.flip(handle.completion),
        ),
      )
      assert.strictEqual(error._tag, "MachineInstanceDefect")
      if (error._tag !== "MachineInstanceDefect") return
      assert.strictEqual(error.defect.category, "activity")
      assert.strictEqual(error.cause === undefined ? undefined : Cause.hasDies(error.cause), true)
    }),
  )

  it.effect("leaves a compound Fail and Interrupt Cause eligible for redelivery", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const executions = yield* Ref.make<ReadonlyArray<string>>([])
      const operation = Effect.flatMap(
        Ref.updateAndGet(executions, (keys) => [...keys, "started"]),
        () => Effect.failCause(Cause.combine(Cause.fail("allowed"), Cause.interrupt(1))),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* runWith("fail-and-interrupt", operation, store)
          while ((yield* Ref.get(executions)).length === 0) yield* Effect.yieldNow
        }),
      )
      const before = Option.getOrThrow(yield* store.load(Runtime.instanceId("fail-and-interrupt")))
      assert.strictEqual(before.status, "running")
      yield* TestClock.adjust("101 millis")
      const redelivered = Option.getOrThrow(
        yield* store.claimActivity(Runtime.instanceId("fail-and-interrupt"), "replacement", 100),
      )
      assert.strictEqual(redelivered.claim.attempt, 2)
      assert.strictEqual(redelivered.command.executionId.includes("fail-and-interrupt"), true)
    }),
  )
})
