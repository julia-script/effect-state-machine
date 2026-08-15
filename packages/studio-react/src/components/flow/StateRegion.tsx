import type { NodeProps } from "@xyflow/react"

export interface StateRegionData {
  readonly parent: string
  readonly slot: string
  readonly active: boolean
  readonly [key: string]: unknown
}

/** A visual boundary around the child nodes belonging to one statechart region slot. */
export function StateRegion(props: NodeProps) {
  const { parent, slot, active } = props.data as StateRegionData
  return (
    <div
      className={`h-full w-full rounded-[12px] border-2 border-dashed ${
        active ? "border-cyan-ink bg-cyan/20" : "border-rule-strong bg-paper/55"
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-micro font-bold uppercase tracking-widest text-muted">
        <span>{slot}</span>
        <span className="font-medium normal-case tracking-normal">region of {parent}</span>
        {active ? <span className="rounded-full bg-cyan px-1.5 text-cyan-ink">active</span> : null}
      </div>
    </div>
  )
}
