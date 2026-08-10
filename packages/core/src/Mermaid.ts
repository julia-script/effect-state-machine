import type * as Graph from "./Graph.js"

const identifier = (value: string): string => {
  const sanitized = value.replaceAll(/[^A-Za-z0-9_]/g, "_")
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `state_${sanitized}`
}

export const render = (graph: Graph.Graph): string => {
  const ids = new Map(graph.nodes.map((node) => [node.id, identifier(node.id)]))
  const lines = ["stateDiagram-v2"]

  for (const node of graph.nodes) {
    const details = [
      node.title,
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
    lines.push(
      `  ${ids.get(edge.source)} --> ${ids.get(edge.target)}: ${
        edge.event?.tag.replaceAll("\n", " ") ?? edge.outcome?.kind ?? "transition"
      }${branch}`,
    )
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
