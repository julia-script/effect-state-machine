import type { NodeProps } from "@xyflow/react"

export interface MachineRegionData {
  readonly machineId: string
  readonly definitionPath: string
  readonly depth: number
  readonly activeActors: number
  readonly [key: string]: unknown
}

export function MachineRegion(props: NodeProps) {
  const data = props.data as MachineRegionData
  return (
    <div
      className={`h-full w-full rounded-2xl border-2 border-dashed p-2 ${
        data.activeActors > 0 ? "border-focus bg-cyan/20" : "border-rule-strong bg-paper/60"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-display text-caption font-extrabold">{data.machineId}</span>
        <span className="font-mono text-micro text-muted">{data.definitionPath}</span>
        <span className="flex-1" />
        <span className="rounded-full bg-surface px-1.5 py-0.5 font-mono text-micro font-bold text-muted">
          {data.activeActors > 0 ? `${data.activeActors} live` : "inactive"}
        </span>
      </div>
    </div>
  )
}
