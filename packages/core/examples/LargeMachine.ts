import * as Schema from "effect/Schema"
import * as Machine from "../src/Machine.js"

const size = 100
const tags = Array.from({ length: size }, (_, index) => `State${index}`)
const State = Machine.taggedUnion(
  Object.fromEntries(tags.map((tag) => [tag, { fields: {}, description: `Synthetic ${tag}.` }])),
)
const Event = Machine.taggedUnion({
  Next: { fields: {}, description: "Advance one state." },
  Skip: { fields: {}, description: "Advance seven states." },
  Reset: { fields: {}, description: "Return to the first state." },
  Stay: { fields: {}, description: "Exercise a self-transition." },
})
const large = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
const target = (index: number) => tags[(index + size) % size]

export const definition = large.define(
  {
    id: "large-synthetic-machine",
    description: "A deterministic 100-state graph with branching, cycles, and self-transitions.",
    initial: () => ({ _tag: tags[0] }),
  },
  Object.fromEntries(
    tags.map((tag, index) => [
      tag,
      large.state({
        Next: { target: target(index + 1), reduce: () => ({ _tag: target(index + 1) }) },
        Skip: { target: target(index + 7), reduce: () => ({ _tag: target(index + 7) }) },
        Reset: { target: tags[0], reduce: () => ({ _tag: tags[0] }) },
        Stay: { target: tag, reduce: () => ({ _tag: tag }) },
      }),
    ]),
  ),
)

export const LargeMachine = { State, Event, definition, size } as const
