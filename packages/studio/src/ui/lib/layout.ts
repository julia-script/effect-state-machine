import type { Graph } from "effect-state-machine/devtools"

/** Renderer-side graph helpers: hop-limited focus and a layered layout. */

export const NODE_WIDTH = 148
export const NODE_HEIGHT = 46
const COLUMN_GAP = 230
const ROW_GAP = 92
const PADDING_X = 48
const PADDING_Y = 56
const MAX_ROWS = 6

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Layout {
  readonly positions: ReadonlyMap<string, Point>
  readonly width: number
  readonly height: number
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

/** Columns by BFS distance from the active node; disconnected nodes trail. */
export const layout = (graph: Graph.Graph, active: string | undefined): Layout => {
  const start =
    active !== undefined && graph.nodes.some((node) => node.id === active)
      ? active
      : graph.nodes[0]?.id
  const distances = distancesFrom(graph, start)
  const columns: Array<Array<string>> = []
  const push = (column: number, id: string) => {
    while (columns.length <= column) columns.push([])
    columns[column].push(id)
  }
  let overflow = Math.max(0, ...distances.values()) + 1
  let overflowCount = 0
  for (const node of graph.nodes) {
    const distance = distances.get(node.id)
    if (distance !== undefined) {
      push(distance, node.id)
      continue
    }
    if (overflowCount >= MAX_ROWS) {
      overflow += 1
      overflowCount = 0
    }
    push(overflow, node.id)
    overflowCount += 1
  }

  const positions = new Map<string, Point>()
  for (const [column, ids] of columns.entries()) {
    // Tall columns wrap into neighboring x offsets to stay scannable.
    for (const [row, id] of ids.entries()) {
      const wrap = Math.floor(row / MAX_ROWS)
      positions.set(id, {
        x: PADDING_X + column * COLUMN_GAP + wrap * (COLUMN_GAP / 2),
        y: PADDING_Y + (row % MAX_ROWS) * ROW_GAP + (column % 2) * 24,
      })
    }
  }

  let width = 720
  let height = 420
  for (const point of positions.values()) {
    width = Math.max(width, point.x + NODE_WIDTH + PADDING_X)
    height = Math.max(height, point.y + NODE_HEIGHT + PADDING_Y)
  }
  return { positions, width, height }
}

/** The serializable structure shown by the graph JSON view. */
export const toJson = (graph: Graph.Graph): unknown => ({
  id: graph.id,
  ...(graph.description === undefined ? {} : { description: graph.description }),
  states: graph.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    ...(node.description === undefined ? {} : { description: node.description }),
    ...(node.invocation === undefined ? {} : { invoke: node.invocation.name }),
  })),
  transitions: graph.edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    ...(edge.event === undefined ? {} : { event: edge.event.tag }),
    ...(edge.outcome === undefined ? {} : { outcome: edge.outcome.kind }),
    ...(edge.branch === undefined
      ? {}
      : { branch: edge.branch.kind === "guard" ? edge.branch.name : "otherwise" }),
  })),
  ignored: graph.ignores.map((ignore) => ({ in: ignore.source, event: ignore.event.tag })),
})
