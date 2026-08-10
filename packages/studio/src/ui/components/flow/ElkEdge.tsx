import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react"
import type { Point } from "../../lib/layout.js"

export interface ElkEdgeData {
  readonly points: ReadonlyArray<Point>
  readonly label: string
  readonly labelX: number
  readonly labelY: number
  readonly traversed: boolean
  readonly onSelect: () => void
  readonly [key: string]: unknown
}

const pathFrom = (points: ReadonlyArray<Point>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")

export function ElkEdge(props: EdgeProps) {
  const data = props.data as ElkEdgeData
  if (data.points.length < 2) return null
  return (
    <>
      <BaseEdge
        id={props.id}
        path={pathFrom(data.points)}
        markerEnd={props.markerEnd}
        className={data.traversed ? "edge-traversed" : undefined}
        style={{
          stroke: data.traversed ? "var(--color-focus)" : "var(--color-rule-strong)",
          strokeWidth: data.traversed ? 3 : 1.6,
          opacity: data.traversed ? 1 : 0.55,
        }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`pointer-events-auto absolute rounded-full border px-2 py-px font-mono text-[10px] font-bold ${
            data.traversed
              ? "border-accent-ink bg-focus text-surface"
              : "border-accent-ink bg-accent text-accent-ink"
          }`}
          style={{
            transform: `translate(-50%, -50%) translate(${data.labelX}px, ${data.labelY}px)`,
          }}
          onClick={data.onSelect}
        >
          {data.label}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
