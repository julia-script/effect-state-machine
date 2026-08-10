import { useAtom, useAtomValue } from "@effect/atom-react"
import {
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  ViewportPortal,
} from "@xyflow/react"
import type { Graph } from "effect-state-machine/devtools"
import * as React from "react"
import { type ElkPlacement, edgeLabelText, layout } from "../lib/elkLayout.js"
import { focus, NODE_HEIGHT, toJson } from "../lib/layout.js"
import { depthAtom, displayedPositionAtom, graphJsonAtom } from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { DetailCard, type Selection } from "./DetailCard.js"
import { ElkEdge } from "./flow/ElkEdge.js"
import { StateNode } from "./flow/StateNode.js"
import "@xyflow/react/dist/style.css"

const nodeTypes = { state: StateNode }
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
  const [selection, setSelection] = React.useState<Selection | undefined>(undefined)
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

  const graphSignature = `${session.sessionId}:${depth}:${visible.nodes
    .map((node) => node.id)
    .join(",")}`

  // ELK layout is async; keep the previous placement while the next computes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: layout keyed by shape signature
  React.useEffect(() => {
    let stale = false
    void layout(visible).then((next) => {
      if (!stale) setPlaced(next)
    })
    return () => {
      stale = true
    }
  }, [graphSignature])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refit when the layout changes
  React.useEffect(() => {
    if (placed === undefined) return
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.1, maxZoom: 1.15 })
    })
    return () => cancelAnimationFrame(frame)
  }, [placed])

  const nodes: Array<Node> = visible.nodes.flatMap((node) => {
    const point = placed?.positions.get(node.id)
    if (point === undefined) return []
    return [
      {
        id: node.id,
        type: "state",
        position: point,
        data: { node, active: node.id === activeTag, initial: node.id === initialTag },
        draggable: false,
        connectable: false,
      },
    ]
  })

  const edges: Array<Edge> = visible.edges.flatMap((edge) => {
    const route = placed?.routes.get(edge.id)
    if (route === undefined || route.points.length < 2) return []
    const mid = route.points[Math.floor(route.points.length / 2)]
    const labelX = route.label !== undefined ? route.label.x + route.label.width / 2 : mid.x
    const labelY = route.label !== undefined ? route.label.y + route.label.height / 2 : mid.y
    return [
      {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "elk",
        markerEnd: "url(#studio-arrow)",
        data: {
          points: route.points,
          label: edgeLabelText(edge),
          labelX,
          labelY,
          traversed: traversedEdge?.id === edge.id,
          onSelect: () =>
            setSelection((current) =>
              current?.kind === "edge" && current.id === edge.id
                ? undefined
                : { kind: "edge", id: edge.id },
            ),
        },
      },
    ]
  })

  const anchor =
    selection === undefined
      ? undefined
      : placed?.positions.get(
          selection.kind === "node"
            ? selection.id
            : (visible.edges.find((edge) => edge.id === selection.id)?.source ?? ""),
        )

  return (
    <div className="relative min-w-0 flex-1">
      {showJson ? (
        <pre className="h-full overflow-auto bg-surface p-4 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(toJson(graph), null, 2)}
        </pre>
      ) : (
        <div className="dot-grid h-full bg-surface">
          {/* Shared arrowhead that inherits each edge's stroke via context-stroke. */}
          <svg width="0" height="0" aria-hidden="true">
            <defs>
              <marker
                id="studio-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
              </marker>
            </defs>
          </svg>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={0.2}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: false }}
            style={{ background: "transparent" }}
            onNodeClick={(_, node) =>
              setSelection((current) =>
                current?.kind === "node" && current.id === node.id
                  ? undefined
                  : { kind: "node", id: node.id },
              )
            }
            onPaneClick={() => setSelection(undefined)}
          >
            {selection === undefined || anchor === undefined || placed === undefined ? null : (
              <ViewportPortal>
                <div
                  style={{
                    position: "absolute",
                    left: anchor.x,
                    top: anchor.y + NODE_HEIGHT + 8,
                    transform: `scale(${1 / zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <DetailCard
                    graph={visible}
                    session={session}
                    selection={selection}
                    onClose={() => setSelection(undefined)}
                  />
                </div>
              </ViewportPortal>
            )}
          </ReactFlow>
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
