/** Compile-time rejection evidence for the statechart-syntax prototype. */
import { Effect, Schema } from "effect"
import { Machine } from "./machine"

const Input = Schema.Struct({})

const Mode = Schema.TaggedUnion({
  On: {},
  Off: { since: Schema.Number },
})

const State = Schema.TaggedUnion({
  A: { value: Schema.String },
  B: { value: Schema.String, mode: Mode },
  C: { value: Schema.String },
})

const Event = Schema.TaggedUnion({
  Go: {},
  Toggle: { at: Schema.Number },
})

const machine = Machine.builder({ input: Input, state: State, event: Event })

// The states record is exhaustive: every state tag must have a node.
machine.make({
  id: "missing-state",
  initial: () => ({ _tag: "A", value: "" }),
  // @ts-expect-error State C is declared by the Schema but has no node.
  states: {
    A: { on: { Go: { target: "A", reduce: ({ state }) => ({ value: state.value }) } } },
    B: { final: true },
  },
})

machine.make({
  id: "missing-target",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: {
      on: {
        // @ts-expect-error Transition targets must be state tags declared by the Schema.
        Go: { target: "Missing", reduce: ({ state }) => ({ value: state.value }) },
      },
    },
    B: { final: true },
    C: { final: true },
  },
})

// DOCUMENTED ALLOWANCE, not a rejection: excess-property checking does not
// apply in return position (verified against TypeScript 7.0.2), so a stray
// `_tag` in a reducer compiles — even a WRONG one. This must stay legal
// because `{ ...state }` spreads carry `_tag` too. The interpreter therefore
// always writes the committed tag from `target`; a returned `_tag` is dead
// data by contract, never by type error.
machine.make({
  id: "tag-in-reducer-is-inert",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: {
      on: {
        Go: { target: "C", reduce: ({ state }) => ({ _tag: "B", value: state.value }) },
      },
    },
    B: { final: true },
    C: { final: true },
  },
})

machine.make({
  id: "wrong-fields",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: {
      on: {
        // @ts-expect-error A reducer must return the fields of its target state.
        Go: { target: "B", reduce: ({ state }) => ({ value: state.value }) },
      },
    },
    B: { final: true },
    C: { final: true },
  },
})

machine.make({
  id: "final-with-handlers",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: { on: {} },
    B: { final: true },
    // @ts-expect-error A final state cannot also handle events.
    C: { final: true, on: { Go: { ignore: {} } } },
  },
})

machine.make({
  id: "region-on-plain-field",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: { on: {} },
    B: {
      regions: {
        // @ts-expect-error Only tagged-union fields of the state are region-eligible.
        value: { states: {} },
      },
    },
    C: { final: true },
  },
})

machine.make({
  id: "region-wrong-fields",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: { on: {} },
    B: {
      regions: {
        mode: {
          states: {
            On: {
              on: {
                // @ts-expect-error A region reducer returns REGION fields, not parent fields.
                Toggle: { target: "Off", reduce: ({ parent }) => ({ value: parent.value }) },
              },
            },
            Off: { on: {} },
          },
        },
      },
    },
    C: { final: true },
  },
})

machine.make({
  id: "region-target-outside-region",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: { on: {} },
    B: {
      regions: {
        mode: {
          states: {
            On: {
              on: {
                // @ts-expect-error Region transitions target region tags, not machine states.
                Toggle: { target: "C", reduce: () => ({ since: 0 }) },
              },
            },
            Off: { on: {} },
          },
        },
      },
    },
    C: { final: true },
  },
})

machine.make({
  id: "all-task-results-are-keyed",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: {
      invoke: ($) =>
        $.all({
          name: "join",
          tasks: {
            left: { effect: () => Effect.succeed("left") },
            right: { effect: () => Effect.succeed(2) },
          },
          onSuccess: {
            target: "C",
            // @ts-expect-error The joined value is keyed by task name; `middle` does not exist.
            reduce: ({ value }) => ({ value: value.middle }),
          },
          onFailure: { target: "B", reduce: () => ({ value: "", mode: { _tag: "On" } }) },
        }),
    },
    B: { final: true },
    C: { final: true },
  },
})

machine.make({
  id: "stay-shorthand-keeps-current-fields",
  initial: () => ({ _tag: "A", value: "" }),
  states: {
    A: {
      on: {
        // @ts-expect-error The stay shorthand returns the CURRENT state's fields.
        Go: ({ state }) => ({ since: 1 }),
      },
    },
    B: { final: true },
    C: { final: true },
  },
})
