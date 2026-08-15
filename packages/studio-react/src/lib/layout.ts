import type { History } from "@effect-state-machine/studio-client"
import type { Graph } from "effect-state-machine/devtools"
import { nodeFacts } from "./nodePresentation.js"

/** Renderer-side graph helpers: node metrics, hop-limited focus, JSON view. */

export const NODE_WIDTH = 260
const NODE_DESCRIPTION_CHARACTERS_PER_LINE = 36
const NODE_DESCRIPTION_LINE_HEIGHT = 16
const NODE_FACTS_HEIGHT = 16

/** State cards grow vertically so their descriptions remain part of the map. */
export const nodeSize = (node: Graph.Node): { width: number; height: number } => {
  const descriptionLines =
    node.description === undefined
      ? 1
      : Math.max(1, Math.ceil(node.description.length / NODE_DESCRIPTION_CHARACTERS_PER_LINE))
  return {
    width: NODE_WIDTH,
    height:
      56 +
      descriptionLines * NODE_DESCRIPTION_LINE_HEIGHT +
      (nodeFacts(node).length > 0 ? NODE_FACTS_HEIGHT : 0),
  }
}
export interface Point {
  readonly x: number
  readonly y: number
}

const taggedValue = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "_tag") === "string"
    ? (value as Readonly<Record<string, unknown>>)
    : undefined

/** Local graph node ids active in one schema-encoded machine snapshot. */
export const activeStateNodeIds = (graph: Graph.Graph, state: unknown): ReadonlyArray<string> => {
  const parent = taggedValue(state)
  if (parent === undefined) return []
  const parentTag = parent._tag as string
  const active = [parentTag]
  for (const node of graph.nodes) {
    if (node.region?.parent !== parentTag) continue
    const slot = taggedValue(parent[node.region.slot])
    if (slot?._tag === node.region.tag) active.push(node.id)
  }
  return active
}

/** Whether an event is structurally accepted by the active parent, region children, or child node. */
export const acceptsEvent = (graph: Graph.Graph, state: unknown, eventTag: string): boolean => {
  const active = new Set(activeStateNodeIds(graph, state))
  return (
    graph.edges.some(
      (edge) => active.has(edge.source) && edge.event?.tag === eventTag,
    ) ||
    graph.ignores.some(
      (ignore) => active.has(ignore.source) && ignore.event.tag === eventTag,
    ) ||
    graph.nodes.some(
      (node) =>
        active.has(node.id) &&
        node.child?.forwards.some((forward) => forward.parentEvent.tag === eventTag),
    )
  )
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

/** Restricts the graph to nodes within `depth` undirected hops of any active center. */
export const focusMany = (
  graph: Graph.Graph,
  centers: ReadonlyArray<string>,
  depth: number | "all",
): Graph.Graph => {
  if (depth === "all") return graph
  const distances = new Map<string, number>()
  for (const center of centers) {
    for (const [node, distance] of distancesFrom(graph, center)) {
      distances.set(node, Math.min(distance, distances.get(node) ?? Number.POSITIVE_INFINITY))
    }
  }
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

/** Restricts the graph around one optional center. */
export const focus = (
  graph: Graph.Graph,
  center: string | undefined,
  depth: number | "all",
): Graph.Graph => focusMany(graph, center === undefined ? [] : [center], depth)

const outcomeKind = (
  eventTag: string,
): "success" | "failure" | "completion" | "timer" | undefined => {
  switch (eventTag) {
    case "@success":
      return "success"
    case "@failure":
      return "failure"
    case "@complete":
      return "completion"
    case "@after":
      return "timer"
    default:
      return undefined
  }
}

/** Every graph edge selected by one semantic step, including parallel-region macrosteps. */
export const edgesForStep = (
  graph: Graph.Graph,
  step: History.Step | undefined,
): ReadonlyArray<Graph.Edge> => {
  if (step === undefined) return []
  const transitions =
    step.transitions ??
    (step.sourceStateTag === undefined || step.targetStateTag === undefined
      ? []
      : [
          {
            sourceStateTag: step.sourceStateTag,
            targetStateTag: step.targetStateTag,
            eventTag: step.eventTag ?? "",
            ...(step.branch === undefined ? {} : { branch: step.branch }),
          },
        ])
  return graph.edges.filter((edge) =>
    transitions.some((transition) => {
      if (edge.source !== transition.sourceStateTag || edge.target !== transition.targetStateTag) {
        return false
      }
      const outcome = outcomeKind(transition.eventTag)
      return (
        (outcome === undefined
          ? transition.eventTag === "" || edge.event?.tag === transition.eventTag
          : edge.outcome?.kind === outcome) &&
        (transition.branch === undefined || edge.branch?.index === transition.branch.index)
      )
    }),
  )
}

/** The first traversed edge, retained for single-selection interactions. */
export const edgeForStep = (
  graph: Graph.Graph,
  step: History.Step | undefined,
): Graph.Edge | undefined => edgesForStep(graph, step)[0]
