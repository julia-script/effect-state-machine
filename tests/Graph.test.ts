import { assert, describe, it } from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import * as Mermaid from "../src/Mermaid.js"

const Input = Schema.Struct({ count: Schema.Number }).annotate({
  description: "The initial counter value.",
})

const State = Machine.taggedUnion({
  Active: {
    fields: { count: Schema.Number },
    title: "Active counter",
    description: "Accepts counter updates.",
  },
  Paused: {
    fields: { count: Schema.Number },
    title: "Paused counter",
    description: "Waits until work resumes.",
  },
})

const Pause = Schema.TaggedStruct("Pause", {}).annotate({
  description: "Pause counter updates.",
})

const Resume = Schema.TaggedStruct("Resume", {}).annotate({
  description: "Resume counter updates.",
})

const Event = Schema.Union([Pause, Resume])
const counter = Machine.builder({ input: Input, state: State, event: Event })
let initializerCalls = 0

const definition = counter.make({
  id: "counter",
  description: "A graphable counter protocol.",
  initial: (input) => {
    initializerCalls += 1
    return { _tag: "Active", count: input.count }
  },
  nodes: [
    counter.state("Active", {
      on: {
        Pause: {
          target: "Paused",
          description: "Preserve the count while pausing.",
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

describe("Graph", () => {
  it("derives renderer-independent topology and descriptions without running the machine", () => {
    assert.strictEqual(initializerCalls, 0)
    assert.deepStrictEqual(Graph.fromDefinition(definition), {
      id: "counter",
      description: "A graphable counter protocol.",
      nodes: [
        {
          id: "Active",
          title: "Active counter",
          description: "Accepts counter updates.",
          kind: "state",
        },
        {
          id: "Paused",
          title: "Paused counter",
          description: "Waits until work resumes.",
          kind: "state",
        },
      ],
      edges: [
        {
          source: "Active",
          target: "Paused",
          event: {
            tag: "Pause",
            description: "Pause counter updates.",
          },
          description: "Preserve the count while pausing.",
        },
        {
          source: "Paused",
          target: "Active",
          event: {
            tag: "Resume",
            description: "Resume counter updates.",
          },
        },
      ],
      ignores: [],
    })
    assert.strictEqual(initializerCalls, 0)
  })

  it("renders a compact Mermaid view from the graph model", () => {
    const graph = Graph.fromDefinition(definition)

    assert.strictEqual(
      Mermaid.render(graph),
      [
        "stateDiagram-v2",
        '  state "Active counter" as Active',
        '  state "Paused counter" as Paused',
        "  Active --> Paused: Pause",
        "  Paused --> Active: Resume",
      ].join("\n"),
    )
  })
})
