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
  // Selection and traversal get the strong fill; `highlight` (this edge leaves
  // the selected state) only gets a soft related tint — sharing the strong
  // style made a state click look like it had selected its outgoing event.
  const emphasized = traversed || selected
  const pillStyle = emphasized
    ? "border-accent-ink bg-focus text-surface"
    : highlight
      ? "border-ink bg-cyan text-cyan-ink"
      : "border-accent-ink bg-accent text-accent-ink"
  // outline-solid: @property-backed utilities degrade in this shadow root.
  const selectedOutline = selected ? "outline-solid outline-2 outline-offset-2 outline-focus" : ""
  const event = edge.event?.tag ?? edge.outcome?.kind ?? "transition"
  const description = branch?.kind === "guard" ? branch.description : edge.description

  if (branch !== undefined) {
    return (
      <div
        className={`flex flex-col justify-center rounded-[18px] border px-3 py-2 font-mono ${pillStyle} ${selectedOutline}`}
        style={{ width, height }}
      >
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-current text-micro font-extrabold">
            {branch.index + 1}
          </span>
          <span className="text-caption font-extrabold">{event}</span>
          <span className="text-micro font-bold uppercase tracking-wider">
            {branch.kind === "guard" ? "if" : "else"}
          </span>
          {branch.kind === "guard" ? (
            <span className="min-w-0 truncate text-caption font-semibold">{branch.name}</span>
          ) : null}
        </div>
        {description === undefined ? null : (
          <p className="mt-1 whitespace-normal text-caption font-medium">{description}</p>
        )}
        <Handle type="target" position={Position.Top} className="!invisible" />
        <Handle type="source" position={Position.Bottom} className="!invisible" />
      </div>
    )
  }

  return (
    <div
      className={`flex h-[28px] items-center rounded-full border px-2.5 font-mono text-caption font-bold ${pillStyle} ${selectedOutline}`}
      style={{ width, height }}
    >
      {label}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
