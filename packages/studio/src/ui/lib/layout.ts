import type { History } from "@effect-state-machine/studio-client"
import type { Graph } from "effect-state-machine/devtools"

/** Renderer-side graph helpers: node metrics, hop-limited focus, JSON view. */

export const NODE_WIDTH = 260

/** State cards grow vertically so their descriptions remain part of the map. */
export const nodeSize = (node: Graph.Node): { width: number; height: number } => {
  const descriptionLines =
    node.description === undefined ? 1 : Math.max(1, Math.ceil(node.description.length / 42))
  return { width: NODE_WIDTH, height: 58 + descriptionLines * 14 }
}
export interface Point {
  readonly x: number
  readonly y: number
}

const undirectedNeighbors = (graph: Graph.Graph): ReadonlyMap<string, ReadonlyArray<string>> => {
  const neighbors = new Map<string, Array<string>>()
  const link = (from: string, to: string) => {
    const list = neighbors.get(from) ?? []
    if (!list.includes(to)) list.push(to)
    neighbors.set(from, list)
  }
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue
    link(edge.source, edge.target)
    link(edge.target, edge.source)
  }
  return neighbors
}

const distancesFrom = (
  graph: Graph.Graph,
  start: string | undefined,
): ReadonlyMap<string, number> => {
  const distances = new Map<string, number>()
  if (start === undefined || !graph.nodes.some((node) => node.id === start)) return distances
  const neighbors = undirectedNeighbors(graph)
  distances.set(start, 0)
  const queue = [start]
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    const distance = distances.get(current) ?? 0
    for (const next of neighbors.get(current) ?? []) {
      if (distances.has(next)) continue
      distances.set(next, distance + 1)
      queue.push(next)
    }
  }
  return distances
}

/** Restricts the graph to nodes within `depth` undirected hops of `center`. */
export const focus = (
  graph: Graph.Graph,
  center: string | undefined,
  depth: number | "all",
): Graph.Graph => {
  if (depth === "all") return graph
  const distances = distancesFrom(graph, center)
  const visible = new Set(
    graph.nodes.flatMap((node) => {
      const distance = distances.get(node.id)
      return distance !== undefined && distance <= depth ? [node.id] : []
    }),
  )
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    ignores: graph.ignores.filter((ignore) => visible.has(ignore.source)),
  }
}

/** The graph edge a semantic step traversed, when it traversed one. */
export const edgeForStep = (
  graph: Graph.Graph,
  step: History.Step | undefined,
): Graph.Edge | undefined =>
  step === undefined || step.sourceStateTag === undefined || step.targetStateTag === undefined
    ? undefined
    : graph.edges.find(
        (edge) =>
          edge.source === step.sourceStateTag &&
          edge.target === step.targetStateTag &&
          (step.eventTag === undefined || edge.event?.tag === step.eventTag) &&
          (step.branch === undefined || edge.branch?.index === step.branch.index),
      )
