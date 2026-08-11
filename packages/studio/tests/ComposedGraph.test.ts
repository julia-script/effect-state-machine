import type { Protocol } from "@effect-state-machine/studio-client"
import { assert, describe, it } from "@effect/vitest"
import { composeDefinitions, edgeId, nodeId } from "../src/ui/lib/composedGraph.js"
import { layout, startId } from "../src/ui/lib/elkLayout.js"

const descriptor = (
  definitionPath: string,
  machineId: string,
  children: Protocol.DefinitionDescriptorMessage["children"] = [],
): Protocol.DefinitionDescriptorMessage => ({
  definitionPath,
  machine: { id: machineId },
  graph: {
    id: machineId,
    nodes: [
      { id: "Idle", title: "Idle", kind: "state" },
      { id: "Done", title: "Done", kind: "final" },
    ],
    edges: [{ id: "finish", source: "Idle", target: "Done", event: { tag: "Finish" } }],
    ignores: [],
  },
  jsonSchemas: { states: {}, events: {} },
  quickEvents: [],
  children,
})

describe("composed machine graph", () => {
  const definitions = [
    descriptor("root", "root", [
      { ownerStateTag: "Idle", invocation: "first", definitionPath: "root/first" },
      { ownerStateTag: "Done", invocation: "second", definitionPath: "root/second" },
    ]),
    descriptor("root/first", "reused", [
      {
        ownerStateTag: "Idle",
        invocation: "grandchild",
        definitionPath: "root/first/grandchild",
      },
    ]),
    descriptor("root/second", "reused"),
    descriptor("root/first/grandchild", "grandchild"),
  ]

  it("qualifies repeated tags and reused definitions by structural path", () => {
    const composed = composeDefinitions(definitions)
    assert.ok(composed.nodes.has(nodeId("root/first", "Idle")))
    assert.ok(composed.nodes.has(nodeId("root/second", "Idle")))
    assert.notStrictEqual(nodeId("root/first", "Idle"), nodeId("root/second", "Idle"))
    assert.ok(composed.edges.has(edgeId("root/first/grandchild", "finish")))
    assert.deepStrictEqual(
      composed.regions.map((region) => region.depth),
      [0, 1, 1, 2],
    )
    assert.strictEqual(composed.initialNodeIds.size, 4)
  })

  it("lays out start markers for active and inactive definitions", async () => {
    const composed = composeDefinitions(definitions)
    const placed = await layout(composed.graph, composed.initialNodeIds)
    for (const path of composed.initialNodeIds.keys()) {
      assert.ok(placed.positions.has(startId(path)))
    }
  })
})
