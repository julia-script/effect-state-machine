import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { LargeMachine } from "../examples/LargeMachine.js"
import * as DevToolsSession from "../src/DevToolsSession.js"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"

describe("large session fixture", () => {
  it("keeps default projections bounded while retaining an explicit full graph", () => {
    const graph = Graph.fromDefinition(LargeMachine.definition)
    assert.strictEqual(graph.nodes.length, 100)
    assert.strictEqual(graph.edges.length, 400)
    assert.ok(Graph.focus(graph, "State0", 1).nodes.length <= 4)
    assert.ok(Graph.focus(graph, "State0", 2).nodes.length <= 10)
    assert.strictEqual(Graph.focus(graph, "State0", "full"), graph)
    assert.deepStrictEqual(
      Graph.focus(graph, "State0", 2).nodes.map(({ id }) => id),
      Graph.focus(graph, "State0", 2).nodes.map(({ id }) => id),
    )
  })

  it.effect("keeps noisy raw activity behind compact semantic steps", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(LargeMachine.definition, {})
        const session = yield* DevToolsSession.attach({
          definition: LargeMachine.definition,
          handle,
        })
        for (let index = 0; index < 30; index += 1) {
          yield* handle.send(index % 4 === 0 ? { _tag: "Skip" } : { _tag: "Next" })
        }
        const view = yield* session.changes.pipe(
          Stream.filter(
            (candidate) => candidate.liveHead === 30 && candidate.history.raw.length === 91,
          ),
          Stream.runHead,
        )
        assert.strictEqual(view._tag, "Some")
        if (view._tag === "Some") {
          assert.strictEqual(view.value.history.semantic.length, 31)
          assert.strictEqual(view.value.history.raw.length, 91)
          assert.ok(view.value.focus.graph.nodes.length <= 4)
        }
      }),
    ),
  )
})
