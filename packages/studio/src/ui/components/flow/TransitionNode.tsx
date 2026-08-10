import { Handle, type NodeProps, Position } from "@xyflow/react"

export interface TransitionNodeData {
  readonly label: string
  readonly traversed: boolean
  readonly [key: string]: unknown
}

/** An event/outcome pill placed as a first-class node between two states. */
export function TransitionNode(props: NodeProps) {
  const { label, traversed } = props.data as TransitionNodeData
  return (
    <div
      className={`flex h-[22px] items-center rounded-full border px-2 font-mono text-[10px] font-bold ${
        traversed
          ? "border-accent-ink bg-focus text-surface"
          : "border-accent-ink bg-accent text-accent-ink"
      }`}
    >
      {label}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
