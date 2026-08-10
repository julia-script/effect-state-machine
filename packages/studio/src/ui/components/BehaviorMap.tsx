import { useAtom, useAtomValue } from "@effect/atom-react"
import {
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
} from "@xyflow/react"
import type { Graph } from "effect-state-machine/devtools"
import * as React from "react"
import {
  type ElkPlacement,
  edgeIdOfTransition,
  isTransitionNodeId,
  layout,
  START_ID,
} from "../lib/elkLayout.js"
import { focus, toJson } from "../lib/layout.js"
import {
  depthAtom,
  displayedPositionAtom,
  graphJsonAtom,
  type MapSelection,
  selectionAtom,
} from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { ElkEdge } from "./flow/ElkEdge.js"
import { StartNode } from "./flow/StartNode.js"
import { StateNode } from "./flow/StateNode.js"
import { TransitionNode } from "./flow/TransitionNode.js"
import "@xyflow/react/dist/style.css"

const nodeTypes = { state: StateNode, transition: TransitionNode, start: StartNode }
const edgeTypes = { elk: ElkEdge }

export function BehaviorMap({ session }: { readonly session: ViewerClient.SessionView }) {
  return (
    <ReactFlowProvider>
      <FlowInner session={session} />
    </ReactFlowProvider>
  )
}

function FlowInner({ session }: { readonly session: ViewerClient.SessionView }) {
  const displayed = useAtomValue(displayedPositionAtom)
  const [depth, setDepth] = useAtom(depthAtom(session.sessionId))
  const [showJson, setShowJson] = useAtom(graphJsonAtom(session.sessionId))
  const [selection, setSelection] = useAtom(selectionAtom(session.sessionId))
  const [placed, setPlaced] = React.useState<ElkPlacement | undefined>(undefined)
  const flow = useReactFlow()
  const { zoom } = useViewport()

  const graph = session.hello.graph as Graph.Graph
  const history = session.history
  const initialTag = history.positions[0]?.stateTag
  const activeTag = displayed === undefined ? undefined : history.positions[displayed]?.stateTag
  const visible = focus(graph, activeTag, depth === "all" ? "all" : depth)

  const traversedStep = history.steps.find(
    (step) =>
      step.committedPosition !== undefined &&
      step.committedPosition === displayed &&
      step.sourceStateTag !== undefined &&
      step.targetStateTag !== undefined,
  )
  const traversedEdge = visible.edges.find(
    (edge) =>
      traversedStep !== undefined &&
      edge.source === traversedStep.sourceStateTag &&
      edge.target === traversedStep.targetStateTag &&
      (traversedStep.eventTag === undefined || edge.event?.tag === traversedStep.eventTag) &&
      (traversedStep.branch === undefined || edge.branch?.index === traversedStep.branch.index),
  )

  // The whole machine is laid out once per session; depth only hides nodes,
  // so positions stay put while the machine moves through states.
  const layoutSignature = `${session.sessionId}:${initialTag ?? ""}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: layout keyed per session
  React.useEffect(() => {
    let stale = false
    void layout(graph, initialTag).then((next) => {
      if (!stale) setPlaced(next)
    })
    return () => {
      stale = true
    }
  }, [layoutSignature])

  // When the visible cluster changes, the camera glides to it instead.
  const visibleSignature = visible.nodes.map((node) => node.id).join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit on visibility change
  React.useEffect(() => {
    if (placed === undefined) return
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.1, maxZoom: 1.15, duration: 300 })
    })
    return () => cancelAnimationFrame(frame)
  }, [placed, visibleSignature])

  // Direction relative to the selected state: edges leaving it vs entering it.
  const highlightFor = new Map<string, "in" | "out">()
  if (selection?.kind === "node") {
    for (const edge of visible.edges) {
      if (edge.source === selection.id) highlightFor.set(edge.id, "out")
      else if (edge.target === selection.id) highlightFor.set(edge.id, "in")
    }
  }

  const stateNodes: Array<Node> = visible.nodes.flatMap((node) => {
    const point = placed?.positions.get(node.id)
    if (point === undefined) return []
    return [
      {
        id: node.id,
        type: "state",
        position: point,
        data: {
          node,
          active: node.id === activeTag,
          selected: selection?.kind === "node" && selection.id === node.id,
        },
        draggable: false,
        connectable: false,
      },
    ]
  })

  const transitionNodes: Array<Node> = visible.edges.flatMap((edge) => {
    const placement = placed?.transitions.get(edge.id)
    if (placement === undefined) return []
    return [
      {
        id: `t:${edge.id}`,
        type: "transition",
        position: placement.point,
        data: {
          label: placement.label,
          traversed: traversedEdge?.id === edge.id,
          highlight: highlightFor.get(edge.id),
          selected: selection?.kind === "edge" && selection.id === edge.id,
        },
        draggable: false,
        connectable: false,
      },
    ]
  })

  const initialVisible =
    initialTag !== undefined && visible.nodes.some((node) => node.id === initialTag)
  const startPoint = initialVisible ? placed?.positions.get(START_ID) : undefined
  const startNodes: Array<Node> =
    startPoint === undefined
      ? []
      : [
          {
            id: START_ID,
            type: "start",
            position: startPoint,
            data: {},
            draggable: false,
            connectable: false,
            selectable: false,
          },
        ]

  const nodes = [...startNodes, ...stateNodes, ...transitionNodes]

  const edges: Array<Edge> = visible.edges.flatMap((edge) => {
    const inbound = placed?.segments.get(`${edge.id}:in`)
    const outbound = placed?.segments.get(`${edge.id}:out`)
    const traversed = traversedEdge?.id === edge.id
    const edgeSelected = selection?.kind === "edge" && selection.id === edge.id
    const segment = (
      suffix: "in" | "out",
      points: ReadonlyArray<{ x: number; y: number }> | undefined,
      endpoints: { source: string; target: string },
    ): Array<Edge> =>
      points === undefined || points.length < 2
        ? []
        : [
            {
              id: `${edge.id}:${suffix}`,
              source: endpoints.source,
              target: endpoints.target,
              type: "elk",
              data: {
                points,
                traversed,
                // A selected pill shows where it comes from vs where it goes.
                highlight: edgeSelected ? suffix : highlightFor.get(edge.id),
                arrow: true,
              },
            },
          ]
    return [
      ...segment("in", inbound, { source: edge.source, target: `t:${edge.id}` }),
      ...segment("out", outbound, { source: `t:${edge.id}`, target: edge.target }),
    ]
  })

  const startSegment = initialVisible ? placed?.segments.get(START_ID) : undefined
  const startEdges: Array<Edge> =
    startSegment === undefined || initialTag === undefined
      ? []
      : [
          {
            id: START_ID,
            source: START_ID,
            target: initialTag,
            type: "elk",
            data: { points: startSegment, traversed: false, highlight: undefined, arrow: true },
          },
        ]
  const allEdges = [...startEdges, ...edges]

  return (
    <div className="relative min-w-0 flex-1">
      {showJson ? (
        <pre className="h-full overflow-auto bg-surface p-4 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(toJson(graph), null, 2)}
        </pre>
      ) : (
        <div className="dot-grid h-full bg-surface">
          <ReactFlow
            nodes={nodes}
            edges={allEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={0.2}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: false }}
            style={{ background: "transparent" }}
            onNodeClick={(_, node) => {
              const next: MapSelection = isTransitionNodeId(node.id)
                ? { kind: "edge", id: edgeIdOfTransition(node.id) }
                : { kind: "node", id: node.id }
              setSelection((current) =>
                current?.kind === next.kind && current.id === next.id ? undefined : next,
              )
            }}
            onPaneClick={() => setSelection(undefined)}
          ></ReactFlow>
        </div>
      )}

      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-ink bg-surface px-3 py-1 shadow-hard-sm">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">DEPTH</span>
        <button
          type="button"
          className="font-mono text-[11px] font-bold"
          onClick={() => setDepth(depth === "all" ? 2 : Math.max(1, (depth as number) - 1))}
        >
          −
        </button>
        <span className="font-mono text-[11px]">{depth === "all" ? "·" : depth}</span>
        <button
          type="button"
          className="font-mono text-[11px] font-bold"
          onClick={() => setDepth(depth === "all" ? 1 : Math.min(9, (depth as number) + 1))}
        >
          +
        </button>
        <span className="text-rule">|</span>
        <button
          type="button"
          className={`font-mono text-[10px] font-bold ${depth === "all" ? "text-focus underline" : "text-muted"}`}
          onClick={() => setDepth("all")}
        >
          All
        </button>
        <span className="text-rule">|</span>
        <button
          type="button"
          className={`font-mono text-[10px] font-bold ${showJson ? "text-focus underline" : "text-muted"}`}
          onClick={() => setShowJson(!showJson)}
        >
          {"{ } JSON"}
        </button>
      </div>

      {showJson ? null : (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full border border-ink bg-surface px-3 py-1 shadow-hard-sm">
          <button
            type="button"
            className="font-mono text-[12px] font-bold"
            onClick={() => void flow.zoomOut()}
          >
            −
          </button>
          <span className="font-mono text-[10px]">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="font-mono text-[12px] font-bold"
            onClick={() => void flow.zoomIn()}
          >
            +
          </button>
          <button
            type="button"
            className="font-mono text-[10px] font-bold"
            onClick={() => void flow.fitView({ padding: 0.1, maxZoom: 1.15 })}
          >
            Fit
          </button>
        </div>
      )}
    </div>
  )
}
