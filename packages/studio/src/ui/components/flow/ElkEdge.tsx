import { BaseEdge, type EdgeProps } from "@xyflow/react"
import type { Point } from "../../lib/layout.js"

export interface ElkEdgeData {
  readonly points: ReadonlyArray<Point>
  readonly traversed: boolean
  readonly [key: string]: unknown
}

const pathFrom = (points: ReadonlyArray<Point>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")

/** Renders the orthogonal route ELK computed for one segment. */
export function ElkEdge(props: EdgeProps) {
  const data = props.data as ElkEdgeData
  if (data.points.length < 2) return null
  return (
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
  )
}
