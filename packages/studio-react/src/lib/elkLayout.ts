import type { Graph } from "effect-state-machine/devtools"
import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkNode } from "elkjs/lib/elk-api"
import { nodeSize, type Point } from "./layout.js"

/**
 * ELK layered layout with orthogonal edge routing — the engine behind
 * Mermaid's adaptive renderer. Transitions are first-class nodes: every graph
 * edge becomes state → transition-pill → state, so the engine places and
 * routes around the pills instead of hanging labels off the lines.
 */

export const TRANSITION_HEIGHT = 28
export const GUARDED_TRANSITION_BASE_HEIGHT = 48
export const START_SIZE = 18
export const START_ID = "__start"
export const startId = (definitionPath: string): string => `${START_ID}:${definitionPath}`

const TRANSITION_LABEL_CHARACTER_WIDTH = 7
const TRANSITION_DESCRIPTION_CHARACTER_WIDTH = 6.6
const GUARDED_TRANSITION_DESCRIPTION_LINE_HEIGHT = 16

export const transitionSize = (edge: Graph.Edge): { width: number; height: number } => {
  const label = edgeLabelText(edge)
  if (edge.branch === undefined) {
    return { width: label.length * TRANSITION_LABEL_CHARACTER_WIDTH + 24, height: TRANSITION_HEIGHT }
  }
  const description = edge.branch.kind === "guard" ? edge.branch.description : edge.description
  const width = Math.max(
    190,
    Math.min(
      340,
      Math.max(
        label.length * TRANSITION_LABEL_CHARACTER_WIDTH,
        (description?.length ?? 0) * TRANSITION_DESCRIPTION_CHARACTER_WIDTH,
      ) + 48,
    ),
  )
  const descriptionLines =
    description === undefined
      ? 0
      : Math.max(
          1,
          Math.ceil(
            description.length /
              Math.max(24, Math.floor((width - 32) / TRANSITION_DESCRIPTION_CHARACTER_WIDTH)),
          ),
        )
  return {
    width,
    height:
      GUARDED_TRANSITION_BASE_HEIGHT +
      descriptionLines * GUARDED_TRANSITION_DESCRIPTION_LINE_HEIGHT,
  }
}

export const edgeLabelText = (edge: Graph.Edge): string => {
  const base = edge.event?.tag ?? (edge.outcome !== undefined ? edge.outcome.kind : "")
  const branch =
    edge.branch === undefined
      ? ""
      : edge.branch.kind === "guard"
        ? ` ${edge.branch.index + 1} IF ${edge.branch.name}`
        : ` ${edge.branch.index + 1} ELSE`
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

export const layout = async (
  graph: Graph.Graph,
  initial?: string | ReadonlyMap<string, string>,
): Promise<ElkPlacement> => {
  const starts: ReadonlyArray<readonly [string, string]> =
    typeof initial === "string"
      ? graph.nodes.some((node) => node.id === initial)
        ? [[START_ID, initial]]
        : []
      : Array.from(initial ?? []).flatMap(([definitionPath, target]) =>
          graph.nodes.some((node) => node.id === target)
            ? [[startId(definitionPath), target] as const]
            : [],
        )
  const initialTargets = new Set(starts.map(([, target]) => target))
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
      ...starts.map(([id]) => ({
        id,
        width: START_SIZE,
        height: START_SIZE,
        layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST_SEPARATE" },
      })),
      ...graph.nodes.map((node) => ({
        id: node.id,
        ...nodeSize(node),
        // The entry state stays in the top layer; cycles route back up to it.
        ...(initialTargets.has(node.id)
          ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } }
          : {}),
      })),
      ...graph.edges.map((edge) => ({
        id: transitionId(edge.id),
        ...transitionSize(edge),
      })),
    ],
    edges: [
      ...starts.map(([id, target]) => ({ id, sources: [id], targets: [target] })),
      ...graph.edges.flatMap((edge) => [
        { id: `${edge.id}:in`, sources: [edge.source], targets: [transitionId(edge.id)] },
        { id: `${edge.id}:out`, sources: [transitionId(edge.id)], targets: [edge.target] },
      ]),
    ],
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
