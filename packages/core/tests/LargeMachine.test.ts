import { assert, describe, it } from "@effect/vitest"
import { LargeMachine } from "../examples/LargeMachine.js"
import * as Graph from "../src/Graph.js"

describe("large graph fixture", () => {
  it("keeps default projections bounded while retaining an explicit full graph", () => {
    const graph = Graph.fromDefinition(LargeMachine.definition)
    assert.strictEqual(graph.nodes.length, 100)
    assert.strictEqual(graph.edges.length, 400)
    assert.ok(Graph.focus(graph, "State0", 1).nodes.length <= 4)
    assert.ok(Graph.focus(graph, "State0", 2).nodes.length <= 10)
    assert.strictEqual(Graph.focus(graph, "State0", "full"), graph)
  })
})
