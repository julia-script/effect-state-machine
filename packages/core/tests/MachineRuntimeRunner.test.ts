import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { TestClock } from "effect/testing"
import * as Machine from "../src/Machine.js"
import * as Runtime from "./MachineRuntimeTestKit.js"

const TimerInput = Schema.Struct({ count: Schema.Number })
const Waiting = Schema.TaggedStruct("Waiting", { count: Schema.Number })
const TimedOut = Schema.TaggedStruct("TimedOut", { count: Schema.Number })
const TimerState = Schema.Union([Waiting, TimedOut]).pipe(Schema.toTaggedUnion("_tag"))
const Touch = Schema.TaggedStruct("Touch", {})
const Restart = Schema.TaggedStruct("Restart", {})
const TimerEvent = Schema.Union([Touch, Restart]).pipe(Schema.toTaggedUnion("_tag"))
const timerMachine = Machine.builder({ input: TimerInput, state: TimerState, event: TimerEvent })
const makeTimerDefinition = (initialized: Array<number>, computed: Array<number> = []) =>
  timerMachine.define(
    {
      id: "durable-timer",
      idempotencyKey: (input) => JSON.stringify(input) ?? "default",
      initial: (input) => {
        initialized.push(input.count)
        return { _tag: "Waiting", count: input.count }
      },
    },
    {
      Waiting: timerMachine.state(
        {
          Touch: {
            stay: ({ state }) => ({ count: state.count + 1 }),
          },
          Restart: {
            target: "Waiting",
            reduce: ({ state }) => ({ count: state.count + 1 }),
          },
        },
        {
          after: {
            duration: {
              name: "waiting-deadline",
              compute: (state) => {
                computed.push(state.count)
                return "60 seconds"
              },
            },
            target: "TimedOut",
            reduce: ({ state }) => ({ count: state.count }),
          },
        },
      ),
      TimedOut: timerMachine.final(),
    },
  )

describe("Runtime runner", () => {
  it.effect(
    "resumes a timer at its persisted absolute deadline without rerunning initialization",
    () =>
      Effect.gen(function* () {
        const store = yield* Runtime.makeMemoryStore()
        const initialized: Array<number> = []
        const computed: Array<number> = []
        const definition = makeTimerDefinition(initialized, computed)
        const options: Runtime.RunOptions = {
          instanceId: Runtime.instanceId("timer-1"),
          persistenceVersion: Runtime.persistenceVersion("1"),
          pollIntervalMillis: 1_000,
        }

        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* Runtime.run(definition, { count: 1 }, options).pipe(
              Effect.provideService(Runtime.Store, store),
            )
            yield* TestClock.adjust("30 seconds")
            yield* first.send({ _tag: "Touch" }, { idempotencyKey: "touch-1" })
            assert.deepStrictEqual(yield* first.snapshot, { _tag: "Waiting", count: 2 })
          }),
        )

        yield* Effect.scoped(
          Effect.gen(function* () {
            const resumed = yield* Runtime.run(definition, { count: 999 }, options).pipe(
              Effect.provideService(Runtime.Store, store),
            )
            assert.deepStrictEqual(yield* resumed.snapshot, { _tag: "Waiting", count: 2 })
            yield* TestClock.adjust("29 seconds")
            assert.deepStrictEqual(yield* resumed.snapshot, { _tag: "Waiting", count: 2 })

            const completion = yield* Effect.forkChild(resumed.completion)
            yield* TestClock.adjust("1 second")
            assert.deepStrictEqual(yield* Fiber.join(completion), {
              _tag: "TimedOut",
              count: 2,
            })
          }),
        )

        assert.deepStrictEqual(initialized, [1])
        assert.deepStrictEqual(computed, [1])
      }),
  )

  it.effect("migrates the persisted document while preserving the original timer deadline", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const initialized: Array<number> = []
      const definition = makeTimerDefinition(initialized)
      const instance = Runtime.instanceId("migrated-timer")

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Runtime.run(
            definition,
            { count: 3 },
            {
              instanceId: instance,
              persistenceVersion: Runtime.persistenceVersion("1"),
              pollIntervalMillis: 1_000,
            },
          ).pipe(Effect.provideService(Runtime.Store, store))
          yield* TestClock.adjust("30 seconds")
        }),
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const resumed = yield* Runtime.run(
            definition,
            { count: 999 },
            {
              instanceId: instance,
              persistenceVersion: Runtime.persistenceVersion("2"),
              migrations: [
                {
                  from: Runtime.persistenceVersion("1"),
                  to: Runtime.persistenceVersion("2"),
                  migrate: Effect.succeed,
                },
              ],
              pollIntervalMillis: 1_000,
            },
          ).pipe(Effect.provideService(Runtime.Store, store))
          yield* TestClock.adjust("30 seconds")
          assert.deepStrictEqual(yield* resumed.completion, { _tag: "TimedOut", count: 3 })
        }),
      )

      assert.deepStrictEqual(initialized, [3])
    }),
  )

  it.effect("processes an overdue timer on resume and resets a self-reentry deadline", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const computed: Array<number> = []
      const definition = makeTimerDefinition([], computed)
      const instance = Runtime.instanceId("timer-reentry")
      const options: Runtime.RunOptions = {
        instanceId: instance,
        persistenceVersion: Runtime.persistenceVersion("1"),
        pollIntervalMillis: 1_000,
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Runtime.run(definition, { count: 0 }, options).pipe(
            Effect.provideService(Runtime.Store, store),
          )
          yield* TestClock.adjust("30 seconds")
          yield* handle.send({ _tag: "Restart" }, { idempotencyKey: "restart" })
        }),
      )
      yield* TestClock.adjust("61 seconds")

      yield* Effect.scoped(
        Effect.gen(function* () {
          const resumed = yield* Runtime.run(definition, { count: 999 }, options).pipe(
            Effect.provideService(Runtime.Store, store),
          )
          yield* TestClock.adjust("1 second")
          assert.deepStrictEqual(yield* resumed.completion, { _tag: "TimedOut", count: 1 })
        }),
      )
      assert.deepStrictEqual(computed, [0, 1])
    }),
  )

  it.effect("rejects a version mismatch without a migration path", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const definition = makeTimerDefinition([])
      const instance = Runtime.instanceId("missing-migration")
      yield* Effect.scoped(
        Runtime.run(
          definition,
          { count: 1 },
          {
            instanceId: instance,
            persistenceVersion: Runtime.persistenceVersion("1"),
          },
        ).pipe(Effect.provideService(Runtime.Store, store)),
      )

      const error = yield* Effect.flip(
        Effect.scoped(
          Runtime.run(
            definition,
            { count: 2 },
            {
              instanceId: instance,
              persistenceVersion: Runtime.persistenceVersion("2"),
            },
          ).pipe(Effect.provideService(Runtime.Store, store)),
        ),
      )
      assert.strictEqual(error._tag, "CompatibilityError")
      if (error._tag !== "CompatibilityError") return
      assert.deepStrictEqual(error.reason, {
        _tag: "MissingMigration",
        from: Runtime.persistenceVersion("1"),
        target: Runtime.persistenceVersion("2"),
      })
    }),
  )

  it.effect("rejects a migration whose state does not decode under the current Schema", () =>
    Effect.gen(function* () {
      const store = yield* Runtime.makeMemoryStore()
      const definition = makeTimerDefinition([])
      const instance = Runtime.instanceId("invalid-migration")
      yield* Effect.scoped(
        Runtime.run(
          definition,
          { count: 1 },
          {
            instanceId: instance,
            persistenceVersion: Runtime.persistenceVersion("1"),
          },
        ).pipe(Effect.provideService(Runtime.Store, store)),
      )

      const error = yield* Effect.flip(
        Effect.scoped(
          Runtime.run(
            definition,
            { count: 2 },
            {
              instanceId: instance,
              persistenceVersion: Runtime.persistenceVersion("2"),
              migrations: [
                {
                  from: Runtime.persistenceVersion("1"),
                  to: Runtime.persistenceVersion("2"),
                  migrate: (document) =>
                    Effect.succeed({
                      ...document,
                      checkpoint: { ...document.checkpoint, state: { _tag: "Missing" } },
                    }),
                },
              ],
            },
          ).pipe(Effect.provideService(Runtime.Store, store)),
        ),
      )
      assert.strictEqual(error._tag, "MigrationError")
    }),
  )

  it.effect("migrates renamed state and activity identities before workers resume", () =>
    Effect.gen(function* () {
      const Event = Schema.TaggedUnion({ Noop: {} })
      const V1State = Schema.TaggedUnion({
        OldWorking: { value: Schema.Number },
        Finished: { result: Schema.String },
      })
      const V2State = Schema.TaggedUnion({
        NewWorking: { value: Schema.Number, note: Schema.String },
        Finished: { result: Schema.String },
      })
      const v1Machine = Machine.builder({
        input: Schema.Struct({ value: Schema.Number }),
        state: V1State,
        event: Event,
      })
      const v2Machine = Machine.builder({
        input: Schema.Struct({ value: Schema.Number }),
        state: V2State,
        event: Event,
      })
      const oldStarted = yield* Ref.make(false)
      const v1 = v1Machine.define(
        {
          id: "renamed-definition",
          initial: ({ value }) => ({ _tag: "OldWorking", value }),
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        },
        {
          OldWorking: v1Machine.invoke({
            name: "old-work",
            success: Schema.String,
            error: Schema.Never,
            effect: () => Ref.set(oldStarted, true).pipe(Effect.andThen(Effect.never)),
            onSuccess: { target: "Finished", reduce: ({ value }) => ({ result: value }) },
            onFailure: { target: "Finished", reduce: () => ({ result: "impossible" }) },
          }),
          Finished: v1Machine.final(),
        },
      )
      const v2 = v2Machine.define(
        {
          id: "renamed-definition",
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
          initial: ({ value }) => ({ _tag: "NewWorking", value, note: "new" }),
        },
        {
          NewWorking: v2Machine.invoke({
            name: "new-work",
            success: Schema.String,
            error: Schema.Never,
            effect: (state) => Effect.succeed(`${state.note}:${state.value}`),
            onSuccess: { target: "Finished", reduce: ({ value }) => ({ result: value }) },
            onFailure: { target: "Finished", reduce: () => ({ result: "impossible" }) },
          }),
          Finished: v2Machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()
      const instance = Runtime.instanceId("renamed-instance")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Runtime.run(
            v1,
            { value: 42 },
            {
              instanceId: instance,
              persistenceVersion: Runtime.persistenceVersion("1"),
            },
          ).pipe(Effect.provideService(Runtime.Store, store))
          while (!(yield* Ref.get(oldStarted))) yield* Effect.yieldNow
        }),
      )

      const completed = yield* Effect.scoped(
        Runtime.run(
          v2,
          { value: 0 },
          {
            instanceId: instance,
            persistenceVersion: Runtime.persistenceVersion("2"),
            migrations: [
              {
                from: Runtime.persistenceVersion("1"),
                to: Runtime.persistenceVersion("2"),
                migrate: (document) => {
                  const targetRevision = Runtime.revision(document.checkpoint.revision + 1)
                  const nextEntry = Runtime.deriveEntryId(instance, targetRevision, "NewWorking")
                  const nextKey = Runtime.deriveRuntimeExecutionId(
                    instance,
                    nextEntry,
                    "NewWorking",
                    "new-work",
                  )
                  return Effect.succeed({
                    ...document,
                    checkpoint: {
                      ...document.checkpoint,
                      state: { _tag: "NewWorking", value: 42, note: "migrated" },
                      rootEntryId: nextEntry,
                    },
                    activities: document.activities.map((command) => ({
                      ...command,
                      deliveryId: nextKey,
                      executionId: nextKey,
                      entryId: nextEntry,
                      ownerPath: "NewWorking",
                      invocation: "new-work",
                      state: { _tag: "NewWorking", value: 42, note: "migrated" },
                    })),
                  })
                },
              },
            ],
          },
        ).pipe(
          Effect.provideService(Runtime.Store, store),
          Effect.flatMap((handle) => handle.completion),
        ),
      )
      assert.deepStrictEqual(completed, { _tag: "Finished", result: "migrated:42" })
    }),
  )

  it.effect(
    "runs Schema-backed activities with a stable execution key and persists completion",
    () =>
      Effect.gen(function* () {
        const Input = Schema.Struct({ value: Schema.Number })
        const Working = Schema.TaggedStruct("Working", { value: Schema.Number })
        const Done = Schema.TaggedStruct("Done", { value: Schema.Number, key: Schema.String })
        const State = Schema.Union([Working, Done]).pipe(Schema.toTaggedUnion("_tag"))
        const Event = Schema.Union([Schema.TaggedStruct("Noop", {})]).pipe(
          Schema.toTaggedUnion("_tag"),
        )
        const activityMachine = Machine.builder({ input: Input, state: State, event: Event })
        const executions = yield* Ref.make<ReadonlyArray<string>>([])
        const definition = activityMachine.define(
          {
            id: "durable-activity",
            initial: (input) => ({ _tag: "Working", value: input.value }),
            idempotencyKey: (input) => JSON.stringify(input) ?? "default",
          },
          {
            Working: activityMachine.invoke({
              name: "double",
              success: Schema.Struct({ value: Schema.Number, key: Schema.String }),
              error: Schema.Never,
              effect: (state, metadata) =>
                Ref.update(executions, (keys) => [...keys, metadata?.id ?? "missing"]).pipe(
                  Effect.as({ value: state.value * 2, key: metadata?.id ?? "missing" }),
                ),
              onSuccess: {
                target: "Done",
                reduce: ({ value }) => ({ value: value.value, key: value.key }),
              },
              onFailure: {
                target: "Done",
                reduce: () => ({ value: -1, key: "impossible" }),
              },
            }),
            Done: activityMachine.final(),
          },
        )
        const options: Runtime.RunOptions = {
          instanceId: Runtime.instanceId("activity-1"),
          persistenceVersion: Runtime.persistenceVersion("1"),
        }
        const store = yield* Runtime.makeMemoryStore()

        const completed = yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* Runtime.run(definition, { value: 21 }, options).pipe(
              Effect.provideService(Runtime.Store, store),
            )
            return yield* handle.completion
          }),
        )
        assert.strictEqual(completed._tag, "Done")
        assert.strictEqual(completed.value, 42)
        assert.notStrictEqual(completed.key, "missing")

        const resumed = yield* Effect.scoped(
          Runtime.run(definition, { value: 0 }, options).pipe(
            Effect.provideService(Runtime.Store, store),
            Effect.flatMap((handle) => handle.completion),
          ),
        )
        assert.deepStrictEqual(resumed, completed)
        assert.deepStrictEqual(yield* Ref.get(executions), [completed.key])
      }),
  )

  it.effect("reruns an uncommitted activity after lease expiry with the same execution key", () =>
    Effect.gen(function* () {
      const Input = Schema.Struct({})
      const Working = Schema.TaggedStruct("Working", {})
      const Done = Schema.TaggedStruct("Done", { key: Schema.String })
      const State = Schema.Union([Working, Done]).pipe(Schema.toTaggedUnion("_tag"))
      const Event = Schema.Union([Schema.TaggedStruct("Noop", {})]).pipe(
        Schema.toTaggedUnion("_tag"),
      )
      const machine = Machine.builder({ input: Input, state: State, event: Event })
      const executions = yield* Ref.make<ReadonlyArray<Readonly<{ id: string; attempt: number }>>>(
        [],
      )
      const definition = machine.define(
        {
          id: "durable-redelivery",
          initial: () => ({ _tag: "Working" }),
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        },
        {
          Working: machine.invoke({
            name: "at-least-once",
            success: Schema.String,
            error: Schema.Never,
            effect: (_, execution) =>
              Effect.gen(function* () {
                const attempts = yield* Ref.updateAndGet(executions, (current) => [
                  ...current,
                  { id: execution.id, attempt: execution.deliveryAttempt },
                ])
                if (attempts.length === 1) return yield* Effect.never
                return execution.id
              }),
            onSuccess: { target: "Done", reduce: ({ value }) => ({ key: value }) },
            onFailure: { target: "Done", reduce: () => ({ key: "impossible" }) },
          }),
          Done: machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()
      const options: Runtime.RunOptions = {
        instanceId: Runtime.instanceId("redelivery"),
        persistenceVersion: Runtime.persistenceVersion("1"),
        activityLeaseMillis: 100,
        pollIntervalMillis: 25,
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Runtime.run(definition, {}, options).pipe(
            Effect.provideService(Runtime.Store, store),
          )
          while ((yield* Ref.get(executions)).length === 0) yield* Effect.yieldNow
        }),
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const resumed = yield* Runtime.run(definition, {}, options).pipe(
            Effect.provideService(Runtime.Store, store),
          )
          const completion = yield* Effect.forkChild(resumed.completion)
          yield* TestClock.adjust("100 millis")
          const done = yield* Fiber.join(completion)
          const keys = yield* Ref.get(executions)
          assert.deepStrictEqual(keys, [
            { id: done.key, attempt: 1 },
            { id: done.key, attempt: 2 },
          ])
        }),
      )
    }),
  )

  it.effect("persists an activity defect summary while retaining its live Cause", () =>
    Effect.gen(function* () {
      const boom = new Error("activity exploded")
      const Working = Schema.TaggedStruct("Working", {})
      const Done = Schema.TaggedStruct("Done", {})
      const State = Schema.Union([Working, Done]).pipe(Schema.toTaggedUnion("_tag"))
      const Event = Schema.Union([Schema.TaggedStruct("Noop", {})]).pipe(
        Schema.toTaggedUnion("_tag"),
      )
      const machine = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
      const definition = machine.define(
        {
          id: "durable-defect",
          initial: () => ({ _tag: "Working" }),
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        },
        {
          Working: machine.invoke({
            name: "explode",
            success: Schema.Never,
            error: Schema.Never,
            effect: () => Effect.die(boom),
            onSuccess: { target: "Done", reduce: () => ({}) },
            onFailure: { target: "Done", reduce: () => ({}) },
          }),
          Done: machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()
      const defectId = Runtime.instanceId("defect")

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Runtime.run(
            definition,
            {},
            {
              instanceId: defectId,
              persistenceVersion: Runtime.persistenceVersion("1"),
            },
          ).pipe(Effect.provideService(Runtime.Store, store))
          const error = yield* Effect.flip(handle.completion)
          assert.strictEqual(error._tag, "MachineInstanceDefect")
          if (error._tag !== "MachineInstanceDefect") return
          assert.strictEqual(error.defect.category, "activity")
          assert.strictEqual(
            error.cause === undefined ? undefined : Cause.squash(error.cause),
            boom,
          )
        }),
      )
      assert.strictEqual(Option.isNone(yield* store.claimMachine(defectId, "late", 100)), true)
      assert.strictEqual(Option.isNone(yield* store.claimActivity(defectId, "late", 100)), true)
    }),
  )

  it.effect("checkpoints all lanes and completes a parallel-region macrostep", () =>
    Effect.gen(function* () {
      const Input = Schema.Struct({})
      const Loading = Schema.TaggedStruct("Loading", {})
      const LeftIdle = Schema.TaggedStruct("LeftIdle", {})
      const LeftDone = Schema.TaggedStruct("LeftDone", {})
      const RightIdle = Schema.TaggedStruct("RightIdle", {})
      const RightDone = Schema.TaggedStruct("RightDone", {})
      const Parallel = Schema.TaggedStruct("Parallel", {
        left: Schema.Union([LeftIdle, LeftDone]).pipe(Schema.toTaggedUnion("_tag")),
        right: Schema.Union([RightIdle, RightDone]).pipe(Schema.toTaggedUnion("_tag")),
        total: Schema.Number,
      })
      const Done = Schema.TaggedStruct("Done", { total: Schema.Number })
      const State = Schema.Union([Loading, Parallel, Done]).pipe(Schema.toTaggedUnion("_tag"))
      const Advance = Schema.TaggedStruct("Advance", {})
      const Event = Schema.Union([Advance]).pipe(Schema.toTaggedUnion("_tag"))
      const machine = Machine.builder({ input: Input, state: State, event: Event })
      const definition = machine.define(
        {
          id: "durable-aggregate-regions",
          initial: () => ({ _tag: "Loading" }),
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        },
        {
          Loading: machine.invoke.all({
            name: "load-both",
            concurrency: 2,
            tasks: {
              left: {
                success: Schema.Number,
                error: Schema.Never,
                effect: () => Effect.succeed(20),
              },
              right: {
                success: Schema.Number,
                error: Schema.Never,
                effect: () => Effect.succeed(22),
              },
            },
            onSuccess: {
              target: "Parallel",
              reduce: ({ value }) => ({
                left: { _tag: "LeftIdle" },
                right: { _tag: "RightIdle" },
                total: value.left + value.right,
              }),
            },
            onFailure: { target: "Done", reduce: () => ({ total: -1 }) },
          }),
          Parallel: machine.regions(
            {
              left: {
                LeftIdle: { Advance: { target: "LeftDone", reduce: () => ({}) } },
                LeftDone: { final: true },
              },
              right: {
                RightIdle: { Advance: { target: "RightDone", reduce: () => ({}) } },
                RightDone: { final: true },
              },
            },
            {},
            {
              onComplete: {
                target: "Done",
                reduce: ({ state }) => ({ total: state.total }),
              },
            },
          ),
          Done: machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Runtime.run(
            definition,
            {},
            {
              instanceId: Runtime.instanceId("aggregate-regions"),
              persistenceVersion: Runtime.persistenceVersion("1"),
            },
          ).pipe(Effect.provideService(Runtime.Store, store))
          yield* Effect.repeat(Effect.yieldNow, { times: 100 })
          assert.deepStrictEqual(yield* handle.snapshot, {
            _tag: "Parallel",
            left: { _tag: "LeftIdle" },
            right: { _tag: "RightIdle" },
            total: 42,
          })
          yield* handle.send({ _tag: "Advance" }, { idempotencyKey: "advance" })
          assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", total: 42 })
        }),
      )
    }),
  )

  it.effect("preserves race winner and value correlation through the persisted outcome", () =>
    Effect.gen(function* () {
      const Racing = Schema.TaggedStruct("Racing", {})
      const Won = Schema.TaggedStruct("Won", {
        winner: Schema.Literals(["fast", "slow"]),
        value: Schema.Number,
      })
      const Failed = Schema.TaggedStruct("Failed", {})
      const State = Schema.Union([Racing, Won, Failed]).pipe(Schema.toTaggedUnion("_tag"))
      const Event = Schema.Union([Schema.TaggedStruct("Noop", {})]).pipe(
        Schema.toTaggedUnion("_tag"),
      )
      const machine = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
      const definition = machine.define(
        {
          id: "durable-race",
          initial: () => ({ _tag: "Racing" }),
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        },
        {
          Racing: machine.invoke.race({
            name: "first-result",
            tasks: {
              fast: {
                success: Schema.Number,
                error: Schema.String,
                effect: () => Effect.succeed(1),
              },
              slow: {
                success: Schema.Number,
                error: Schema.String,
                effect: () => Effect.succeed(2),
              },
            },
            onSuccess: {
              target: "Won",
              reduce: ({ winner, value }) => ({ winner, value }),
            },
            onFailure: { target: "Failed", reduce: () => ({}) },
          }),
          Won: machine.final(),
          Failed: machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()

      const completed = yield* Effect.scoped(
        Runtime.run(
          definition,
          {},
          {
            instanceId: Runtime.instanceId("race"),
            persistenceVersion: Runtime.persistenceVersion("1"),
            activityWorkerCount: 2,
          },
        ).pipe(
          Effect.provideService(Runtime.Store, store),
          Effect.flatMap((handle) => handle.completion),
        ),
      )
      assert.strictEqual(completed._tag, "Won")
      if (completed._tag !== "Won") return yield* Effect.die("race unexpectedly failed")
      assert.strictEqual(completed.value, completed.winner === "fast" ? 1 : 2)
    }),
  )

  it.effect("resumes bounded all work from persisted partial lane progress", () =>
    Effect.gen(function* () {
      const Loading = Schema.TaggedStruct("Loading", {})
      const Done = Schema.TaggedStruct("Done", { total: Schema.Number })
      const State = Schema.Union([Loading, Done]).pipe(Schema.toTaggedUnion("_tag"))
      const Event = Schema.Union([Schema.TaggedStruct("Noop", {})]).pipe(
        Schema.toTaggedUnion("_tag"),
      )
      const machine = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const definition = machine.define(
        {
          id: "durable-partial-all",
          initial: () => ({ _tag: "Loading" }),
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
        },
        {
          Loading: machine.invoke.all({
            name: "bounded",
            concurrency: 1,
            tasks: {
              first: {
                success: Schema.Number,
                error: Schema.Never,
                effect: () => Ref.update(calls, (value) => [...value, "first"]).pipe(Effect.as(20)),
              },
              second: {
                success: Schema.Number,
                error: Schema.Never,
                effect: () =>
                  Effect.gen(function* () {
                    const updated = yield* Ref.updateAndGet(calls, (value) => [...value, "second"])
                    if (updated.filter((name) => name === "second").length === 1) {
                      return yield* Effect.never
                    }
                    return 22
                  }),
              },
            },
            onSuccess: {
              target: "Done",
              reduce: ({ value }) => ({ total: value.first + value.second }),
            },
            onFailure: { target: "Done", reduce: () => ({ total: -1 }) },
          }),
          Done: machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()
      const options: Runtime.RunOptions = {
        instanceId: Runtime.instanceId("partial-all"),
        persistenceVersion: Runtime.persistenceVersion("1"),
        activityLeaseMillis: 100,
        pollIntervalMillis: 25,
      }

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Runtime.run(definition, {}, options).pipe(
            Effect.provideService(Runtime.Store, store),
          )
          while (!(yield* Ref.get(calls)).includes("second")) yield* Effect.yieldNow
        }),
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const resumed = yield* Runtime.run(definition, {}, options).pipe(
            Effect.provideService(Runtime.Store, store),
          )
          const completion = yield* Effect.forkChild(resumed.completion)
          yield* TestClock.adjust("100 millis")
          assert.deepStrictEqual(yield* Fiber.join(completion), { _tag: "Done", total: 42 })
        }),
      )
      assert.deepStrictEqual(yield* Ref.get(calls), ["first", "second", "second"])
    }),
  )

  it.effect("executes region-owned work from encoded local and parent entry snapshots", () =>
    Effect.gen(function* () {
      const Region = Schema.TaggedUnion({
        RegionWorking: { base: Schema.Number },
        RegionDone: { value: Schema.Number },
      })
      const State = Schema.TaggedUnion({
        Active: { offset: Schema.Number, worker: Region },
        Done: { value: Schema.Number },
      })
      const Event = Schema.TaggedUnion({ Noop: {} })
      const machine = Machine.builder({
        input: Schema.Struct({ base: Schema.Number }),
        state: State,
        event: Event,
      })
      const definition = machine.define(
        {
          id: "durable-region-work",
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
          initial: ({ base }) => ({
            _tag: "Active",
            offset: 2,
            worker: { _tag: "RegionWorking", base },
          }),
        },
        {
          Active: machine.regions(
            {
              worker: {
                RegionWorking: {
                  invoke: {
                    kind: "effect",
                    name: "region-add",
                    success: Schema.Number,
                    error: Schema.Never,
                    effect: (
                      local: Readonly<{ _tag: "RegionWorking"; base: number }>,
                      parent: Readonly<{ _tag: "Active"; offset: number }>,
                    ) => Effect.succeed(local.base + parent.offset),
                    onSuccess: {
                      target: "RegionDone",
                      reduce: ({ value }: Readonly<{ value: number }>) => ({ value }),
                    },
                    onFailure: {
                      target: "RegionDone",
                      reduce: () => ({ value: -1 }),
                    },
                  },
                },
                RegionDone: { final: true },
              },
            },
            {},
            {
              onComplete: {
                target: "Done",
                reduce: ({ state }) => ({
                  value: state.worker._tag === "RegionDone" ? state.worker.value : -1,
                }),
              },
            },
          ),
          Done: machine.final(),
        },
      )
      const store = yield* Runtime.makeMemoryStore()

      const completed = yield* Effect.scoped(
        Runtime.run(
          definition,
          { base: 40 },
          {
            instanceId: Runtime.instanceId("region-work"),
            persistenceVersion: Runtime.persistenceVersion("1"),
          },
        ).pipe(
          Effect.provideService(Runtime.Store, store),
          Effect.flatMap((handle) => handle.completion),
        ),
      )
      assert.deepStrictEqual(completed, { _tag: "Done", value: 42 })
    }),
  )
})
