import * as Schema from "effect/Schema"
import * as Machine from "../../src/Machine.js"

const CounterInput = Schema.Struct({ count: Schema.Number })
const Active = Schema.TaggedStruct("Active", { count: Schema.Number }).annotate({
  title: "Active",
  description: "Accepts counter updates.",
})
const Paused = Schema.TaggedStruct("Paused", { count: Schema.Number }).annotate({
  title: "Paused",
  description: "Keeps the counter stable until resumed.",
})
const CounterState = Schema.Union([Active, Paused])
const Increment = Schema.TaggedStruct("Increment", { amount: Schema.Number })
const Pause = Schema.TaggedStruct("Pause", {})
const Resume = Schema.TaggedStruct("Resume", {})
const CounterEvent = Schema.Union([Increment, Pause, Resume])

const counter = Machine.builder({ input: CounterInput, state: CounterState, event: CounterEvent })

export const counterDefinition = counter.make({
  id: "counter",
  description: "A minimal serialized counter protocol.",
  initial: (input) => ({ _tag: "Active", count: input.count }),
  nodes: [
    counter.state("Active", {
      on: {
        Increment: {
          target: "Active",
          reduce: ({ state, event }) => ({ _tag: "Active", count: state.count + event.amount }),
        },
        Pause: {
          target: "Paused",
          reduce: ({ state }) => ({ _tag: "Paused", count: state.count }),
        },
      },
    }),
    counter.state("Paused", {
      on: {
        Resume: {
          target: "Active",
          reduce: ({ state }) => ({ _tag: "Active", count: state.count }),
        },
      },
    }),
  ],
})
