import type * as Graph from "./Graph.js"

const identifier = (value: string): string => {
  const sanitized = value.replaceAll(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `state_${sanitized}`
}

export const render = (graph: Graph.Graph): string => {
  const ids = new Map(graph.nodes.map((node) => [node.id, identifier(node.id)]))
  const lines = ["stateDiagram-v2"]

  for (const node of graph.nodes) {
    lines.push(`  state ${JSON.stringify(node.title)} as ${ids.get(node.id)}`)
  }

  for (const edge of graph.edges) {
    lines.push(
      `  ${ids.get(edge.source)} --> ${ids.get(edge.target)}: ${edge.event.tag.replaceAll("\n", " ")}`,
    )
  }

  return lines.join("\n")
}
