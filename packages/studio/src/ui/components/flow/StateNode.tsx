import { Handle, type NodeProps, Position } from "@xyflow/react"
import type { Graph } from "effect-state-machine/devtools"
import { nodeSize } from "../../lib/layout.js"

export interface StateNodeData {
  readonly node: Graph.Node
  readonly active: boolean
  readonly activeActors: ReadonlyArray<string>
  readonly selected: boolean
  readonly [key: string]: unknown
}

export function StateNode(props: NodeProps) {
  const { node, active, activeActors, selected } = props.data as StateNodeData
  const kind =
    node.kind === "invoke"
      ? `invoke · ${node.invocation?.name ?? ""}`
      : node.kind === "final"
        ? "final"
        : node.kind === "child"
          ? `child · ${node.child?.name ?? ""}`
          : "state"
  const size = nodeSize(node)

  return (
    <div
      className={`relative overflow-hidden rounded-[8px] border-ink ${
        active ? "border-[2.5px] bg-pear text-pear-ink shadow-hard" : "border-[1.5px] bg-surface"
      } ${node.kind === "final" ? "border-dashed" : ""} ${
        selected ? "ring-2 ring-focus ring-offset-1" : ""
      }`}
      style={size}
    >
      <div className={`flex h-[34px] items-center justify-between border-b border-ink px-3 ${active ? "bg-pear" : "bg-accent"}`}>
        <span className="font-display text-[13px] font-extrabold leading-tight">{node.title}</span>
        <span className="font-mono text-[8px] font-bold uppercase tracking-widest text-muted">{kind}</span>
      </div>
      <div className="px-3 py-2 text-left">
        <p className="whitespace-normal font-mono text-[9.5px] font-medium leading-[14px] text-muted">
          {node.description ?? "No description provided."}
        </p>
      </div>
      {activeActors.length > 1 ? (
        <span className="absolute -right-2 -top-2 rounded-full border border-ink bg-cyan px-1.5 font-mono text-[8px] font-bold">
          {activeActors.length}
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
