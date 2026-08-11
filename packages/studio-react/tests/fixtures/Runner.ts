import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {} },
  Running: { fields: { speed: Schema.Number } },
  Done: { fields: {} },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number } },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: Input, state: State, event: Event })

export const definition = runner.make({
  id: "embedded-runner",
  initial: () => ({ _tag: "Idle" }),
  nodes: [
    runner.state("Idle", {
      on: {
        Start: {
          target: "Running",
          reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
        },
      },
    }),
    runner.state("Running", {
      on: { Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) } },
    }),
    runner.final("Done"),
  ],
})
