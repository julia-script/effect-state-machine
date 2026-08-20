/** Complete program used by the first-machine documentation tutorial. */
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Machine from "effect-state-machine/Machine"
import * as MachineEngine from "effect-state-machine/MachineEngine"

const Input = Schema.Struct({ initialCount: Schema.Number })

const State = Machine.taggedUnion({
  Ready: {
    fields: { count: Schema.Number },
    description: "Wait for counting to start.",
  },
  Counting: {
    fields: { count: Schema.Number },
    description: "Accept counter updates.",
  },
  Done: {
    fields: { count: Schema.Number },
    description: "Finish with the final count.",
  },
})

const Event = Machine.taggedUnion({
  Start: { fields: {} },
  Increment: { fields: { amount: Schema.Number } },
  Finish: { fields: {} },
})

const counter = Machine.builder({ input: Input, state: State, event: Event })

const definition = counter.define(
  {
    id: "counter",
    idempotencyKey: ({ initialCount }) => String(initialCount),
    initial: ({ initialCount }) => ({ _tag: "Ready", count: initialCount }),
  },
  {
    Ready: counter.state({
      Start: {
        target: "Counting",
        reduce: ({ state }) => ({ count: state.count }),
      },
    }),
    Counting: counter.state({
      Increment: {
        stay: ({ state, event }) => ({ count: state.count + event.amount }),
      },
      Finish: {
        target: "Done",
        reduce: ({ state }) => ({ count: state.count }),
      },
    }),
    Done: counter.final(),
  },
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* definition.run({ initialCount: 1 })

    const initial = yield* handle.snapshot
    yield* Console.log("initial:", initial)

    yield* handle.send({ _tag: "Start" })
    yield* handle.send({ _tag: "Increment", amount: 3 })

    const counting = yield* handle.snapshot
    yield* Console.log("counting:", counting)

    yield* handle.send({ _tag: "Finish" })
    const completed = yield* handle.completion
    yield* Console.log("completed:", completed)
  }),
).pipe(Effect.provide(MachineEngine.layerMemory()))

await Effect.runPromise(program)
