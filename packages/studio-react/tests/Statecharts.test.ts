import { assert, describe, it } from "@effect/vitest"
import type { History } from "@effect-state-machine/studio-client"
import type { Graph } from "effect-state-machine/devtools"
import { transitionSize } from "../src/lib/elkLayout.js"
import {
  acceptsEvent,
  activeStateNodeIds,
  edgesForStep,
  focusMany,
  nodeSize,
} from "../src/lib/layout.js"
import { nodeFacts, nodeKindLabel } from "../src/lib/nodePresentation.js"

const graph: Graph.Graph = {
  id: "player",
  nodes: [
    {
      id: "Active",
      title: "Active",
      kind: "regions",
      regions: { slots: ["playback", "volume"] },
    },
    {
      id: "Active/playback/Playing",
      title: "Playing",
      kind: "state",
      region: { parent: "Active", slot: "playback", tag: "Playing" },
      timer: { duration: "500 millis", targets: ["Active/playback/Paused"] },
    },
    {
      id: "Active/playback/Paused",
      title: "Paused",
      kind: "state",
      region: { parent: "Active", slot: "playback", tag: "Paused" },
    },
    {
      id: "Active/volume/Audible",
      title: "Audible",
      kind: "state",
      region: { parent: "Active", slot: "volume", tag: "Audible" },
    },
    {
      id: "Active/volume/Muted",
      title: "Muted",
      kind: "state",
      region: { parent: "Active", slot: "volume", tag: "Muted" },
    },
    {
      id: "Joining",
      title: "Joining",
      kind: "invoke",
      invocation: {
        name: "join",
        kind: "all",
        lanes: ["left", "right"],
        concurrency: 2,
        retry: { name: "spaced" },
      },
    },
  ],
  edges: [
    {
      id: "playback",
      source: "Active/playback/Playing",
      target: "Active/playback/Paused",
      event: { tag: "Toggle" },
    },
    {
      id: "volume",
      source: "Active/volume/Audible",
      target: "Active/volume/Muted",
      event: { tag: "Toggle" },
    },
    {
      id: "timer",
      source: "Active/playback/Playing",
      target: "Active/playback/Paused",
      outcome: { kind: "timer" },
    },
  ],
  ignores: [],
}

describe("Studio statechart presentation", () => {
  const step = (transitions: History.Step["transitions"]): History.Step => ({
    index: 0,
    sequence: 0,
    actorId: "actor:0",
    definitionPath: "root",
    depth: 0,
    kind: "event",
    title: "Toggle",
    statePosition: 0,
    transitions,
    raw: [],
  })

  it("derives every active region child from the committed parent state", () => {
    const active = activeStateNodeIds(graph, {
      _tag: "Active",
      playback: { _tag: "Playing" },
      volume: { _tag: "Muted" },
    })
    assert.deepStrictEqual(active, ["Active", "Active/playback/Playing", "Active/volume/Muted"])
    assert.deepStrictEqual(
      focusMany(graph, active, 1).nodes.map(({ id }) => id),
      [
        "Active",
        "Active/playback/Playing",
        "Active/playback/Paused",
        "Active/volume/Audible",
        "Active/volume/Muted",
      ],
    )
  })

  it("accepts events declared by active region children and child forwarding", () => {
    const state = {
      _tag: "Active",
      playback: { _tag: "Playing" },
      volume: { _tag: "Muted" },
    }
    assert.strictEqual(acceptsEvent(graph, state, "Toggle"), true)
    assert.strictEqual(acceptsEvent(graph, state, "Missing"), false)

    const childGraph: Graph.Graph = {
      id: "parent",
      nodes: [
        {
          id: "Resolving",
          title: "Resolving",
          kind: "child",
          child: {
            name: "resolve-conflict",
            definition: { id: "child", nodes: [], edges: [], ignores: [] },
            forwards: [
              {
                parentEvent: { tag: "Resolve" },
                childEvent: { tag: "Choose" },
              },
            ],
          },
        },
      ],
      edges: [],
      ignores: [],
    }
    assert.strictEqual(acceptsEvent(childGraph, { _tag: "Resolving" }, "Resolve"), true)
  })

  it("matches all sibling edges selected in one macrostep and timer outcomes", () => {
    const macrostep = step([
      {
        sourceStateTag: "Active/playback/Playing",
        targetStateTag: "Active/playback/Paused",
        eventTag: "Toggle",
        macrostep: 1,
      },
      {
        sourceStateTag: "Active/volume/Audible",
        targetStateTag: "Active/volume/Muted",
        eventTag: "Toggle",
        macrostep: 1,
      },
    ])
    assert.deepStrictEqual(
      edgesForStep(graph, macrostep).map(({ id }) => id),
      ["playback", "volume"],
    )

    const timer = step([
      {
        sourceStateTag: "Active/playback/Playing",
        targetStateTag: "Active/playback/Paused",
        eventTag: "@after",
      },
    ])
    assert.deepStrictEqual(
      edgesForStep(graph, timer).map(({ id }) => id),
      ["timer"],
    )
  })

  it("presents region, lane, concurrency, retry, and timer metadata", () => {
    const parent = graph.nodes[0]
    const playing = graph.nodes[1]
    const joining = graph.nodes[5]
    assert.ok(parent !== undefined)
    assert.ok(playing !== undefined)
    assert.ok(joining !== undefined)
    assert.strictEqual(nodeKindLabel(parent), "parallel · 2 regions")
    assert.deepStrictEqual(nodeFacts(playing), [
      { label: "Region", value: "Active / playback" },
      { label: "After", value: "500 millis → Active/playback/Paused" },
    ])
    assert.deepStrictEqual(nodeFacts(joining), [
      { label: "Work", value: "all · join" },
      { label: "Lanes", value: "left, right" },
      { label: "Concurrency", value: "2" },
      { label: "Retry", value: "spaced" },
    ])
  })

  it("reserves space for the readable graph typography", () => {
    const state = {
      id: "Readable",
      title: "Readable",
      kind: "state",
      description: "A description long enough to wrap onto a second readable line.",
    } satisfies Graph.Node
    const guarded = {
      id: "guarded",
      source: "Ready",
      target: "Even",
      event: { tag: "Decide" },
      branch: {
        kind: "guard",
        index: 1,
        name: "is-even",
        description: "Non-positive even values use the Even state.",
      },
    } satisfies Graph.Edge

    assert.deepStrictEqual(nodeSize(state), { width: 260, height: 88 })
    assert.deepStrictEqual(transitionSize(guarded), { width: 338.4, height: 64 })
  })
})
