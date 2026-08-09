import type { MachineDefinition } from "./effect-machine"

type Tagged = Readonly<{ _tag: string }>

export interface MermaidOptions {
  /**
   * `overview` merges transitions with the same endpoints and summarizes defects.
   * `complete` emits every transition with its Effect source name.
   */
  readonly detail?: "overview" | "complete"
}

type Edge = Readonly<{
  from: string
  to: string
  label: string
}>

const renderEdge = ({ from, to, label }: Edge): string => `  ${from} --> ${to}: ${label}`

const mergeEdges = (edges: ReadonlyArray<Edge>): ReadonlyArray<Edge> => {
  const merged = new Map<string, { from: string; to: string; labels: Array<string> }>()

  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.to}`
    const current = merged.get(key)
    if (current === undefined) {
      merged.set(key, { from: edge.from, to: edge.to, labels: [edge.label] })
    } else if (!current.labels.includes(edge.label)) {
      current.labels.push(edge.label)
    }
  }

  return Array.from(merged.values(), ({ from, to, labels }) => ({
    from,
    to,
    label: labels.join(" / "),
  }))
}

/** An opt-in projection of a machine definition for documentation and tooling. */
export const toMermaid = <State extends Tagged, Event extends Tagged, Requirements>(
  definition: MachineDefinition<State, Event, Requirements>,
  options: MermaidOptions = {},
): string => {
  const complete = options.detail === "complete"
  const edges: Array<Edge> = []
  const defectSourcesByTarget = new Map<string, Array<string>>()

  for (const node of definition.nodes) {
    for (const [event, transition] of Object.entries(node.runtime.on)) {
      edges.push({ from: node.runtime.tag, to: transition.target, label: event })
    }

    if (node.runtime.kind !== "invoke") continue

    edges.push({
      from: node.runtime.tag,
      to: node.runtime.success.target,
      label: complete ? `${node.runtime.source} succeeds` : "success",
    })
    edges.push({
      from: node.runtime.tag,
      to: node.runtime.failure.target,
      label: complete ? `${node.runtime.source} fails` : "failure",
    })

    if (node.runtime.defect === undefined) continue

    if (complete) {
      edges.push({
        from: node.runtime.tag,
        to: node.runtime.defect.target,
        label: `${node.runtime.source} defects`,
      })
    } else {
      const sources = defectSourcesByTarget.get(node.runtime.defect.target) ?? []
      sources.push(node.runtime.tag)
      defectSourcesByTarget.set(node.runtime.defect.target, sources)
    }
  }

  const renderedEdges = complete ? edges : mergeEdges(edges)
  const lines = [
    "stateDiagram-v2",
    "  direction TB",
    `  [*] --> ${definition.initial._tag}`,
    ...renderedEdges.map(renderEdge),
  ]

  for (const [target, sources] of defectSourcesByTarget) {
    lines.push(
      `  note right of ${target}`,
      `    Defects from ${sources.join(", ")} enter ${target}`,
      "  end note",
    )
  }

  return `${lines.join("\n")}\n`
}
