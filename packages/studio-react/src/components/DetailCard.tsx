import { nodeFacts, nodeKindLabel } from "../lib/nodePresentation.js"
import type { MapSelection } from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { SourceLink } from "./SourceLink.js"

export type Selection = MapSelection

const badge = (text: string) => (
  <span className="shrink-0 rounded-full bg-pear px-1.5 py-0.5 font-mono text-micro font-bold whitespace-nowrap text-pear-ink">
    {text}
  </span>
)

export function DetailCard({
  session,
  selection,
  onClose,
}: {
  readonly session: ViewerClient.SessionView
  readonly selection: Selection
  readonly onClose: () => void
}) {
  const definition = session.composed.definitions.get(selection.definitionPath)
  if (definition === undefined) return null
  const graph = definition.graph
  const node =
    selection.kind === "node" ? graph.nodes.find((n) => n.id === selection.id) : undefined
  const edge =
    selection.kind === "edge" ? graph.edges.find((e) => e.id === selection.id) : undefined
  if (node === undefined && edge === undefined) return null

  const title = node?.title ?? edge?.event?.tag ?? edge?.outcome?.kind ?? "transition"
  const kind =
    node !== undefined ? nodeKindLabel(node) : edge?.outcome !== undefined ? "outcome" : "event"
  const description = node?.description ?? edge?.description
  const location = node?.location ?? edge?.location
  const facts = node === undefined ? [] : nodeFacts(node)

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

  const schemas = definition.jsonSchemas
  const schema =
    node !== undefined
      ? schemas.states[node.id]
      : edge?.event !== undefined
        ? schemas.events[edge.event.tag]
        : undefined

  return (
    <section className="border-b-2 border-ink bg-paper-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-micro font-bold tracking-widest text-muted">
          DETAILS
        </span>
        <span
          className="min-w-[6ch] shrink truncate font-display text-[13px] font-extrabold"
          title={title}
        >
          {title}
        </span>
        {badge(kind)}
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          className="shrink-0 text-[12px] text-muted"
          title="Close details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {description === undefined ? null : (
        <p className="mt-1 text-caption text-muted">{description}</p>
      )}
      <p className="mt-1 truncate font-mono text-micro text-muted" title={selection.definitionPath}>
        {selection.definitionPath}
      </p>
      {facts.length === 0 ? null : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-micro">
          {facts.map(({ label, value }) => (
            <div key={label} className="contents">
              <dt className="font-bold text-muted">{label}</dt>
              <dd className="text-cyan-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {relations.length === 0 ? null : (
        <div className="mt-2 space-y-0.5">
          {relations.map((relation) => (
            <div key={relation.id} className="font-mono text-caption font-semibold text-cyan-ink">
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
          <summary className="cursor-pointer font-mono text-micro font-bold tracking-widest text-muted">
            JSON SCHEMA
          </summary>
          <pre className="mt-1 max-h-44 overflow-auto rounded bg-paper p-2 font-mono text-micro leading-relaxed">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </details>
      )}
    </section>
  )
}
