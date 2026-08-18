import type * as Graph from "./Graph.js"

const identifier = (value: string): string => {
  const sanitized = value.replaceAll(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `state_${sanitized}`
}

/**
 * Renders a graph as a Mermaid `stateDiagram-v2` document.
 *
 * **Details**
 *
 * Node titles, invocation names, retry names, child references, event tags, outcome kinds, branch
 * labels, ignored events, and final states are included. Descriptions and activity overlays remain
 * renderer concerns and are not emitted.
 *
 * @category converting
 * @since 0.1.0
 */
export const render = (graph: Graph.Graph): string => {
  const ids = new Map(graph.nodes.map((node) => [node.id, identifier(node.id)]))
  const lines = ["stateDiagram-v2"]

  for (const node of graph.nodes) {
    const details = [
      node.title,
      ...(node.region === undefined ? [] : [`path: ${node.id}`]),
      ...(node.invocation === undefined ? [] : [`invoke: ${node.invocation.name}`]),
      ...(node.invocation?.retry === undefined ? [] : [`retry: ${node.invocation.retry.name}`]),
      ...(node.child === undefined
        ? []
        : [`child: ${node.child.name} → ${node.child.definition.id}`]),
    ]
    lines.push(`  state ${JSON.stringify(details.join("\n"))} as ${ids.get(node.id)}`)
  }

  for (const edge of graph.edges) {
    const branch =
      edge.branch?.kind === "guard"
        ? ` [${edge.branch.index + 1}: ${edge.branch.name}]`
        : edge.branch?.kind === "otherwise"
          ? " [otherwise]"
          : ""
    const transition =
      edge.event?.tag.replaceAll("\n", " ") ??
      (edge.outcome?.kind === "timer" && edge.outcome.name !== undefined
        ? `@after ${JSON.stringify(edge.outcome.name)}`
        : (edge.outcome?.kind ?? "transition"))
    lines.push(`  ${ids.get(edge.source)} --> ${ids.get(edge.target)}: ${transition}${branch}`)
  }

  for (const ignored of graph.ignores) {
    lines.push(
      `  ${ids.get(ignored.source)} --> ${ids.get(ignored.source)}: ${ignored.event.tag.replaceAll("\n", " ")} [ignored]`,
    )
  }

  for (const node of graph.nodes) {
    if (node.kind === "final") {
      lines.push(`  ${ids.get(node.id)} --> [*]`)
    }
  }

  return lines.join("\n")
}
