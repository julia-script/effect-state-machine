import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Machine from "../src/Machine.js"
import * as MachineEngine from "../src/MachineEngine.js"
import * as MachineStore from "../src/MachineStore.js"

const Input = Schema.Struct({ id: Schema.String })
const State = Machine.taggedUnion({
  Working: { fields: { id: Schema.String } },
  Done: { fields: { id: Schema.String, executionId: Schema.String } },
})
const Event = Machine.taggedUnion({ Finish: { fields: {} } })
const machine = Machine.builder({ input: Input, state: State, event: Event })

const makeDefinition = (initialized: { count: number }, execution: Ref.Ref<string | undefined>) =>
  machine.define(
    {
      id: "EngineTest",
      idempotencyKey: ({ id }) => id,
      initial: ({ id }) => {
        initialized.count += 1
        return { _tag: "Working", id }
      },
    },
    {
      Working: machine.invoke(
        {
          name: "work",
          success: Schema.String,
          error: Schema.Never,
          effect: (_state, context) => Ref.set(execution, context.id).pipe(Effect.as(context.id)),
          onSuccess: {
            target: "Done",
            reduce: ({ state, value }) => ({ id: state.id, executionId: value }),
          },
          onFailure: { target: "Done", reduce: ({ state }) => ({ id: state.id, executionId: "" }) },
        },
        {},
      ),
      Done: machine.final(),
    },
  )

const CounterState = Machine.taggedUnion({
  Active: { fields: { count: Schema.Number } },
  Done: { fields: { count: Schema.Number } },
})
const CounterEvent = Machine.taggedUnion({
  Add: { fields: { amount: Schema.Number } },
  Finish: { fields: {} },
})
const counterMachine = Machine.builder({
  input: Schema.String,
  state: CounterState,
  event: CounterEvent,
})
const counterDefinition = counterMachine.define(
  {
    id: "EngineCounter",
    idempotencyKey: (id) => id,
    initial: () => ({ _tag: "Active", count: 0 }),
  },
  {
    Active: counterMachine.state({
      Add: { stay: ({ state, event }) => ({ count: state.count + event.amount }) },
      Finish: { target: "Done", reduce: ({ state }) => ({ count: state.count }) },
    }),
    Done: counterMachine.final(),
  },
)

const ChildState = Machine.taggedUnion({
  Waiting: { fields: {} },
  Chosen: { fields: { value: Schema.String } },
})
const ChildEvent = Machine.taggedUnion({ Choose: { fields: { value: Schema.String } } })
const childMachine = Machine.builder({
  input: Schema.String,
  state: ChildState,
  event: ChildEvent,
})
const childDefinition = childMachine.define(
  {
    id: "EngineChild",
    idempotencyKey: (id) => id,
    initial: () => ({ _tag: "Waiting" }),
  },
  {
    Waiting: childMachine.state({
      Choose: {
        target: "Chosen",
        reduce: ({ event }) => ({ value: event.value }),
      },
    }),
    Chosen: childMachine.final(),
  },
)

const ParentState = Machine.taggedUnion({
  Resolving: { fields: { id: Schema.String } },
  Resolved: { fields: { value: Schema.String } },
  Cancelled: { fields: {} },
})
const ParentEvent = Machine.taggedUnion({
  Resolve: { fields: { value: Schema.String } },
  Cancel: { fields: {} },
})
const parentMachine = Machine.builder({
  input: Schema.String,
  state: ParentState,
  event: ParentEvent,
})
const parentDefinition = parentMachine.define(
  {
    id: "EngineParent",
    idempotencyKey: (id) => id,
    initial: (id) => ({ _tag: "Resolving", id }),
  },
  {
    Resolving: parentMachine.child(
      {
        name: "resolver",
        definition: childDefinition,
        input: ({ id }) => id,
        forward: {
          Resolve: {
            target: "Choose",
            map: ({ event }) => ({ _tag: "Choose", value: event.value }),
          },
        },
        onComplete: {
          target: "Resolved",
          reduce: ({ value }) => ({
            value: value._tag === "Chosen" ? value.value : "unreachable",
          }),
        },
      },
      {
        Cancel: { target: "Cancelled", reduce: () => ({}) },
      },
    ),
    Resolved: parentMachine.final(),
    Cancelled: parentMachine.final(),
  },
)

describe("MachineEngine", () => {
  it.effect("runs definitions with required work identity and reuses one memory layer", () =>
    Effect.gen(function* () {
      const execution = yield* Ref.make<string | undefined>(undefined)
      const initialized = { count: 0 }
      const definition = makeDefinition(initialized, execution)
      assert.strictEqual(definition.version, "1")
      assert.strictEqual(definition.instanceId({ id: "one" }), definition.instanceId({ id: "one" }))

      const program = Effect.gen(function* () {
        const first = yield* definition.run({ id: "one" })
        const completed = yield* first.completion
        const resumed = yield* definition.open({ id: "one" })
        assert.strictEqual(resumed.instanceId, first.instanceId)
        assert.strictEqual(initialized.count, 1)
        assert.strictEqual(completed.executionId, yield* Ref.get(execution))
      })

      yield* program.pipe(Effect.provide(MachineEngine.layerMemory()))
    }),
  )

  it.effect("uses a fresh volatile database for a newly built memory layer", () =>
    Effect.gen(function* () {
      const execution = yield* Ref.make<string | undefined>(undefined)
      const initialized = { count: 0 }
      const definition = makeDefinition(initialized, execution)

      yield* definition.run({ id: "one" }).pipe(Effect.provide(MachineEngine.layerMemory()))
      yield* definition.run({ id: "one" }).pipe(Effect.provide(MachineEngine.layerMemory()))
      assert.strictEqual(initialized.count, 2)
    }),
  )

  it.effect("runs the existing durable semantics over the minimal store", () =>
    Effect.gen(function* () {
      const execution = yield* Ref.make<string | undefined>(undefined)
      const initialized = { count: 0 }
      const definition = makeDefinition(initialized, execution)
      const engine = MachineEngine.layer().pipe(Layer.provide(MachineStore.layerMemory))

      const completed = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* definition.run({ id: "persistent" })
          return yield* handle.completion
        }),
      ).pipe(Effect.provide(engine))

      assert.strictEqual(completed.id, "persistent")
      assert.strictEqual(initialized.count, 1)
    }),
  )

  it.effect(
    "deduplicates caller dispatches while generated keys preserve legitimate duplicates",
    () =>
      Effect.gen(function* () {
        const program = Effect.gen(function* () {
          const handle = yield* counterDefinition.run("dispatch")
          yield* handle.send({ _tag: "Add", amount: 1 })
          yield* handle.send({ _tag: "Add", amount: 1 })
          assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 2 })

          yield* handle.send({ _tag: "Add", amount: 3 }, { idempotencyKey: "retry-safe-request" })
          yield* handle.send({ _tag: "Add", amount: 3 }, { idempotencyKey: "retry-safe-request" })
          assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 5 })

          const conflict = yield* Effect.exit(
            handle.send({ _tag: "Add", amount: 4 }, { idempotencyKey: "retry-safe-request" }),
          )
          assert.strictEqual(conflict._tag, "Failure")

          yield* handle.send({ _tag: "Finish" }, { idempotencyKey: "finish" })
          assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", count: 5 })
          const late = yield* Effect.exit(handle.send({ _tag: "Add", amount: 1 }))
          assert.strictEqual(late._tag, "Failure")
        })

        yield* Effect.scoped(program).pipe(Effect.provide(MachineEngine.layerMemory()))
      }),
  )

  it.effect("keeps generated dispatch identities fresh across engine reconstruction", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const engine = () =>
        MachineEngine.layer().pipe(Layer.provide(Layer.succeed(MachineStore.MachineStore, store)))

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* counterDefinition.run("restart-dispatch")
          yield* handle.send({ _tag: "Add", amount: 1 })
        }),
      ).pipe(Effect.provide(engine()))

      const count = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* counterDefinition.run("restart-dispatch")
          yield* handle.send({ _tag: "Add", amount: 1 })
          const state = yield* handle.snapshot
          return state._tag === "Active" ? state.count : -1
        }),
      ).pipe(Effect.provide(engine()))

      assert.strictEqual(count, 2)
    }),
  )

  it.effect("polls tree records committed through another engine handle", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const engine = () =>
        MachineEngine.layer({ pollIntervalMillis: 10 }).pipe(
          Layer.provide(Layer.succeed(MachineStore.MachineStore, store)),
        )
      const ready = yield* Deferred.make<void>()

      const observe = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* counterDefinition.run("cross-handle-tree")
          yield* Deferred.succeed(ready, undefined)
          return yield* Stream.runHead(
            handle.tree.records.pipe(
              Stream.filter(
                (record) =>
                  record.body._tag === "StateSnapshot" &&
                  typeof record.body.state === "object" &&
                  record.body.state !== null &&
                  !Array.isArray(record.body.state) &&
                  "count" in record.body.state &&
                  record.body.state.count === 1,
              ),
            ),
          )
        }),
      ).pipe(Effect.provide(engine()))

      const dispatch = Effect.scoped(
        Effect.gen(function* () {
          yield* Deferred.await(ready)
          const handle = yield* counterDefinition.open("cross-handle-tree")
          yield* handle.send({ _tag: "Add", amount: 1 })
          yield* TestClock.adjust("20 millis")
        }),
      ).pipe(Effect.provide(engine()))

      const [record] = yield* Effect.all([observe, dispatch], { concurrency: "unbounded" })
      assert.strictEqual(record._tag, "Some")
    }),
  )

  it.effect("decodes transformed persisted events before inspect projections", () =>
    Effect.gen(function* () {
      const transformedEvent = Machine.taggedUnion({
        Add: { fields: { amount: Schema.NumberFromString } },
      })
      const transformedState = Machine.taggedUnion({
        Active: { fields: { count: Schema.NumberFromString } },
        Done: { fields: { count: Schema.NumberFromString } },
      })
      const transformedMachine = Machine.builder({
        input: Schema.Void,
        state: transformedState,
        event: transformedEvent,
      })
      const definition = transformedMachine.define(
        {
          id: "EngineTransformedInspection",
          idempotencyKey: () => "one",
          initial: () => ({ _tag: "Active", count: 0 }),
        },
        {
          Active: transformedMachine.state({
            Add: { stay: ({ state, event }) => ({ count: state.count + event.amount }) },
          }),
          Done: transformedMachine.final(),
        },
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* definition.run(undefined)
          yield* handle.send({ _tag: "Add", amount: 3 })
          const projected = yield* Stream.runHead(
            handle
              .inspect((event) => event.amount * 2)
              .pipe(Stream.filter((event) => event._tag === "EventReceived")),
          )
          assert.strictEqual(projected._tag, "Some")
          if (projected._tag === "Some" && projected.value._tag === "EventReceived") {
            assert.strictEqual(projected.value.details, 6)
          }

          const retained = yield* Stream.runCollect(
            handle.tree.records.pipe(
              Stream.takeUntil(
                (record) =>
                  record.body._tag === "StateSnapshot" &&
                  typeof record.body.state === "object" &&
                  record.body.state !== null &&
                  !Array.isArray(record.body.state) &&
                  "count" in record.body.state &&
                  record.body.state.count === "3",
              ),
            ),
          )
          const received = retained.find(
            (record) =>
              record.body._tag === "Inspection" && record.body.metadata._tag === "EventReceived",
          )
          assert.deepStrictEqual(
            received?.body._tag === "Inspection" ? received.body.event : undefined,
            { _tag: "Add", amount: "3" },
          )
          const snapshots = retained.filter((record) => record.body._tag === "StateSnapshot")
          const lastSnapshot = snapshots.at(-1)
          assert.deepStrictEqual(
            lastSnapshot?.body._tag === "StateSnapshot" ? lastSnapshot.body.state : undefined,
            { _tag: "Active", count: "3" },
          )
        }),
      ).pipe(Effect.provide(MachineEngine.layerMemory()))
    }),
  )

  it.effect("converges concurrent starts on one initialized instance", () =>
    Effect.gen(function* () {
      const initialized = { count: 0 }
      const execution = yield* Ref.make<string | undefined>(undefined)
      const definition = makeDefinition(initialized, execution)
      const program = Effect.gen(function* () {
        const handles = yield* Effect.all(
          [definition.run({ id: "shared" }), definition.open({ id: "shared" })],
          { concurrency: "unbounded" },
        )
        assert.strictEqual(handles[0]?.instanceId, handles[1]?.instanceId)
        yield* handles[0]?.completion
        yield* handles[1]?.completion
      })
      yield* Effect.scoped(program).pipe(Effect.provide(MachineEngine.layerMemory()))
      assert.strictEqual(initialized.count, 1)
    }),
  )

  it.effect("persists child runtimes inside the root aggregate and forwards events", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const engine = MachineEngine.layer().pipe(
        Layer.provide(Layer.succeed(MachineStore.MachineStore, store)),
      )
      const program = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* parentDefinition.run("nested")
          assert.strictEqual(yield* handle.can({ _tag: "Resolve", value: "merged" }), true)
          yield* handle.send({ _tag: "Resolve", value: "merged" })
          assert.deepStrictEqual(yield* handle.completion, {
            _tag: "Resolved",
            value: "merged",
          })
        }),
      )
      yield* program.pipe(Effect.provide(engine))

      const stored = yield* store.load(parentDefinition.instanceId("nested"))
      assert.strictEqual(stored._tag, "Some")
      if (stored._tag === "Some") {
        assert.strictEqual(stored.value.nestedDocuments.length, 1)
        assert.strictEqual(stored.value.runtime.nodes.length, 2)
        assert.strictEqual(stored.value.runtime.nodes[1]?.status, "completed")
      }
    }),
  )

  it.effect("cancels an active child in the same root replacement", () =>
    Effect.gen(function* () {
      const store = yield* MachineStore.makeMemory()
      const engine = MachineEngine.layer().pipe(
        Layer.provide(Layer.succeed(MachineStore.MachineStore, store)),
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* parentDefinition.run("cancel-child")
          yield* handle.send({ _tag: "Cancel" })
          assert.deepStrictEqual(yield* handle.completion, { _tag: "Cancelled" })

          const records = yield* Stream.runCollect(
            handle.tree.records.pipe(
              Stream.takeUntil(
                (record) =>
                  record.actorId === handle.actorId && record.body._tag === "ActorTerminated",
              ),
            ),
          )
          const childStarted = records.find(
            (record) =>
              record.body._tag === "ActorStarted" && record.body.parentActorId === handle.actorId,
          )
          assert(childStarted !== undefined)
          const ended = yield* Effect.flip(
            handle.tree.dispatch(childStarted.actorId, { _tag: "Choose", value: "late" }),
          )
          assert.strictEqual(ended.reason, "ended")
          const unknown = yield* Effect.flip(
            handle.tree.dispatch(Machine.ActorId.make("actor:missing"), {
              _tag: "Choose",
              value: "never",
            }),
          )
          assert.strictEqual(unknown.reason, "unknown")
        }),
      ).pipe(Effect.provide(engine))

      const stored = yield* store.load(parentDefinition.instanceId("cancel-child"))
      assert.strictEqual(stored._tag, "Some")
      if (stored._tag === "Some") {
        const child = stored.value.nestedDocuments[0]
        assert.strictEqual(
          typeof child === "object" && child !== null && "status" in child
            ? child.status
            : undefined,
          "cancelled",
        )
        assert.strictEqual(stored.value.runtime.nodes[1]?.status, "cancelled")
      }
    }),
  )
})
