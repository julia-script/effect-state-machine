import type { Graph } from "effect-state-machine/devtools"
import { NODE_HEIGHT, NODE_WIDTH, type Point } from "../lib/layout.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { SourceLink } from "./SourceLink.js"

export interface Selection {
  readonly kind: "node" | "edge"
  readonly id: string
}

const badge = (text: string) => (
  <span className="rounded-full bg-pear px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-pear-ink">
    {text}
  </span>
)

export function DetailCard({
  graph,
  session,
  selection,
  scale,
  positions,
  onClose,
}: {
  readonly graph: Graph.Graph
  readonly session: ViewerClient.SessionView
  readonly selection: Selection
  readonly scale: number
  readonly positions: ReadonlyMap<string, Point>
  readonly onClose: () => void
}) {
  const node =
    selection.kind === "node" ? graph.nodes.find((n) => n.id === selection.id) : undefined
  const edge =
    selection.kind === "edge" ? graph.edges.find((e) => e.id === selection.id) : undefined
  if (node === undefined && edge === undefined) return null

  const anchorId = node?.id ?? edge?.source ?? ""
  const anchor = positions.get(anchorId) ?? { x: 0, y: 0 }
  const left = anchor.x * scale
  const top = (anchor.y + NODE_HEIGHT + 8) * scale

  const title = node?.title ?? edge?.event?.tag ?? edge?.outcome?.kind ?? "transition"
  const kind =
    node !== undefined
      ? node.kind === "invoke"
        ? "invoke"
        : node.kind === "final"
          ? "final state"
          : node.kind
      : edge?.outcome !== undefined
        ? "outcome"
        : "event"
  const description = node?.description ?? edge?.description
  const location = node?.location ?? edge?.location

  const relations =
    node !== undefined
      ? graph.edges
          .filter((candidate) => candidate.source === node.id)
          .map((candidate) => ({
            id: candidate.id,
            text: `${candidate.event !== undefined ? `on ${candidate.event.tag}` : (candidate.outcome?.kind ?? "")} → ${candidate.target}`,
          }))
      : graph.edges
          .filter(
            (candidate) => candidate.event?.tag === edge?.event?.tag && edge?.event !== undefined,
          )
          .map((candidate) => ({
            id: candidate.id,
            text: `${candidate.source} → ${candidate.target}`,
          }))

  const schemas = session.hello.jsonSchemas
  const schema =
    node !== undefined
      ? schemas.states[node.id]
      : edge?.event !== undefined
        ? schemas.events[edge.event.tag]
        : undefined

  return (
    <div
      className="absolute z-10 w-[280px] rounded-[10px] border-2 border-ink bg-surface p-3 shadow-hard"
      style={{ left, top: Math.max(0, top) }}
    >
      <div className="flex items-center gap-2">
        <span className="font-display text-[12.5px] font-extrabold">{title}</span>
        {badge(kind)}
        <span className="flex-1" />
        <button type="button" className="text-[12px] text-muted" onClick={onClose}>
          ×
        </button>
      </div>
      {description === undefined ? null : (
        <p className="mt-1 text-[10px] leading-snug text-muted">{description}</p>
      )}
      {relations.length === 0 ? null : (
        <div className="mt-2 space-y-0.5">
          {relations.map((relation) => (
            <div key={relation.id} className="font-mono text-[9.5px] font-semibold text-cyan-ink">
              {relation.text}
            </div>
          ))}
        </div>
      )}
      {location === undefined ? null : (
        <div className="mt-2">
          <SourceLink location={location} />
        </div>
      )}
      {schema === undefined ? null : (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[9px] font-bold tracking-widest text-muted">
            JSON SCHEMA
          </summary>
          <pre className="mt-1 max-h-44 overflow-auto rounded bg-paper p-2 font-mono text-[9.5px] leading-relaxed">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

export { NODE_WIDTH }
