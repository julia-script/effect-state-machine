import { Handle, type NodeProps, Position } from "@xyflow/react"

export interface TransitionNodeData {
  readonly label: string
  readonly traversed: boolean
  readonly highlight: boolean
  readonly selected: boolean
  readonly [key: string]: unknown
}

/** An event/outcome pill placed as a first-class node between two states. */
export function TransitionNode(props: NodeProps) {
  const { label, traversed, highlight, selected } = props.data as TransitionNodeData
  return (
    <div
      className={`flex h-[24px] items-center rounded-full border px-2.5 font-mono text-[10px] font-bold ${
        traversed || selected || highlight
          ? "border-accent-ink bg-focus text-surface"
          : "border-accent-ink bg-accent text-accent-ink"
      } ${selected ? "ring-2 ring-focus ring-offset-1" : ""}`}
    >
      {label}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
