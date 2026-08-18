import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import * as Mermaid from "../src/Mermaid.js"

const LifecycleState = Schema.TaggedUnion({
  Editing: { count: Schema.Number },
  Done: { count: Schema.Number },
})
const LifecycleEvent = Schema.TaggedUnion({
  Stay: {},
  Restart: {},
  Finish: {},
})
const lifecycle = Machine.builder({
  input: Schema.Struct({ count: Schema.Number }),
  state: LifecycleState,
  event: LifecycleEvent,
})

const lifecycleDefinition = lifecycle.define(
  {
    id: "entry-lifecycle",
    initial: ({ count }) => ({ _tag: "Editing", count }),
  },
  {
    Editing: lifecycle.state(
      {
        Stay: { stay: ({ state }) => ({ count: state.count + 1 }) },
        Restart: {
          target: "Editing",
          reduce: ({ state }) => ({ count: state.count + 1 }),
        },
        Finish: {
          target: "Done",
          reduce: () => ({ _tag: "Editing", count: 99 }),
        },
      },
      {
        after: {
          duration: "1 second",
          target: "Done",
          reduce: ({ state }) => ({ count: state.count }),
        },
      },
    ),
    Done: lifecycle.final(),
  },
)

const WorkState = Schema.TaggedUnion({
  Joining: {},
  Racing: {},
  Ready: { summary: Schema.String },
  Failed: { message: Schema.String },
})
const WorkEvent = Schema.TaggedUnion({ Abort: {} })
const work = Machine.builder({ input: Schema.Void, state: WorkState, event: WorkEvent })

const allDefinition = work.define(
  { id: "all-work", initial: () => ({ _tag: "Joining" }) },
  {
    Joining: work.invoke.all({
      name: "join",
      concurrency: 2,
      tasks: {
        left: () => Effect.succeed("L"),
        right: () => Effect.succeed(2),
      },
      onSuccess: {
        target: "Ready",
        reduce: ({ value }) => ({ summary: `${value.left}${value.right}` }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ message: String(error) }),
      },
    }),
    Racing: work.state({}),
    Ready: work.final(),
    Failed: work.final(),
  },
)

const raceDefinition = work.define(
  { id: "race-work", initial: () => ({ _tag: "Racing" }) },
  {
    Joining: work.state({}),
    Racing: work.invoke.race({
      name: "first-success",
      tasks: {
        earlyFailure: () => Effect.fail("not-it"),
        winner: () => Effect.succeed(42),
      },
      onSuccess: {
        target: "Ready",
        reduce: ({ winner, value }) => ({ summary: `${winner}:${value}` }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ message: String(error) }),
      },
    }),
    Ready: work.final(),
    Failed: work.final(),
  },
)

const Left = Schema.TaggedUnion({ LeftIdle: {}, LeftDone: {} })
const Right = Schema.TaggedUnion({
  RightIdle: {},
  RightDone: { observedLeft: Schema.String },
})
const ParallelState = Schema.TaggedUnion({
  Active: { left: Left, right: Right, history: Left },
  Finished: { history: Left },
  ParentWon: {},
})
const ParallelEvent = Schema.TaggedUnion({ Step: {}, Stop: {}, Outer: {} })
const parallel = Machine.builder({
  input: Schema.Void,
  state: ParallelState,
  event: ParallelEvent,
})

const parallelDefinition = parallel.define(
  {
    id: "parallel-regions",
    initial: () => ({
      _tag: "Active",
      left: { _tag: "LeftIdle" },
      right: { _tag: "RightIdle" },
      history: { _tag: "LeftIdle" },
    }),
  },
  {
    Active: parallel.regions(
      {
        left: {
          LeftIdle: {
            Step: { target: "LeftDone", reduce: () => ({}) },
            Outer: { ignore: {} },
          },
          LeftDone: { final: true },
        },
        right: {
          RightIdle: {
            Step: {
              target: "RightDone",
              reduce: ({ parent }) => ({ observedLeft: parent.left._tag }),
            },
          },
          RightDone: { final: true },
        },
      },
      {
        Step: { target: "ParentWon", reduce: () => ({}) },
        Outer: { target: "ParentWon", reduce: () => ({}) },
        Stop: { target: "Finished", reduce: ({ state }) => ({ history: state.left }) },
      },
      {
        onComplete: {
          target: "Finished",
          reduce: ({ state }) => ({ history: state.left }),
        },
      },
    ),
    Finished: parallel.final(),
    ParentWon: parallel.final(),
  },
)

const TimedSlot = Schema.TaggedUnion({
  Waiting: { count: Schema.Number },
  SlotDone: { count: Schema.Number },
})
const RegionTimerState = Schema.TaggedUnion({
  Active: { timer: TimedSlot },
  Completed: { count: Schema.Number },
})
const RegionTimerEvent = Schema.TaggedUnion({ Stay: {}, Restart: {} })
const regionTimer = Machine.builder({
  input: Schema.Void,
  state: RegionTimerState,
  event: RegionTimerEvent,
})
const regionTimerDefinition = regionTimer.define(
  { id: "region-timer", initial: () => ({ _tag: "Active", timer: { _tag: "Waiting", count: 0 } }) },
  {
    Active: regionTimer.regions(
      {
        timer: {
          Waiting: {
            on: {
              Stay: { stay: ({ state }) => ({ count: state.count + 1 }) },
              Restart: {
                target: "Waiting",
                reduce: ({ state }) => ({ count: state.count + 1 }),
              },
            },
            after: {
              duration: "1 second",
              target: "SlotDone",
              reduce: ({ state }) => ({ count: state.count }),
            },
          },
          SlotDone: { final: true },
        },
      },
      {},
      {
        onComplete: {
          target: "Completed",
          reduce: ({ state }) => ({ count: state.timer.count }),
        },
      },
    ),
    Completed: regionTimer.final(),
  },
)

describe("shallow statechart runtime", () => {
  it("validates canonical definitions synchronously without executing authored callbacks", () => {
    let callbackCalls = 0
    const inspected = lifecycle.define(
      {
        id: "inspection-is-static",
        initial: () => {
          callbackCalls += 1
          return { _tag: "Editing", count: 0 }
        },
      },
      {
        Editing: lifecycle.invoke({
          name: "static-work",
          effect: () => {
            callbackCalls += 1
            return Effect.succeed(undefined)
          },
          onSuccess: {
            target: "Done",
            reduce: () => {
              callbackCalls += 1
              return { count: 0 }
            },
          },
          onFailure: { target: "Done", reduce: () => ({ count: 0 }) },
        }),
        Done: lifecycle.final(),
      },
    )
    Graph.fromDefinition(inspected)
    assert.strictEqual(callbackCalls, 0)

    assert.throws(
      () =>
        lifecycle.define(
          { id: "blank-name", initial: () => ({ _tag: "Editing", count: 0 }) },
          {
            Editing: lifecycle.invoke({
              name: " ",
              effect: () => Effect.succeed(undefined),
              onSuccess: { target: "Done", reduce: () => ({ count: 0 }) },
              onFailure: { target: "Done", reduce: () => ({ count: 0 }) },
            }),
            Done: lifecycle.final(),
          },
        ),
      Machine.MachineDefinitionDefect,
    )
    assert.throws(
      () =>
        work.define(
          { id: "bad-concurrency", initial: () => ({ _tag: "Joining" }) },
          {
            Joining: work.invoke.all({
              name: "join",
              concurrency: 0,
              tasks: { lane: () => Effect.succeed(undefined) },
              onSuccess: { target: "Ready", reduce: () => ({ summary: "" }) },
              onFailure: { target: "Failed", reduce: () => ({ message: "" }) },
            }),
            Racing: work.state({}),
            Ready: work.final(),
            Failed: work.final(),
          },
        ),
      Machine.MachineDefinitionDefect,
    )
    assert.throws(
      () =>
        lifecycle.define(
          { id: "blank-duration-name", initial: () => ({ _tag: "Editing", count: 0 }) },
          {
            Editing: lifecycle.state(
              {},
              {
                after: {
                  duration: { name: " ", compute: () => "1 second" },
                  target: "Done",
                  reduce: ({ state }) => ({ count: state.count }),
                },
              },
            ),
            Done: lifecycle.final(),
          },
        ),
      Machine.MachineDefinitionDefect,
    )
  })

  it.effect("commits the declared target tag even when a reducer leaks another tag", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(lifecycleDefinition, { count: 0 })
      yield* handle.send({ _tag: "Finish" })
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", count: 99 })
    }),
  )

  it.effect("keeps a timer through stay and restarts it on explicit self-target", () =>
    Effect.gen(function* () {
      const stay = yield* Machine.run(lifecycleDefinition, { count: 0 })
      yield* TestClock.adjust("500 millis")
      yield* stay.send({ _tag: "Stay" })
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* stay.completion, { _tag: "Done", count: 1 })

      const restart = yield* Machine.run(lifecycleDefinition, { count: 0 })
      yield* TestClock.adjust("500 millis")
      yield* restart.send({ _tag: "Restart" })
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* restart.snapshot, { _tag: "Editing", count: 1 })
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* restart.completion, { _tag: "Done", count: 1 })
    }),
  )

  it.effect("computes named durations once per entry and selects guarded timer branches", () =>
    Effect.gen(function* () {
      const computedFrom: Array<number> = []
      const definition = lifecycle.define(
        { id: "dynamic-guarded-after", initial: () => ({ _tag: "Editing", count: 0 }) },
        {
          Editing: lifecycle.state(
            {
              Stay: { stay: ({ state }) => ({ count: state.count + 1 }) },
            },
            {
              after: {
                duration: {
                  name: "editing-deadline",
                  description: "One second from entry.",
                  compute: (state) => {
                    computedFrom.push(state.count)
                    return "1 second"
                  },
                },
                branches: [
                  {
                    when: {
                      name: "edited",
                      guard: ({ state }) => state.count > 0,
                    },
                    target: "Done",
                    reduce: ({ state }) => ({ count: state.count + 10 }),
                  },
                  {
                    otherwise: true,
                    target: "Done",
                    reduce: ({ state }) => ({ count: state.count }),
                  },
                ],
              },
            },
          ),
          Done: lifecycle.final(),
        },
      )

      const graph = Graph.fromDefinition(definition)
      assert.deepStrictEqual(graph.nodes.find(({ id }) => id === "Editing")?.timer, {
        name: "editing-deadline",
        description: "One second from entry.",
        targets: ["Done"],
      })
      assert.deepStrictEqual(
        graph.edges.filter(({ outcome }) => outcome?.kind === "timer").map(({ branch }) => branch),
        [
          { kind: "guard", index: 0, name: "edited" },
          { kind: "otherwise", index: 1 },
        ],
      )
      assert.match(Mermaid.render(graph), /@after "editing-deadline" \[1: edited\]/)

      const handle = yield* Machine.run(definition, { count: 0 })
      yield* TestClock.adjust("500 millis")
      yield* handle.send({ _tag: "Stay" })
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", count: 11 })
      assert.deepStrictEqual(computedFrom, [0])

      const facts = Array.from(yield* Stream.runCollect(Stream.take(handle.inspection, 8)))
      const timers = facts.filter(
        (fact): fact is Extract<Machine.InspectionEvent, { timer: string }> =>
          fact._tag === "TimerStarted" || fact._tag === "TimerFired",
      )
      assert.deepStrictEqual(
        timers.map((fact) => ({ timer: fact.timer, durationMillis: fact.durationMillis })),
        [
          { timer: "editing-deadline", durationMillis: 1_000 },
          { timer: "editing-deadline", durationMillis: 1_000 },
        ],
      )
      assert.deepStrictEqual(
        facts.find((fact) => fact._tag === "TransitionSelected" && fact.eventTag === "@after"),
        {
          _tag: "TransitionSelected",
          machineId: "dynamic-guarded-after",
          sourceStateTag: "Editing",
          targetStateTag: "Done",
          eventTag: "@after",
          ownerPath: "Editing",
          macrostep: 0,
          branch: { kind: "guard", index: 0, name: "edited" },
        },
      )
    }),
  )

  it.effect("preserves running work across stay updates", () =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<number>()
      const definition = lifecycle.define(
        { id: "stay-preserves-work", initial: () => ({ _tag: "Editing", count: 0 }) },
        {
          Editing: lifecycle.invoke(
            {
              name: "pending",
              effect: () => Deferred.await(result),
              onSuccess: {
                target: "Done",
                reduce: ({ state, value }) => ({ count: state.count + value }),
              },
              onFailure: { target: "Done", reduce: ({ state }) => ({ count: state.count }) },
            },
            { Stay: { stay: ({ state }) => ({ count: state.count + 1 }) } },
          ),
          Done: lifecycle.final(),
        },
      )
      const handle = yield* Machine.run(definition, { count: 0 })
      yield* handle.send({ _tag: "Stay" })
      yield* Deferred.succeed(result, 2)
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", count: 3 })
    }),
  )

  it.effect("owns an invoke timer with the same entry and interrupts work when it fires", () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const pending = yield* Deferred.make<number>()
      const definition = lifecycle.define(
        { id: "invoke-timeout", initial: () => ({ _tag: "Editing", count: 4 }) },
        {
          Editing: lifecycle.invoke(
            {
              name: "slow-work",
              effect: () =>
                Deferred.await(pending).pipe(
                  Effect.onInterrupt(() =>
                    Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                  ),
                ),
              onSuccess: { target: "Done", reduce: ({ value }) => ({ count: value }) },
              onFailure: { target: "Done", reduce: ({ state }) => ({ count: state.count }) },
            },
            {},
            {
              after: {
                duration: "1 second",
                target: "Done",
                reduce: ({ state }) => ({ count: state.count }),
              },
            },
          ),
          Done: lifecycle.final(),
        },
      )
      const handle = yield* Machine.run(definition, { count: 0 })
      yield* TestClock.adjust("1 second")
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", count: 4 })
      yield* Deferred.await(interrupted)
    }),
  )

  it.effect("records timer ownership and cancellation across entry changes", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(lifecycleDefinition, { count: 0 })
      yield* TestClock.adjust("500 millis")
      yield* handle.send({ _tag: "Restart" })
      yield* TestClock.adjust("1 second")
      yield* handle.completion
      const facts = Array.from(yield* Stream.runCollect(Stream.take(handle.inspection, 11)))
      const timerFacts = facts.filter(
        (fact) =>
          fact._tag === "TimerStarted" ||
          fact._tag === "TimerFired" ||
          fact._tag === "TimerCancelled",
      )
      assert.deepStrictEqual(
        timerFacts.map(({ _tag }) => _tag),
        ["TimerStarted", "TimerCancelled", "TimerStarted", "TimerFired"],
      )
      assert.deepStrictEqual(
        timerFacts.map((fact) => ("ownerPath" in fact ? fact.ownerPath : undefined)),
        ["Editing", "Editing", "Editing", "Editing"],
      )
    }),
  )

  it.effect("owns timers per region entry, preserving stay and restarting self-targets", () =>
    Effect.gen(function* () {
      const stayed = yield* Machine.run(regionTimerDefinition, undefined)
      yield* TestClock.adjust("500 millis")
      yield* stayed.send({ _tag: "Stay" })
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* stayed.completion, { _tag: "Completed", count: 1 })

      const restarted = yield* Machine.run(regionTimerDefinition, undefined)
      yield* TestClock.adjust("500 millis")
      yield* restarted.send({ _tag: "Restart" })
      yield* TestClock.adjust("500 millis")
      assert.strictEqual((yield* restarted.snapshot)._tag, "Active")
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* restarted.completion, { _tag: "Completed", count: 1 })
    }),
  )

  it.effect("supports parent-aware named durations and guarded branches in regions", () =>
    Effect.gen(function* () {
      const computed: Array<readonly [number, string]> = []
      const definition = regionTimer.define(
        {
          id: "guarded-region-timer",
          initial: () => ({ _tag: "Active", timer: { _tag: "Waiting", count: 0 } }),
        },
        {
          Active: regionTimer.regions(
            {
              timer: {
                Waiting: {
                  on: {
                    Stay: { stay: ({ state }) => ({ count: state.count + 1 }) },
                  },
                  after: {
                    duration: {
                      name: "slot-deadline",
                      compute: ({ state, parent }) => {
                        computed.push([state.count, parent._tag])
                        return "1 second"
                      },
                    },
                    branches: [
                      {
                        when: { name: "changed", guard: ({ state }) => state.count > 0 },
                        target: "SlotDone",
                        reduce: ({ state }) => ({ count: state.count + 1 }),
                      },
                      {
                        otherwise: true,
                        target: "SlotDone",
                        reduce: ({ state }) => ({ count: state.count }),
                      },
                    ],
                  },
                },
                SlotDone: { final: true },
              },
            },
            {},
            {
              onComplete: {
                target: "Completed",
                reduce: ({ state }) => ({ count: state.timer.count }),
              },
            },
          ),
          Completed: regionTimer.final(),
        },
      )
      const graph = Graph.fromDefinition(definition)
      assert.deepStrictEqual(graph.nodes.find(({ id }) => id === "Active/timer/Waiting")?.timer, {
        name: "slot-deadline",
        targets: ["Active/timer/SlotDone"],
      })
      assert.deepStrictEqual(
        graph.edges
          .filter(
            ({ source, outcome }) => source === "Active/timer/Waiting" && outcome?.kind === "timer",
          )
          .map(({ branch }) => branch),
        [
          { kind: "guard", index: 0, name: "changed" },
          { kind: "otherwise", index: 1 },
        ],
      )
      const handle = yield* Machine.run(definition, undefined)
      yield* TestClock.adjust("500 millis")
      yield* handle.send({ _tag: "Stay" })
      yield* TestClock.adjust("500 millis")
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Completed", count: 2 })
      assert.deepStrictEqual(computed, [[0, "Active"]])

      const facts = Array.from(yield* Stream.runCollect(Stream.take(handle.inspection, 10)))
      assert.ok(
        facts.some(
          (fact) =>
            fact._tag === "TransitionSelected" &&
            fact.eventTag === "@after" &&
            fact.branch?.kind === "guard" &&
            fact.branch.name === "changed",
        ),
      )
    }),
  )

  it.effect("keeps an all-final region configuration stable without onComplete", () =>
    Effect.gen(function* () {
      const stable = regionTimer.define(
        {
          id: "stable-completed-regions",
          initial: () => ({ _tag: "Active", timer: { _tag: "SlotDone", count: 1 } }),
        },
        {
          Active: regionTimer.regions({
            timer: {
              Waiting: {},
              SlotDone: { final: true },
            },
          }),
          Completed: regionTimer.final(),
        },
      )
      const handle = yield* Machine.run(stable, undefined)
      yield* Effect.yieldNow
      assert.deepStrictEqual(yield* handle.snapshot, {
        _tag: "Active",
        timer: { _tag: "SlotDone", count: 1 },
      })
    }),
  )

  it.effect("runs and retries region work and interrupts it when the parent exits", () =>
    Effect.gen(function* () {
      const Slot = Schema.TaggedUnion({ Loading: {}, Loaded: { value: Schema.Number } })
      const Parent = Schema.TaggedUnion({
        Active: { base: Schema.Number, job: Slot },
        Complete: { value: Schema.Number },
        Cancelled: {},
      })
      const ParentEvent = Schema.TaggedUnion({ Cancel: {} })
      const parent = Machine.builder({ input: Schema.Void, state: Parent, event: ParentEvent })
      const attempts = yield* Ref.make(0)
      const retried = parent.define(
        {
          id: "region-retry",
          initial: () => ({ _tag: "Active", base: 40, job: { _tag: "Loading" } }),
        },
        {
          Active: parent.regions(
            {
              job: {
                Loading: parent.region.invoke({
                  name: "load",
                  effect: (_slot, owner): Effect.Effect<number, string> =>
                    Ref.updateAndGet(attempts, (value) => value + 1).pipe(
                      Effect.flatMap((attempt) =>
                        attempt === 1 ? Effect.fail("retry") : Effect.succeed(owner.base + 2),
                      ),
                    ),
                  retry: { name: "once", schedule: Schedule.recurs(1) },
                  onSuccess: { target: "Loaded", reduce: ({ value }) => ({ value }) },
                  onFailure: { target: "Loaded", reduce: () => ({ value: -1 }) },
                }),
                Loaded: { final: true },
              },
            },
            { Cancel: { target: "Cancelled", reduce: () => ({}) } },
            {
              onComplete: {
                target: "Complete",
                reduce: ({ state }) => ({
                  value: state.job._tag === "Loaded" ? state.job.value : -1,
                }),
              },
            },
          ),
          Complete: parent.final(),
          Cancelled: parent.final(),
        },
      )
      const completed = yield* Machine.run(retried, undefined)
      assert.deepStrictEqual(yield* completed.completion, { _tag: "Complete", value: 42 })
      assert.strictEqual(yield* Ref.get(attempts), 2)

      const interrupted = yield* Deferred.make<void>()
      const pendingResult = yield* Deferred.make<number>()
      const pending = parent.define(
        {
          id: "region-parent-exit",
          initial: () => ({ _tag: "Active", base: 0, job: { _tag: "Loading" } }),
        },
        {
          Active: parent.regions(
            {
              job: {
                Loading: parent.region.invoke({
                  name: "pending",
                  effect: () =>
                    Deferred.await(pendingResult).pipe(
                      Effect.onInterrupt(() =>
                        Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                      ),
                    ),
                  onSuccess: { target: "Loaded", reduce: () => ({ value: 0 }) },
                  onFailure: { target: "Loaded", reduce: () => ({ value: -1 }) },
                }),
                Loaded: { final: true },
              },
            },
            { Cancel: { target: "Cancelled", reduce: () => ({}) } },
          ),
          Complete: parent.final(),
          Cancelled: parent.final(),
        },
      )
      const cancelled = yield* Machine.run(pending, undefined)
      yield* cancelled.send({ _tag: "Cancel" })
      assert.strictEqual((yield* cancelled.completion)._tag, "Cancelled")
      yield* Deferred.await(interrupted)
    }),
  )

  it.effect("joins all named lanes and races for the first success", () =>
    Effect.gen(function* () {
      const joined = yield* Machine.run(allDefinition, undefined)
      assert.deepStrictEqual(yield* joined.completion, { _tag: "Ready", summary: "L2" })

      const raced = yield* Machine.run(raceDefinition, undefined)
      assert.deepStrictEqual(yield* raced.completion, {
        _tag: "Ready",
        summary: "winner:42",
      })
    }),
  )

  it.effect("commits sibling region transitions atomically and completes after all are final", () =>
    Effect.gen(function* () {
      const handle = yield* Machine.run(parallelDefinition, undefined)
      yield* handle.send({ _tag: "Step" })
      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "Finished",
        history: { _tag: "LeftDone" },
      })
      const snapshots = yield* Stream.runCollect(
        handle.tree.records.pipe(
          Stream.filter((record) => record.body._tag === "StateSnapshot"),
          Stream.map((record) =>
            record.body._tag === "StateSnapshot" ? record.body.state : undefined,
          ),
          Stream.take(3),
        ),
      )
      const active = snapshots[1] as Machine.MachineState<typeof parallelDefinition> | undefined
      assert.strictEqual(active?._tag, "Active")
      if (active?._tag === "Active") {
        assert.strictEqual(active.left._tag, "LeftDone")
        assert.strictEqual(active.right._tag, "RightDone")
        if (active.right._tag === "RightDone") {
          assert.strictEqual(active.right.observedLeft, "LeftIdle")
        }
      }
      const finished = snapshots[2] as Machine.MachineState<typeof parallelDefinition> | undefined
      assert.strictEqual(finished?._tag, "Finished")

      const facts = Array.from(yield* Stream.runCollect(Stream.take(handle.inspection, 8)))
      const regionSelections = facts.filter(
        (fact): fact is Extract<Machine.InspectionEvent, { _tag: "TransitionSelected" }> =>
          fact._tag === "TransitionSelected" && fact.ownerPath?.startsWith("Active/") === true,
      )
      assert.deepStrictEqual(
        regionSelections.map(({ ownerPath }) => ownerPath),
        ["Active/left", "Active/right"],
      )
      assert.strictEqual(regionSelections[0]?.macrostep, regionSelections[1]?.macrostep)
    }),
  )

  it.effect("lets child ignore suppress the parent and otherwise falls back to the parent", () =>
    Effect.gen(function* () {
      const ignored = yield* Machine.run(parallelDefinition, undefined)
      yield* ignored.send({ _tag: "Outer" })
      assert.strictEqual((yield* ignored.snapshot)._tag, "Active")

      const fallback = yield* Machine.run(parallelDefinition, undefined)
      yield* fallback.send({ _tag: "Stop" })
      assert.deepStrictEqual(yield* fallback.completion, {
        _tag: "Finished",
        history: { _tag: "LeftIdle" },
      })
    }),
  )

  it("extracts structural region, timer, lane, and completion metadata without execution", () => {
    const parallelGraph = Graph.fromDefinition(parallelDefinition)
    assert.deepStrictEqual(parallelGraph.nodes.find(({ id }) => id === "Active")?.regions, {
      slots: ["left", "right"],
    })
    assert.deepStrictEqual(
      parallelGraph.nodes.filter(({ region }) => region !== undefined).map(({ id }) => id),
      [
        "Active/left/LeftIdle",
        "Active/left/LeftDone",
        "Active/right/RightIdle",
        "Active/right/RightDone",
      ],
    )
    assert.ok(
      parallelGraph.edges.some(
        (edge) => edge.source === "Active/left/LeftIdle" && edge.target === "Active/left/LeftDone",
      ),
    )
    assert.ok(
      parallelGraph.edges.some(
        (edge) =>
          edge.source === "Active" &&
          edge.target === "Finished" &&
          edge.outcome?.kind === "completion",
      ),
    )
    const regionLocation = parallelGraph.nodes.find(
      ({ id }) => id === "Active/left/LeftIdle",
    )?.location
    assert.match(regionLocation?.file ?? "", /tests\/Statechart\.test\.ts$/)

    const workGraph = Graph.fromDefinition(allDefinition)
    assert.deepStrictEqual(workGraph.nodes.find(({ id }) => id === "Joining")?.invocation, {
      name: "join",
      kind: "all",
      lanes: ["left", "right"],
      concurrency: 2,
    })
    assert.match(Mermaid.render(parallelGraph), /Active\/left\/LeftIdle/)
  })

  it.effect("interrupts losing all-work lanes after a typed failure", () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const failing = work.define(
        { id: "all-failure", initial: () => ({ _tag: "Joining" }) },
        {
          Joining: work.invoke.all({
            name: "failure",
            tasks: {
              fail: () => Effect.yieldNow.pipe(Effect.andThen(Effect.fail("boom"))),
              pending: () =>
                Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                  ),
                ),
            },
            onSuccess: { target: "Ready", reduce: () => ({ summary: "impossible" }) },
            onFailure: { target: "Failed", reduce: ({ error }) => ({ message: String(error) }) },
          }),
          Racing: work.state({}),
          Ready: work.final(),
          Failed: work.final(),
        },
      )
      const handle = yield* Machine.run(failing, undefined)
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Failed", message: "boom" })
      yield* Deferred.await(interrupted)
    }),
  )

  it.effect("limits all-work concurrency while preserving the keyed product", () =>
    Effect.gen(function* () {
      const active = yield* Ref.make(0)
      const maximum = yield* Ref.make(0)
      const first = yield* Deferred.make<string>()
      const second = yield* Deferred.make<number>()
      const third = yield* Deferred.make<boolean>()
      const lane = <Value>(gate: Deferred.Deferred<Value>) =>
        Ref.updateAndGet(active, (count) => count + 1).pipe(
          Effect.tap((count) => Ref.update(maximum, (seen) => Math.max(seen, count))),
          Effect.andThen(Deferred.await(gate)),
          Effect.ensuring(Ref.update(active, (count) => count - 1)),
        )
      const limited = work.define(
        { id: "all-concurrency", initial: () => ({ _tag: "Joining" }) },
        {
          Joining: work.invoke.all({
            name: "limited",
            concurrency: 2,
            tasks: {
              first: () => lane(first),
              second: () => lane(second),
              third: () => lane(third),
            },
            onSuccess: {
              target: "Ready",
              reduce: ({ value }) => ({
                summary: `${value.first}:${value.second}:${value.third}`,
              }),
            },
            onFailure: { target: "Failed", reduce: ({ error }) => ({ message: String(error) }) },
          }),
          Racing: work.state({}),
          Ready: work.final(),
          Failed: work.final(),
        },
      )
      const handle = yield* Machine.run(limited, undefined)
      yield* Effect.yieldNow
      assert.strictEqual(yield* Ref.get(active), 2)
      yield* Deferred.succeed(first, "one")
      yield* Effect.yieldNow
      assert.strictEqual(yield* Ref.get(maximum), 2)
      yield* Deferred.succeed(second, 2)
      yield* Deferred.succeed(third, true)
      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "Ready",
        summary: "one:2:true",
      })
    }),
  )

  it.effect(
    "interrupts a race loser, continues after failed lanes, and reports all-lane failure",
    () =>
      Effect.gen(function* () {
        const loserInterrupted = yield* Deferred.make<void>()
        const raced = work.define(
          { id: "race-cancellation", initial: () => ({ _tag: "Racing" }) },
          {
            Joining: work.state({}),
            Racing: work.invoke.race({
              name: "race",
              tasks: {
                failed: () => Effect.fail("early"),
                winner: () => Effect.yieldNow.pipe(Effect.as(7)),
                loser: () =>
                  Effect.never.pipe(
                    Effect.onInterrupt(() =>
                      Deferred.succeed(loserInterrupted, undefined).pipe(Effect.asVoid),
                    ),
                  ),
              },
              onSuccess: {
                target: "Ready",
                reduce: ({ winner, value }) => ({ summary: `${winner}:${String(value)}` }),
              },
              onFailure: { target: "Failed", reduce: ({ error }) => ({ message: String(error) }) },
            }),
            Ready: work.final(),
            Failed: work.final(),
          },
        )
        const winner = yield* Machine.run(raced, undefined)
        assert.deepStrictEqual(yield* winner.completion, { _tag: "Ready", summary: "winner:7" })
        yield* Deferred.await(loserInterrupted)

        const failed = work.define(
          { id: "race-all-failed", initial: () => ({ _tag: "Racing" }) },
          {
            Joining: work.state({}),
            Racing: work.invoke.race({
              name: "race",
              tasks: { first: () => Effect.fail("one"), last: () => Effect.fail("two") },
              onSuccess: { target: "Ready", reduce: () => ({ summary: "impossible" }) },
              onFailure: { target: "Failed", reduce: ({ error }) => ({ message: String(error) }) },
            }),
            Ready: work.final(),
            Failed: work.final(),
          },
        )
        const allFailed = yield* Machine.run(failed, undefined)
        assert.strictEqual((yield* allFailed.completion)._tag, "Failed")
      }),
  )
})
