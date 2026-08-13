import type { Graph } from "effect-state-machine/devtools"

const renderValue = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : (JSON.stringify(value) ?? String(value))

/** Compact node-kind label used on behavior-map cards. */
export const nodeKindLabel = (node: Graph.Node): string => {
  if (node.region !== undefined) return `region · ${node.region.slot}`
  if (node.kind === "invoke") {
    return `${node.invocation?.kind ?? "effect"} · ${node.invocation?.name ?? "work"}`
  }
  if (node.kind === "regions") {
    const count = node.regions?.slots.length ?? 0
    return `${count > 1 ? "parallel" : "compound"} · ${count} ${count === 1 ? "region" : "regions"}`
  }
  if (node.kind === "child") return `child · ${node.child?.name ?? ""}`
  return node.kind
}

/** Inspectable work, timer, and region facts retained on a graph node. */
export const nodeFacts = (
  node: Graph.Node,
): ReadonlyArray<Readonly<{ label: string; value: string }>> => {
  const facts: Array<Readonly<{ label: string; value: string }>> = []
  if (node.region !== undefined) {
    facts.push({ label: "Region", value: `${node.region.parent} / ${node.region.slot}` })
  }
  if (node.regions !== undefined) {
    facts.push({ label: "Slots", value: node.regions.slots.join(", ") })
  }
  if (node.invocation !== undefined) {
    facts.push({
      label: "Work",
      value: `${node.invocation.kind ?? "effect"} · ${node.invocation.name}`,
    })
    if (node.invocation.lanes !== undefined) {
      facts.push({ label: "Lanes", value: node.invocation.lanes.join(", ") })
    }
    if (node.invocation.concurrency !== undefined) {
      facts.push({ label: "Concurrency", value: String(node.invocation.concurrency) })
    }
    if (node.invocation.retry !== undefined) {
      facts.push({ label: "Retry", value: node.invocation.retry.name })
    }
  }
  if (node.timer !== undefined) {
    facts.push({
      label: "After",
      value: `${renderValue(node.timer.duration)} → ${node.timer.target}`,
    })
  }
  return facts
}
