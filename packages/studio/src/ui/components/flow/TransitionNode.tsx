import { Handle, type NodeProps, Position } from "@xyflow/react"
import type { Graph } from "effect-state-machine/devtools"

export interface TransitionNodeData {
  readonly edge: Graph.Edge
  readonly label: string
  readonly width: number
  readonly height: number
  readonly traversed: boolean
  readonly highlight: boolean
  readonly selected: boolean
  readonly [key: string]: unknown
}

/** An event/outcome pill placed as a first-class node between two states. */
export function TransitionNode(props: NodeProps) {
  const { edge, label, width, height, traversed, highlight, selected } =
    props.data as TransitionNodeData
  const branch = edge.branch
  const active = traversed || selected || highlight
  const event = edge.event?.tag ?? edge.outcome?.kind ?? "transition"
  const description = branch?.kind === "guard" ? branch.description : edge.description

  if (branch !== undefined) {
    return (
      <div
        className={`flex flex-col justify-center rounded-[18px] border px-3 py-2 font-mono ${
          active
            ? "border-accent-ink bg-focus text-surface"
            : "border-accent-ink bg-accent text-accent-ink"
        } ${selected ? "ring-2 ring-focus ring-offset-1" : ""}`}
        style={{ width, height }}
      >
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-current text-[9px] font-extrabold">
            {branch.index + 1}
          </span>
          <span className="text-[10px] font-extrabold">{event}</span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
            {branch.kind === "guard" ? "if" : "else"}
          </span>
          {branch.kind === "guard" ? (
            <span className="min-w-0 truncate text-[10px] font-semibold">{branch.name}</span>
          ) : null}
        </div>
        {description === undefined ? null : (
          <p className="mt-1 whitespace-normal text-[8.5px] font-medium leading-[12px] text-muted">
            {description}
          </p>
        )}
        <Handle type="target" position={Position.Top} className="!invisible" />
        <Handle type="source" position={Position.Bottom} className="!invisible" />
      </div>
    )
  }

  return (
    <div
      className={`flex h-[24px] items-center rounded-full border px-2.5 font-mono text-[10px] font-bold ${
        active
          ? "border-accent-ink bg-focus text-surface"
          : "border-accent-ink bg-accent text-accent-ink"
      } ${selected ? "ring-2 ring-focus ring-offset-1" : ""}`}
      style={{ width, height }}
    >
      {label}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
