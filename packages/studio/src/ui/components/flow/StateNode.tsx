import { Handle, type NodeProps, Position } from "@xyflow/react"
import type { Graph } from "effect-state-machine/devtools"
import { NODE_HEIGHT, NODE_WIDTH } from "../../lib/layout.js"

export interface StateNodeData {
  readonly node: Graph.Node
  readonly active: boolean
  readonly initial: boolean
  readonly [key: string]: unknown
}

export function StateNode(props: NodeProps) {
  const { node, active, initial } = props.data as StateNodeData
  const subtitle =
    node.kind === "invoke"
      ? `invoke · ${node.invocation?.name ?? ""}`
      : node.kind === "final"
        ? `final${node.description === undefined ? "" : ` · ${node.description}`}`
        : node.kind === "child"
          ? `child · ${node.child?.name ?? ""}`
          : (node.description ?? "")

  return (
    <div
      className={`relative flex flex-col items-center justify-center rounded-[10px] border-ink text-center ${
        active ? "border-[2.5px] bg-pear text-pear-ink shadow-hard" : "border-[1.5px] bg-surface"
      } ${node.kind === "final" ? "border-dashed" : ""}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      {initial ? (
        <span className="absolute -left-1 top-1/2 -translate-x-full -translate-y-1/2 font-mono text-[8px] font-bold text-muted">
          INITIAL ▸
        </span>
      ) : null}
      <span className="font-display text-[12.5px] font-extrabold leading-tight">{node.title}</span>
      {subtitle === "" ? null : (
        <span className="max-w-[140px] truncate font-mono text-[9px] font-semibold text-muted">
          {subtitle}
        </span>
      )}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
