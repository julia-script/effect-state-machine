import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {}, description: "Waiting for a start event." },
  Running: { fields: { speed: Schema.Number } },
  Done: { fields: {} },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number }, description: "Begin running." },
  Stop: { fields: {} },
})

const runner = Machine.builder({ input: Input, state: State, event: Event })

export const definition = runner.define(
  {
    id: "runner",
    initial: () => ({ _tag: "Idle" }),
  },
  {
    Idle: runner.state({
      Start: {
        target: "Running",
        reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
      },
    }),
    Running: runner.state({
      Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) },
    }),
    Done: runner.final(),
  },
)
