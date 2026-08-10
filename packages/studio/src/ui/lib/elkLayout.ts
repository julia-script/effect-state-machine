import type { Graph } from "effect-state-machine/devtools"
import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkNode } from "elkjs/lib/elk-api"
import { NODE_HEIGHT, NODE_WIDTH, type Point } from "./layout.js"

/**
 * ELK layered layout with orthogonal edge routing — the engine behind
 * Mermaid's adaptive renderer. Transitions are first-class nodes: every graph
 * edge becomes state → transition-pill → state, so the engine places and
 * routes around the pills instead of hanging labels off the lines.
 */

export const TRANSITION_HEIGHT = 22

export const transitionSize = (label: string): { width: number; height: number } => ({
  width: label.length * 6.4 + 18,
  height: TRANSITION_HEIGHT,
})

export const edgeLabelText = (edge: Graph.Edge): string => {
  const base = edge.event?.tag ?? (edge.outcome !== undefined ? edge.outcome.kind : "")
  const branch =
    edge.branch === undefined
      ? ""
      : edge.branch.kind === "guard"
        ? ` [${edge.branch.index + 1}: ${edge.branch.name}]`
        : " [otherwise]"
  return `${base}${branch}` || "→"
}

export interface TransitionPlacement {
  readonly point: Point
  readonly width: number
  readonly height: number
  readonly label: string
}

export interface ElkPlacement {
  readonly positions: ReadonlyMap<string, Point>
  readonly transitions: ReadonlyMap<string, TransitionPlacement>
  /** Two routed segments per graph edge: into and out of its transition node. */
  readonly segments: ReadonlyMap<string, ReadonlyArray<Point>>
  readonly width: number
  readonly height: number
}

const transitionId = (edgeId: string) => `t:${edgeId}`
export const isTransitionNodeId = (id: string): boolean => id.startsWith("t:")
export const edgeIdOfTransition = (id: string): string => id.slice(2)

const elk = new ELK()

export const layout = async (graph: Graph.Graph): Promise<ElkPlacement> => {
  const labels = new Map(graph.edges.map((edge) => [edge.id, edgeLabelText(edge)]))
  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "44",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "14",
      "elk.layered.mergeEdges": "false",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: [
      ...graph.nodes.map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      ...graph.edges.map((edge) => ({
        id: transitionId(edge.id),
        ...transitionSize(labels.get(edge.id) ?? ""),
      })),
    ],
    edges: graph.edges.flatMap((edge) => [
      { id: `${edge.id}:in`, sources: [edge.source], targets: [transitionId(edge.id)] },
      { id: `${edge.id}:out`, sources: [transitionId(edge.id)], targets: [edge.target] },
    ]),
  }
  const result = await elk.layout(input)

  const positions = new Map<string, Point>()
  const transitions = new Map<string, TransitionPlacement>()
  for (const child of result.children ?? []) {
    const point = { x: child.x ?? 0, y: child.y ?? 0 }
    if (isTransitionNodeId(child.id)) {
      const edgeId = edgeIdOfTransition(child.id)
      transitions.set(edgeId, {
        point,
        width: child.width ?? 0,
        height: child.height ?? TRANSITION_HEIGHT,
        label: labels.get(edgeId) ?? "",
      })
    } else {
      positions.set(child.id, point)
    }
  }

  const segments = new Map<string, ReadonlyArray<Point>>()
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0]
    if (section === undefined) continue
    segments.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
  }

  return {
    positions,
    transitions,
    segments,
    width: result.width ?? 720,
    height: result.height ?? 420,
  }
}
