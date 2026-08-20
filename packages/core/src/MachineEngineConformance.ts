import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Machine from "./Machine.js"
import type { MachineEngine } from "./MachineEngine.js"
import { type MachineError, persistenceVersion } from "./MachineRuntimeProtocol.js"

/** Engine behaviors reusable across aggregate-store implementations. */
export const topics = [
  "initialization-resume",
  "dispatch-ordering-idempotency",
  "completion-terminal-cleanup",
  "timer-recovery",
  "activity-redelivery-fencing",
  "compatibility-migrations",
  "child-machines",
] as const

/** One behavior covered by the engine semantic corpus. */
export type Topic = (typeof topics)[number]

/** Framework-neutral executable engine assertion. */
export interface Case<Error> {
  readonly name: string
  readonly covers: ReadonlyArray<Topic>
  readonly run: Effect.Effect<void, Error>
}

const ensure = (condition: boolean, message: string): Effect.Effect<void> =>
  condition ? Effect.void : Effect.die(new Error(`MachineEngine conformance: ${message}`))

/** Builds the reusable machine-semantic corpus over one supplied engine composition. */
export const make = <Error>(
  engine: Layer.Layer<MachineEngine, Error>,
  advance: (millis: number) => Effect.Effect<void> = Effect.sleep,
): ReadonlyArray<Case<Error | MachineError>> => [
  {
    name: "initializes once, orders dispatches, resumes, and rejects terminal delivery",
    covers: [
      "initialization-resume",
      "dispatch-ordering-idempotency",
      "completion-terminal-cleanup",
    ],
    run: Effect.scoped(
      Effect.gen(function* () {
        const initialized = { count: 0 }
        const State = Machine.taggedUnion({
          Active: { fields: { count: Schema.Number } },
          Done: { fields: { count: Schema.Number } },
        })
        const Event = Machine.taggedUnion({
          Add: { fields: { amount: Schema.Number } },
          Finish: { fields: {} },
        })
        const builder = Machine.builder({ input: Schema.String, state: State, event: Event })
        const definition = builder.define(
          {
            id: "engine-conformance-dispatch",
            idempotencyKey: (id) => id,
            initial: () => {
              initialized.count += 1
              return { _tag: "Active", count: 0 }
            },
          },
          {
            Active: builder.state({
              Add: { stay: ({ state, event }) => ({ count: state.count + event.amount }) },
              Finish: { target: "Done", reduce: ({ state }) => ({ count: state.count }) },
            }),
            Done: builder.final(),
          },
        )
        const handle = yield* definition.run("one")
        yield* handle.send({ _tag: "Add", amount: 1 })
        yield* handle.send({ _tag: "Add", amount: 2 }, { idempotencyKey: "request" })
        yield* handle.send({ _tag: "Add", amount: 2 }, { idempotencyKey: "request" })
        yield* handle.send({ _tag: "Finish" })
        yield* ensure((yield* handle.completion).count === 3, "dispatches must commit in order")
        const resumed = yield* definition.open("one")
        yield* ensure((yield* resumed.completion).count === 3, "completion must survive resume")
        yield* ensure(initialized.count === 1, "resume must not rerun initialization")
        yield* Effect.exit(resumed.send({ _tag: "Add", amount: 1 })).pipe(
          Effect.flatMap((exit) => ensure(exit._tag === "Failure", "terminal dispatch must fail")),
        )
      }),
    ).pipe(Effect.provide(engine)),
  },
  {
    name: "resumes an entry-owned timer from its original absolute deadline",
    covers: ["timer-recovery"],
    run: Effect.gen(function* () {
      const State = Machine.taggedUnion({ Waiting: { fields: {} }, Done: { fields: {} } })
      const Event = Machine.taggedUnion({ Noop: { fields: {} } })
      const builder = Machine.builder({ input: Schema.String, state: State, event: Event })
      const definition = builder.define(
        {
          id: "engine-conformance-timer",
          idempotencyKey: (id) => id,
          initial: () => ({ _tag: "Waiting" }),
        },
        {
          Waiting: builder.state(
            {},
            {
              after: { duration: "60 seconds", target: "Done", reduce: () => ({}) },
            },
          ),
          Done: builder.final(),
        },
      )
      yield* Effect.scoped(Effect.asVoid(definition.run("one")))
      yield* advance(30_000)
      const before = yield* Effect.scoped(
        Effect.flatMap(definition.open("one"), (handle) => handle.snapshot),
      )
      yield* ensure(before._tag === "Waiting", "timer must not fire before its original deadline")
      yield* advance(30_000)
      const completed = yield* Effect.scoped(
        Effect.flatMap(definition.open("one"), (handle) => handle.completion),
      )
      yield* ensure(completed._tag === "Done", "timer must become eligible at its deadline")
    }).pipe(Effect.provide(engine)),
  },
  {
    name: "redelivers interrupted activity work with stable identity and a higher attempt",
    covers: ["activity-redelivery-fencing"],
    run: Effect.gen(function* () {
      const executions = yield* Ref.make<ReadonlyArray<Readonly<{ id: string; attempt: number }>>>(
        [],
      )
      const State = Machine.taggedUnion({
        Working: { fields: {} },
        Done: { fields: { id: Schema.String } },
      })
      const Event = Machine.taggedUnion({ Noop: { fields: {} } })
      const builder = Machine.builder({ input: Schema.String, state: State, event: Event })
      const definition = builder.define(
        {
          id: "engine-conformance-redelivery",
          idempotencyKey: (id) => id,
          initial: () => ({ _tag: "Working" }),
        },
        {
          Working: builder.invoke({
            name: "work",
            success: Schema.String,
            error: Schema.Never,
            effect: (_state, execution) =>
              Ref.updateAndGet(executions, (current) => [
                ...current,
                { id: execution.id, attempt: execution.deliveryAttempt },
              ]).pipe(
                Effect.flatMap((observed) =>
                  observed.length === 1 ? Effect.never : Effect.succeed(execution.id),
                ),
              ),
            onSuccess: { target: "Done", reduce: ({ value }) => ({ id: value }) },
            onFailure: { target: "Done", reduce: () => ({ id: "unreachable" }) },
          }),
          Done: builder.final(),
        },
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* definition.run("one")
          while ((yield* Ref.get(executions)).length === 0) yield* Effect.yieldNow
        }),
      )
      yield* advance(30_000)
      const completed = yield* Effect.scoped(
        Effect.flatMap(definition.open("one"), (handle) => handle.completion),
      )
      const observed = yield* Ref.get(executions)
      yield* ensure(observed.length === 2, "interrupted work must be redelivered")
      yield* ensure(observed[0]?.id === completed.id, "redelivery must preserve execution identity")
      yield* ensure(
        observed[0]?.attempt === 1 && observed[1]?.attempt === 2,
        "attempt must increase",
      )
    }).pipe(Effect.provide(engine)),
  },
  {
    name: "promptly interrupts activity work after its owning entry exits",
    covers: ["activity-redelivery-fencing", "completion-terminal-cleanup"],
    run: Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const State = Machine.taggedUnion({
        Working: { fields: {} },
        Cancelled: { fields: {} },
      })
      const Event = Machine.taggedUnion({ Cancel: { fields: {} } })
      const builder = Machine.builder({ input: Schema.String, state: State, event: Event })
      const definition = builder.define(
        {
          id: "engine-conformance-activity-cancellation",
          idempotencyKey: (id) => id,
          initial: () => ({ _tag: "Working" }),
        },
        {
          Working: builder.invoke(
            {
              name: "never",
              success: Schema.Never,
              error: Schema.Never,
              effect: () =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() =>
                    Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                  ),
                ),
              onSuccess: { target: "Cancelled", reduce: () => ({}) },
              onFailure: { target: "Cancelled", reduce: () => ({}) },
            },
            { Cancel: { target: "Cancelled", reduce: () => ({}) } },
          ),
          Cancelled: builder.final(),
        },
      )

      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* definition.run("one")
          yield* Deferred.await(started)
          yield* handle.send({ _tag: "Cancel" })
          yield* advance(25)
          yield* Deferred.await(interrupted)
          yield* ensure(
            (yield* handle.completion)._tag === "Cancelled",
            "owner exit must promptly interrupt already-running activity work",
          )
        }),
      )
    }).pipe(Effect.provide(engine)),
  },
  {
    name: "forwards to, resumes, completes, and cancels nested child machines",
    covers: ["child-machines"],
    run: Effect.gen(function* () {
      const initialized = { count: 0 }
      const ChildState = Machine.taggedUnion({
        Waiting: { fields: {} },
        Chosen: { fields: { value: Schema.String } },
      })
      const ChildEvent = Machine.taggedUnion({
        Choose: { fields: { value: Schema.String } },
      })
      const child = Machine.builder({
        input: Schema.String,
        state: ChildState,
        event: ChildEvent,
      })
      const childDefinition = child.define(
        {
          id: "engine-conformance-child",
          idempotencyKey: (id) => id,
          initial: () => {
            initialized.count += 1
            return { _tag: "Waiting" }
          },
        },
        {
          Waiting: child.state({
            Choose: {
              target: "Chosen",
              reduce: ({ event }) => ({ value: event.value }),
            },
          }),
          Chosen: child.final(),
        },
      )
      const ParentState = Machine.taggedUnion({
        Active: { fields: { id: Schema.String } },
        Done: { fields: { value: Schema.String } },
        Cancelled: { fields: {} },
      })
      const ParentEvent = Machine.taggedUnion({
        Resolve: { fields: { value: Schema.String } },
        Cancel: { fields: {} },
      })
      const parent = Machine.builder({
        input: Schema.String,
        state: ParentState,
        event: ParentEvent,
      })
      const definition = parent.define(
        {
          id: "engine-conformance-parent",
          idempotencyKey: (id) => id,
          initial: (id) => ({ _tag: "Active", id }),
        },
        {
          Active: parent.child(
            {
              name: "child",
              definition: childDefinition,
              input: ({ id }) => id,
              forward: {
                Resolve: {
                  target: "Choose",
                  map: ({ event }) => ({ _tag: "Choose", value: event.value }),
                },
              },
              onComplete: {
                target: "Done",
                reduce: ({ value }) => ({
                  value: value._tag === "Chosen" ? value.value : "unreachable",
                }),
              },
            },
            { Cancel: { target: "Cancelled", reduce: () => ({}) } },
          ),
          Done: parent.final(),
          Cancelled: parent.final(),
        },
      )

      yield* Effect.scoped(Effect.asVoid(definition.run("resume")))
      const resumed = yield* Effect.scoped(definition.open("resume"))
      yield* ensure(initialized.count === 1, "resuming a child must not initialize it twice")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* definition.open("resume")
          yield* handle.send({ _tag: "Resolve", value: "resolved" })
          const completed = yield* handle.completion
          yield* ensure(
            completed._tag === "Done" && completed.value === "resolved",
            "forwarded child completion must reach the parent exactly once",
          )
        }),
      )
      yield* ensure(
        (yield* resumed.status) === "completed",
        "all handles must observe child-driven completion",
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* definition.run("cancel")
          yield* handle.send({ _tag: "Cancel" })
          yield* ensure(
            (yield* handle.completion)._tag === "Cancelled",
            "parent exit must cancel its active child",
          )
          yield* Effect.exit(handle.send({ _tag: "Resolve", value: "late" })).pipe(
            Effect.flatMap((exit) =>
              ensure(exit._tag === "Failure", "late forwarding must not revive a cancelled child"),
            ),
          )
        }),
      )
    }).pipe(Effect.provide(engine)),
  },
  {
    name: "preserves nested child timer deadlines across runner reconstruction",
    covers: ["child-machines", "timer-recovery"],
    run: Effect.gen(function* () {
      const initialized = { count: 0 }
      const ChildState = Machine.taggedUnion({ Waiting: { fields: {} }, Done: { fields: {} } })
      const ChildEvent = Machine.taggedUnion({ Noop: { fields: {} } })
      const child = Machine.builder({
        input: Schema.String,
        state: ChildState,
        event: ChildEvent,
      })
      const childDefinition = child.define(
        {
          id: "engine-conformance-timed-child",
          idempotencyKey: (id) => id,
          initial: () => {
            initialized.count += 1
            return { _tag: "Waiting" }
          },
        },
        {
          Waiting: child.state(
            {},
            {
              after: { duration: "60 seconds", target: "Done", reduce: () => ({}) },
            },
          ),
          Done: child.final(),
        },
      )
      const ParentState = Machine.taggedUnion({ Active: { fields: {} }, Done: { fields: {} } })
      const ParentEvent = Machine.taggedUnion({ Noop: { fields: {} } })
      const parent = Machine.builder({
        input: Schema.String,
        state: ParentState,
        event: ParentEvent,
      })
      const definition = parent.define(
        {
          id: "engine-conformance-timed-parent",
          idempotencyKey: (id) => id,
          initial: () => ({ _tag: "Active" }),
        },
        {
          Active: parent.child({
            name: "timer",
            definition: childDefinition,
            input: () => "child",
            onComplete: { target: "Done", reduce: () => ({}) },
          }),
          Done: parent.final(),
        },
      )

      yield* Effect.scoped(Effect.asVoid(definition.run("one")))
      yield* advance(30_000)
      const halfway = yield* Effect.scoped(
        Effect.flatMap(definition.open("one"), (handle) => handle.snapshot),
      )
      yield* ensure(halfway._tag === "Active", "child timer must retain its remaining duration")
      yield* ensure(
        initialized.count === 1,
        "reconstructing a timed child must not reinitialize it",
      )
      yield* advance(30_000)
      const completed = yield* Effect.scoped(
        Effect.flatMap(definition.open("one"), (handle) => handle.completion),
      )
      yield* ensure(completed._tag === "Done", "child timer must complete at its original deadline")
    }).pipe(Effect.provide(engine)),
  },
  {
    name: "executes activity work owned by a nested grandchild",
    covers: ["child-machines", "activity-redelivery-fencing"],
    run: Effect.gen(function* () {
      const LeafState = Machine.taggedUnion({
        Working: { fields: { id: Schema.String } },
        Done: { fields: { value: Schema.String } },
      })
      const NoopEvent = Machine.taggedUnion({ Noop: { fields: {} } })
      const leaf = Machine.builder({
        input: Schema.String,
        state: LeafState,
        event: NoopEvent,
      })
      const leafDefinition = leaf.define(
        {
          id: "engine-conformance-grandchild",
          idempotencyKey: (id) => id,
          initial: (id) => ({ _tag: "Working", id }),
        },
        {
          Working: leaf.invoke({
            name: "nested-work",
            success: Schema.String,
            error: Schema.Never,
            effect: (state) => Effect.succeed(state.id),
            onSuccess: { target: "Done", reduce: ({ value }) => ({ value }) },
            onFailure: { target: "Done", reduce: () => ({ value: "unreachable" }) },
          }),
          Done: leaf.final(),
        },
      )
      const BranchState = Machine.taggedUnion({
        Active: { fields: { id: Schema.String } },
        Done: { fields: { value: Schema.String } },
      })
      const branch = Machine.builder({
        input: Schema.String,
        state: BranchState,
        event: NoopEvent,
      })
      const branchDefinition = branch.define(
        {
          id: "engine-conformance-child-branch",
          idempotencyKey: (id) => id,
          initial: (id) => ({ _tag: "Active", id }),
        },
        {
          Active: branch.child({
            name: "leaf",
            definition: leafDefinition,
            input: ({ id }) => id,
            onComplete: {
              target: "Done",
              reduce: ({ value }) => ({
                value: value._tag === "Done" ? value.value : "unreachable",
              }),
            },
          }),
          Done: branch.final(),
        },
      )
      const root = Machine.builder({
        input: Schema.String,
        state: BranchState,
        event: NoopEvent,
      })
      const definition = root.define(
        {
          id: "engine-conformance-nested-parent",
          idempotencyKey: (id) => id,
          initial: (id) => ({ _tag: "Active", id }),
        },
        {
          Active: root.child({
            name: "branch",
            definition: branchDefinition,
            input: ({ id }) => id,
            onComplete: {
              target: "Done",
              reduce: ({ value }) => ({
                value: value._tag === "Done" ? value.value : "unreachable",
              }),
            },
          }),
          Done: root.final(),
        },
      )
      const { completed, records } = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* definition.run("nested")
          const completed = yield* handle.completion
          const records = yield* Stream.runCollect(
            handle.tree.records.pipe(
              Stream.takeUntil(
                (record) =>
                  record.actorId === handle.actorId && record.body._tag === "ActorTerminated",
              ),
            ),
          )
          return { completed, records }
        }),
      )
      yield* ensure(
        completed._tag === "Done" && completed.value === "nested",
        "nested grandchild work must complete through both parents",
      )
      const childCompletions = records.filter(
        (record) =>
          record.body._tag === "Inspection" && record.body.metadata._tag === "ChildCompleted",
      )
      yield* ensure(childCompletions.length === 2, "each parent must retain one child completion")
      yield* ensure(
        new Set(childCompletions.map(({ actorId }) => actorId)).size === 2,
        "nested completion facts must belong to the two distinct immediate parents",
      )
    }).pipe(Effect.provide(engine)),
  },
  {
    name: "applies definition-owned migrations without rerunning initialization",
    covers: ["compatibility-migrations"],
    run: Effect.gen(function* () {
      const initialized = { count: 0 }
      const State = Machine.taggedUnion({ Active: { fields: { value: Schema.String } } })
      const Event = Machine.taggedUnion({ Noop: { fields: {} } })
      const builder = Machine.builder({ input: Schema.String, state: State, event: Event })
      const states = { Active: builder.state({}) }
      const initial = (value: string) => {
        initialized.count += 1
        return { _tag: "Active" as const, value }
      }
      const versionOne = builder.define(
        {
          id: "engine-conformance-migration",
          idempotencyKey: (id) => id,
          initial,
        },
        states,
      )
      const versionTwo = builder.define(
        {
          id: "engine-conformance-migration",
          idempotencyKey: (id) => id,
          version: "2",
          migrations: [
            {
              from: persistenceVersion("1"),
              to: persistenceVersion("2"),
              migrate: (document) =>
                Effect.succeed({
                  ...document,
                  checkpoint: {
                    ...document.checkpoint,
                    persistenceVersion: persistenceVersion("2"),
                  },
                }),
            },
          ],
          initial,
        },
        states,
      )
      yield* Effect.scoped(Effect.asVoid(versionOne.run("one")))
      const resumed = yield* Effect.scoped(
        Effect.flatMap(versionTwo.open("one"), (handle) => handle.snapshot),
      )
      yield* ensure(resumed.value === "one", "migration must preserve encoded state")
      yield* ensure(initialized.count === 1, "migration must not rerun initialization")
    }).pipe(Effect.provide(engine)),
  },
]
