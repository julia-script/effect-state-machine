import type { Graph } from "effect-state-machine/devtools"
import ELK from "elkjs/lib/elk.bundled.js"
import type { ElkNode } from "elkjs/lib/elk-api"
import { NODE_HEIGHT, NODE_WIDTH, type Point } from "./layout.js"

/**
 * ELK layered layout with orthogonal edge routing — the same engine and style
 * as Mermaid's adaptive renderer: straight segments, neat bends, inline labels.
 */

export interface EdgeRoute {
  readonly points: ReadonlyArray<Point>
  readonly label?: Readonly<{ x: number; y: number; width: number; height: number }>
}

export interface ElkPlacement {
  readonly positions: ReadonlyMap<string, Point>
  readonly routes: ReadonlyMap<string, EdgeRoute>
  readonly width: number
  readonly height: number
}

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

const elk = new ELK()

export const layout = async (graph: Graph.Graph): Promise<ElkPlacement> => {
  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "48",
      "elk.spacing.edgeNode": "28",
      "elk.spacing.edgeEdge": "14",
      "elk.spacing.edgeLabel": "6",
      "elk.edgeLabels.inline": "true",
      "elk.layered.mergeEdges": "false",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: graph.edges.map((edge) => {
      const text = edgeLabelText(edge)
      return {
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        labels: [{ text, width: text.length * 6.4 + 14, height: 18 }],
      }
    }),
  }
  const result = await elk.layout(input)

  const positions = new Map<string, Point>()
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }

  const routes = new Map<string, EdgeRoute>()
  for (const edge of result.edges ?? []) {
    const section = edge.sections?.[0]
    const points: Array<Point> =
      section === undefined
        ? []
        : [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
    const label = edge.labels?.[0]
    routes.set(edge.id, {
      points,
      ...(label?.x === undefined || label.y === undefined
        ? {}
        : {
            label: {
              x: label.x,
              y: label.y,
              width: label.width ?? 0,
              height: label.height ?? 18,
            },
          }),
    })
  }

  return {
    positions,
    routes,
    width: result.width ?? 720,
    height: result.height ?? 420,
  }
}
