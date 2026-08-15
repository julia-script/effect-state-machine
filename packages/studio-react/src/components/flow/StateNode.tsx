import { Handle, type NodeProps, Position } from "@xyflow/react"
import type { Graph } from "effect-state-machine/devtools"
import { nodeSize } from "../../lib/layout.js"
import { nodeFacts, nodeKindLabel } from "../../lib/nodePresentation.js"

export interface StateNodeData {
  readonly node: Graph.Node
  readonly active: boolean
  readonly activeActors: ReadonlyArray<string>
  readonly selected: boolean
  readonly [key: string]: unknown
}

export function StateNode(props: NodeProps) {
  const { node, active, activeActors, selected } = props.data as StateNodeData
  const kind = nodeKindLabel(node)
  const facts = nodeFacts(node)
  const size = nodeSize(node)

  return (
    <div
      className={`relative overflow-hidden rounded-[8px] border-ink ${
        active ? "border-[2.5px] bg-pear text-pear-ink shadow-hard" : "border-[1.5px] bg-surface"
      } ${node.kind === "final" ? "border-dashed" : ""} ${
        // outline-solid, not ring or bare outline: utilities backed by
        // @property-registered vars (ring's shadow chain, outline's default
        // style var) silently resolve to none inside this shadow root.
        selected ? "outline-solid outline-[2.5px] outline-offset-2 outline-focus" : ""
      }`}
      style={size}
    >
      <div
        className={`flex h-[34px] items-center justify-between border-b border-ink px-3 ${
          active ? "bg-pear text-pear-ink" : "bg-accent text-accent-ink"
        }`}
      >
        <span className="font-display text-[13px] font-extrabold leading-tight">{node.title}</span>
        <span className="font-mono text-micro font-bold uppercase tracking-widest">{kind}</span>
      </div>
      <div className="px-3 py-2 text-left">
        <p
          className={`whitespace-normal font-mono text-caption font-medium ${
            active ? "text-pear-ink" : "text-muted"
          }`}
        >
          {node.description ?? "No description provided."}
        </p>
        {facts.length === 0 ? null : (
          <p className="mt-1 truncate font-mono text-micro font-semibold text-cyan-ink">
            {facts.map(({ label, value }) => `${label}: ${value}`).join(" · ")}
          </p>
        )}
      </div>
      {activeActors.length > 1 ? (
        <span className="absolute -right-2 -top-2 rounded-full border border-ink bg-cyan px-1.5 font-mono text-micro font-bold">
          {activeActors.length}
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} className="!invisible" />
      <Handle type="source" position={Position.Bottom} className="!invisible" />
    </div>
  )
}
