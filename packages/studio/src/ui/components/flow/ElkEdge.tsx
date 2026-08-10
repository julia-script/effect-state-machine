import { BaseEdge, type EdgeProps } from "@xyflow/react"
import type { Point } from "../../lib/layout.js"

export interface ElkEdgeData {
  readonly points: ReadonlyArray<Point>
  readonly traversed: boolean
  /** Direction relative to the selection: "out" leaves it, "in" enters it. */
  readonly highlight: "in" | "out" | undefined
  readonly arrow: boolean
  readonly [key: string]: unknown
}

const pathFrom = (points: ReadonlyArray<Point>): string =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")

/**
 * One ELK-routed segment. The arrowhead is drawn directly (not an SVG marker)
 * so it always renders and always matches the segment's color.
 */
export function ElkEdge(props: EdgeProps) {
  const data = props.data as ElkEdgeData
  if (data.points.length < 2) return null
  const stroke = data.traversed
    ? "var(--color-focus)"
    : data.highlight === "out"
      ? "var(--color-focus)"
      : data.highlight === "in"
        ? "var(--color-success)"
        : "var(--color-rule-strong)"
  const emphasized = data.traversed || data.highlight !== undefined
  const last = data.points[data.points.length - 1]
  const prev = data.points[data.points.length - 2]
  const angle = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI
  return (
    <>
      <BaseEdge
        id={props.id}
        path={pathFrom(data.points)}
        className={data.traversed ? "edge-traversed" : undefined}
        style={{
          stroke,
          strokeWidth: emphasized ? 2.5 : 1.6,
          opacity: emphasized ? 1 : 0.6,
        }}
      />
      {data.arrow ? (
        <polygon
          points="-7,-4 1,0 -7,4"
          transform={`translate(${last.x}, ${last.y}) rotate(${angle})`}
          style={{ fill: stroke, opacity: emphasized ? 1 : 0.8 }}
        />
      ) : null}
    </>
  )
}
