/** Compile-time rejection evidence for the throwaway public API prototype. */
import { Schema } from "effect"
import { Machine } from "./machine"

const Input = Schema.Struct({})
const State = Schema.TaggedUnion({
  A: { value: Schema.String },
  B: { value: Schema.String },
  C: { value: Schema.String },
})
const Event = Schema.TaggedUnion({
  Go: {},
  Forward: { value: Schema.String },
})

const parent = Machine.builder({ input: Input, state: State, event: Event })

parent.state("A", {
  on: {
    // @ts-expect-error Transition targets must be state tags declared by the State Schema.
    Go: {
      target: "Missing",
      reduce: ({ state }) => ({ _tag: "A", value: state.value }),
    },
  },
})

parent.state("A", {
  on: {
    // @ts-expect-error A reducer must return the state variant named by its target.
    Go: {
      target: "B",
      reduce: ({ state }) => ({ _tag: "C", value: state.value }),
    },
  },
})

parent.state("A", {
  on: {
    Go: {
      branches: [
        {
          when: { name: "first guard", guard: () => true },
          target: "B",
          reduce: ({ state }) => ({ _tag: "B", value: state.value }),
        },
        {
          // @ts-expect-error An otherwise branch is optional, but when present it must be last.
          otherwise: true,
          target: "C",
          reduce: ({ state }) => ({ _tag: "C", value: state.value }),
        },
        {
          when: { name: "unreachable guard", guard: () => true },
          target: "B",
          reduce: ({ state }) => ({ _tag: "B", value: state.value }),
        },
      ],
    },
  },
})

const ChildInput = Schema.Struct({})
const ChildState = Schema.TaggedUnion({ Done: {} })
const ChildEvent = Schema.TaggedUnion({ Forward: { value: Schema.Number } })
const child = Machine.builder({
  input: ChildInput,
  state: ChildState,
  event: ChildEvent,
})
const childDefinition = child.make({
  id: "incompatible-child-protocol",
  initial: () => ({ _tag: "Done" }),
  nodes: [child.final("Done")],
})

parent.child("A", {
  name: "incompatible child forwarding",
  machine: childDefinition,
  input: () => ({}),
  forward: [
    // @ts-expect-error A parent event payload must satisfy the child's event Schema type.
    "Forward",
  ],
  onDone: {
    target: "A",
    reduce: ({ state }) => ({ _tag: "A", value: state.value }),
  },
})
