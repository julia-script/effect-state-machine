import { useAtom, useAtomValue } from "@effect/atom-react"
import { History } from "@effect-state-machine/studio-client"
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
import { edgeId, nodeId } from "../lib/composedGraph.js"
import {
  type ElkPlacement,
  edgeIdOfTransition,
  isTransitionNodeId,
  layout,
  startId,
} from "../lib/elkLayout.js"
import { activeStateNodeIds, edgesForStep, focusMany, nodeSize } from "../lib/layout.js"
import {
  depthAtom,
  displayedSequenceAtom,
  graphJsonAtom,
  type MapSelection,
  selectedActorIdAtom,
  selectedStepAtom,
  selectionAtom,
} from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { ElkEdge } from "./flow/ElkEdge.js"
import { MachineRegion } from "./flow/MachineRegion.js"
import { StartNode } from "./flow/StartNode.js"
import { StateNode } from "./flow/StateNode.js"
import { StateRegion } from "./flow/StateRegion.js"
import { TransitionNode } from "./flow/TransitionNode.js"

const nodeTypes = {
  state: StateNode,
  transition: TransitionNode,
  start: StartNode,
  machine: MachineRegion,
  region: StateRegion,
}
const edgeTypes = { elk: ElkEdge }

export function BehaviorMap({ session }: { readonly session: ViewerClient.SessionView }) {
  return (
    <ReactFlowProvider>
      <FlowInner session={session} />
    </ReactFlowProvider>
  )
}

function FlowInner({ session }: { readonly session: ViewerClient.SessionView }) {
  const sequence = useAtomValue(displayedSequenceAtom) ?? 0
  const [depth, setDepth] = useAtom(depthAtom(session.sessionId))
  const [showJson, setShowJson] = useAtom(graphJsonAtom(session.sessionId))
  const [selection, setSelection] = useAtom(selectionAtom(session.sessionId))
  const [selectedActorId, setSelectedActorId] = useAtom(selectedActorIdAtom(session.sessionId))
  const selectedStepIndex = useAtomValue(selectedStepAtom(session.sessionId))
  const [placed, setPlaced] = React.useState<ElkPlacement | undefined>(undefined)
  const flow = useReactFlow()
  const { zoom } = useViewport()

  const composed = session.composed
  const history = session.history
  const actorId = selectedActorId ?? history.rootActorId ?? session.hello.rootActorId
  const actor = history.actors.get(actorId)
  const activeActors = History.actorsAt(history, sequence)
  const activeByNode = new Map<string, Array<string>>()
  for (const liveActor of activeActors) {
    const position = History.positionAt(history, liveActor.actorId, sequence)
    if (position === undefined) continue
    const definition = composed.definitions.get(liveActor.definitionPath)
    if (definition === undefined) continue
    for (const localId of activeStateNodeIds(definition.graph as Graph.Graph, position.state)) {
      const id = nodeId(liveActor.definitionPath, localId)
      activeByNode.set(id, [...(activeByNode.get(id) ?? []), liveActor.actorId])
    }
  }

  const selectedPosition =
    actor === undefined ? undefined : History.positionAt(history, actor.actorId, sequence)
  const center =
    selection?.kind === "node"
      ? nodeId(selection.definitionPath, selection.id)
      : selectedPosition === undefined
        ? undefined
        : nodeId(selectedPosition.definitionPath, selectedPosition.stateTag)
  const centers = center === undefined ? Array.from(activeByNode.keys()) : [center]
  const visible = focusMany(composed.graph, centers, centers.length === 0 ? "all" : depth)

  const explicitlySelectedStep =
    selectedStepIndex === undefined ? undefined : history.steps[selectedStepIndex]
  const selectedStep =
    explicitlySelectedStep?.actorId === actorId
      ? explicitlySelectedStep
      : [...history.steps]
          .reverse()
          .find((step) => step.actorId === actorId && step.sequence <= sequence)
  const selectedDefinition =
    selectedStep === undefined ? undefined : composed.definitions.get(selectedStep.definitionPath)
  const traversedLocalEdges =
    selectedStep === undefined || selectedDefinition === undefined
      ? []
      : edgesForStep(selectedDefinition.graph as Graph.Graph, selectedStep)
  const traversedEdgeIds = new Set(
    selectedStep === undefined
      ? []
      : traversedLocalEdges.map((edge) => edgeId(selectedStep.definitionPath, edge.id)),
  )

  const layoutSignature = `${session.sessionId}:${session.hello.definitions
    .map((definition) => definition.definitionPath)
    .join("|")}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: definitions are immutable per hello
  React.useEffect(() => {
    let stale = false
    void layout(composed.graph, composed.initialNodeIds).then((next) => {
      if (!stale) setPlaced(next)
    })
    return () => {
      stale = true
    }
  }, [layoutSignature])

  const visibleSignature = visible.nodes.map((node) => node.id).join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: refit on visible graph changes
  React.useEffect(() => {
    if (placed === undefined) return
    const frame = requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.08, maxZoom: 1.05, duration: 300 })
    })
    return () => cancelAnimationFrame(frame)
  }, [placed, visibleSignature])

  const selectedQualifiedId =
    selection === undefined
      ? undefined
      : selection.kind === "node"
        ? nodeId(selection.definitionPath, selection.id)
        : edgeId(selection.definitionPath, selection.id)
  const highlighted = new Set<string>()
  if (selection?.kind === "node" && selectedQualifiedId !== undefined) {
    for (const edge of visible.edges) {
      if (edge.source === selectedQualifiedId) highlighted.add(edge.id)
    }
  }

  const stateNodes: Array<Node> = visible.nodes.flatMap((node) => {
    const point = placed?.positions.get(node.id)
    const metadata = composed.nodes.get(node.id)
    if (point === undefined || metadata === undefined) return []
    const activeNodeActors = activeByNode.get(node.id) ?? []
    return [
      {
        id: node.id,
        type: "state",
        position: point,
        data: {
          node: metadata.node,
          active: activeNodeActors.length > 0,
          activeActors: activeNodeActors,
          selected: selectedQualifiedId === node.id,
        },
        draggable: false,
        connectable: false,
        zIndex: 2,
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
          edge,
          label: placement.label,
          width: placement.width,
          height: placement.height,
          traversed: traversedEdgeIds.has(edge.id),
          highlight: highlighted.has(edge.id),
          selected: selectedQualifiedId === edge.id,
        },
        draggable: false,
        connectable: false,
        zIndex: 2,
      },
    ]
  })

  const visibleNodeIds = new Set(visible.nodes.map((node) => node.id))
  const startNodes: Array<Node> = []
  for (const [definitionPath, target] of composed.initialNodeIds) {
    if (!visibleNodeIds.has(target)) continue
    const id = startId(definitionPath)
    const point = placed?.positions.get(id)
    if (point !== undefined) {
      startNodes.push({
        id,
        type: "start",
        position: point,
        data: {},
        draggable: false,
        connectable: false,
        selectable: false,
        zIndex: 2,
      })
    }
  }

  const regionKeys = new Map<
    string,
    Readonly<{ definitionPath: string; parent: string; slot: string }>
  >()
  for (const node of visible.nodes) {
    const metadata = composed.nodes.get(node.id)
    const region = metadata?.node.region
    if (metadata === undefined || region === undefined) continue
    const key = `${metadata.definitionPath}:${region.parent}:${region.slot}`
    regionKeys.set(key, {
      definitionPath: metadata.definitionPath,
      parent: region.parent,
      slot: region.slot,
    })
  }
  const regionNodes: Array<Node> = Array.from(regionKeys).flatMap(([key, region]) => {
    const members = visible.nodes.filter((node) => {
      const metadata = composed.nodes.get(node.id)
      return (
        metadata?.definitionPath === region.definitionPath &&
        metadata.node.region?.parent === region.parent &&
        metadata.node.region.slot === region.slot
      )
    })
    const children = members.flatMap((node) => {
      const metadata = composed.nodes.get(node.id)
      if (metadata === undefined) return []
      const point = placed?.positions.get(node.id)
      return point === undefined ? [] : [{ ...point, ...nodeSize(metadata.node) }]
    })
    if (children.length === 0) return []
    const minX = Math.min(...children.map((point) => point.x)) - 18
    const minY = Math.min(...children.map((point) => point.y)) - 34
    const maxX = Math.max(...children.map((point) => point.x + point.width)) + 18
    const maxY = Math.max(...children.map((point) => point.y + point.height)) + 18
    const active = members.some((node) => activeByNode.has(node.id))
    return [
      {
        id: `region:${key}`,
        type: "region",
        position: { x: minX, y: minY },
        data: { parent: region.parent, slot: region.slot, active },
        style: { width: maxX - minX, height: maxY - minY },
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
        zIndex: 0,
      },
    ]
  })

  const machineNodes: Array<Node> = composed.regions.flatMap((region) => {
    const bounds = visible.nodes.flatMap((node) => {
      const metadata = composed.nodes.get(node.id)
      if (metadata?.definitionPath !== region.definitionPath) return []
      const point = placed?.positions.get(node.id)
      return point === undefined ? [] : [{ ...point, ...nodeSize(metadata.node) }]
    })
    if (bounds.length === 0) return []
    const minX = Math.min(...bounds.map((point) => point.x)) - 30
    const minY = Math.min(...bounds.map((point) => point.y)) - 48
    const maxX = Math.max(...bounds.map((point) => point.x + point.width)) + 30
    const maxY = Math.max(...bounds.map((point) => point.y + point.height)) + 30
    return [
      {
        id: `machine:${region.definitionPath}`,
        type: "machine",
        position: { x: minX, y: minY },
        data: {
          machineId: region.machineId,
          definitionPath: region.definitionPath,
          depth: region.depth,
          activeActors: activeActors.filter(
            (candidate) => candidate.definitionPath === region.definitionPath,
          ).length,
        },
        style: { width: maxX - minX, height: maxY - minY },
        draggable: false,
        connectable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
      },
    ]
  })

  const edges: Array<Edge> = visible.edges.flatMap((edge) => {
    const inbound = placed?.segments.get(`${edge.id}:in`)
    const outbound = placed?.segments.get(`${edge.id}:out`)
    const traversed = traversedEdgeIds.has(edge.id)
    const edgeSelected = selectedQualifiedId === edge.id
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
                highlight: edgeSelected || highlighted.has(edge.id),
                arrow: true,
              },
            },
          ]
    return [
      ...segment("in", inbound, { source: edge.source, target: `t:${edge.id}` }),
      ...segment("out", outbound, { source: `t:${edge.id}`, target: edge.target }),
    ]
  })

  const startEdges: Array<Edge> = []
  for (const [definitionPath, target] of composed.initialNodeIds) {
    if (!visibleNodeIds.has(target)) continue
    const id = startId(definitionPath)
    const points = placed?.segments.get(id)
    if (points !== undefined) {
      startEdges.push({
        id,
        source: id,
        target,
        type: "elk",
        data: { points, traversed: false, arrow: true },
      })
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      {showJson ? (
        <pre className="h-full overflow-auto bg-surface p-4 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(session.hello, null, 2)}
        </pre>
      ) : (
        <div className="dot-grid h-full bg-surface">
          <ReactFlow
            nodes={[
              ...machineNodes,
              ...regionNodes,
              ...startNodes,
              ...stateNodes,
              ...transitionNodes,
            ]}
            edges={[...startEdges, ...edges]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={0.15}
            maxZoom={2}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
            style={{ background: "transparent" }}
            onNodeClick={(_, node) => {
              if (node.type === "state") {
                const metadata = composed.nodes.get(node.id)
                if (metadata === undefined) return
                const active = activeByNode.get(node.id)?.[0]
                const next: MapSelection = {
                  kind: "node",
                  id: metadata.localId,
                  definitionPath: metadata.definitionPath,
                  ...(active === undefined ? {} : { actorId: active }),
                }
                setSelection((current) =>
                  current?.kind === next.kind &&
                  current.id === next.id &&
                  current.definitionPath === next.definitionPath
                    ? undefined
                    : next,
                )
                if (active !== undefined) setSelectedActorId(active)
                return
              }
              if (isTransitionNodeId(node.id)) {
                const metadata = composed.edges.get(edgeIdOfTransition(node.id))
                if (metadata === undefined) return
                const active = activeActors.find(
                  (candidate) => candidate.definitionPath === metadata.definitionPath,
                )?.actorId
                setSelection({
                  kind: "edge",
                  id: metadata.localId,
                  definitionPath: metadata.definitionPath,
                  ...(active === undefined ? {} : { actorId: active }),
                })
                if (active !== undefined) setSelectedActorId(active)
              }
            }}
            onPaneClick={() => setSelection(undefined)}
          />
        </div>
      )}

      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-ink bg-surface px-3 py-1 shadow-hard-sm">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">DEPTH</span>
        <button
          type="button"
          className="font-mono text-[11px] font-bold"
          onClick={() => setDepth(depth === "all" ? 2 : Math.max(1, depth - 1))}
        >
          −
        </button>
        <span className="font-mono text-[11px]">{depth === "all" ? "·" : depth}</span>
        <button
          type="button"
          className="font-mono text-[11px] font-bold"
          onClick={() => setDepth(depth === "all" ? 1 : Math.min(9, depth + 1))}
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
            onClick={() => void flow.fitView({ padding: 0.08, maxZoom: 1.05 })}
          >
            Fit
          </button>
        </div>
      )}
    </div>
  )
}
