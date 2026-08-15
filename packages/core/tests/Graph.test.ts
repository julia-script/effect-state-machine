import { assert, describe, it } from "@effect/vitest"
import * as Fn from "effect/Function"
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

const definition = counter.define(
  {
    id: "counter",
    description: "A graphable counter protocol.",
    initial: (input) => {
      initializerCalls += 1
      return { _tag: "Active", count: input.count }
    },
  },
  {
    Active: counter.state({
      Pause: {
        target: "Paused",
        description: "Preserve the count while pausing.",
        reduce: ({ state }) => ({ _tag: "Paused", count: state.count }),
      },
    }),
    Paused: counter.state({
      Resume: {
        target: "Active",
        reduce: ({ state }) => ({ _tag: "Active", count: state.count }),
      },
    }),
  },
)

describe("Graph", () => {
  it("derives renderer-independent topology and descriptions without running the machine", () => {
    assert.strictEqual(initializerCalls, 0)
    const graph = Graph.fromDefinition(definition)
    assert.match(graph.nodes[0]?.location?.file ?? "", /tests\/Graph\.test\.ts$/)
    const withoutLocations = JSON.parse(
      JSON.stringify(graph, (key, value) => (key === "location" ? undefined : value)),
    )
    assert.deepStrictEqual(withoutLocations, {
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
          id: "Active:Pause:0:Paused:0",
          source: "Active",
          target: "Paused",
          event: {
            tag: "Pause",
            description: "Pause counter updates.",
          },
          description: "Preserve the count while pausing.",
        },
        {
          id: "Paused:Resume:0:Active:1",
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

  it("projects cyclic graphs by outgoing depth while preserving identity and order", () => {
    const node = (id: string): Graph.Node => ({ id, title: id, kind: "state" })
    const graph: Graph.Graph = {
      id: "cyclic",
      nodes: [node("A"), node("B"), node("C"), node("D")],
      edges: [
        { id: "a-b", source: "A", target: "B" },
        { id: "a-a", source: "A", target: "A" },
        { id: "b-c", source: "B", target: "C" },
        { id: "c-a", source: "C", target: "A" },
        { id: "d-a", source: "D", target: "A" },
      ],
      ignores: [],
    }

    const one = Graph.focus(graph, "A", 1)
    assert.deepStrictEqual(
      one.nodes.map(({ id }) => id),
      ["A", "B"],
    )
    assert.deepStrictEqual(
      one.edges.map(({ id }) => id),
      ["a-b", "a-a"],
    )

    const two = Graph.focus(graph, "A", 2)
    const piped = Fn.pipe(graph, Graph.focus("A", 2))
    assert.deepStrictEqual(piped, two)
    assert.deepStrictEqual(
      two.nodes.map(({ id }) => id),
      ["A", "B", "C"],
    )
    assert.deepStrictEqual(
      two.edges.map(({ id }) => id),
      ["a-b", "a-a", "b-c", "c-a"],
    )
    assert.strictEqual(Graph.focus(graph, "A", "full"), graph)
    assert.deepStrictEqual(Graph.focus(graph, "missing", 1).nodes, [])

    assert.deepStrictEqual(Graph.activity(two, "C", [{ source: "A", target: "B" }]), {
      activeNode: "C",
      traversedEdges: ["a-b"],
    })
    assert.deepStrictEqual(
      Fn.pipe(two, Graph.activity("C", [{ source: "A", target: "B" }])),
      {
        activeNode: "C",
        traversedEdges: ["a-b"],
      },
    )
  })
})
