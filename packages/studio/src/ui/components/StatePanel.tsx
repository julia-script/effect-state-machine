import { History } from "@effect-state-machine/studio-client"
import { useAtom, useAtomValue } from "@effect/atom-react"
import type { Graph } from "effect-state-machine/devtools"
import { diffLines } from "../lib/diff.js"
import {
  diffAtom,
  displayedSequenceAtom,
  selectedActorIdAtom,
  selectedStepAtom,
} from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { SourceLink } from "./SourceLink.js"

const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "undefined"

export function StatePanel({ session }: { readonly session: ViewerClient.SessionView }) {
  const sequence = useAtomValue(displayedSequenceAtom) ?? 0
  const [diffEnabled, setDiffEnabled] = useAtom(diffAtom)
  const selectedStepIndex = useAtomValue(selectedStepAtom(session.sessionId))
  const selectedActorId = useAtomValue(selectedActorIdAtom(session.sessionId))

  const history = session.history
  const actorId = selectedActorId ?? history.rootActorId ?? session.hello.rootActorId
  const actor = history.actors.get(actorId)
  const position = History.positionAt(history, actorId, sequence)
  const previous = position === undefined ? undefined : History.previousPosition(history, position)
  const step =
    selectedStepIndex !== undefined
      ? history.steps[selectedStepIndex]
      : [...history.steps]
          .reverse()
          .find((candidate) => candidate.actorId === actorId && candidate.sequence <= sequence)
  const definition =
    actor === undefined ? undefined : session.composed.definitions.get(actor.definitionPath)
  const graph = definition?.graph as Graph.Graph | undefined
  const location =
    position === undefined
      ? undefined
      : graph?.nodes.find((node) => node.id === position.stateTag)?.location
  const lifecycle =
    actor === undefined || sequence < actor.startedAt
      ? "not started"
      : actor.endedAt !== undefined && actor.endedAt <= sequence
        ? actor.status
        : "running"

  return (
    <section className="border-b-2 border-ink px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">STATE</span>
        <span className="font-display text-[14px] font-extrabold">{position?.stateTag ?? "—"}</span>
        <span className="rounded-full bg-paper px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-muted">{actorId} · {lifecycle}</span>
        <span className="flex-1" />
        <button
          type="button"
          className={`rounded-full border border-ink px-2 py-0.5 font-mono text-[9px] font-bold ${diffEnabled ? "bg-pear text-pear-ink" : "bg-surface text-muted"}`}
          onClick={() => setDiffEnabled(!diffEnabled)}
        >
          ± diff
        </button>
        {location === undefined ? null : <SourceLink location={location} />}
      </div>
      {actor === undefined ? null : (
        <p className="mt-1 font-mono text-[8.5px] text-muted">{actor.definitionPath} · depth {actor.depth}{actor.parentActorId === undefined ? " · root" : ` · parent ${actor.parentActorId}`}</p>
      )}
      {position === undefined ? (
        <p className="mt-2 text-[10px] text-muted">No committed state for this actor at the cursor.</p>
      ) : (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-paper p-2 font-mono text-[11px] leading-relaxed">
          {diffEnabled && previous !== undefined
            ? diffLines(pretty(previous.state), pretty(position.state)).map((line, index) => (
                <div
                  key={`${index}-${line.kind}`}
                  className={line.kind === "added" ? "bg-success-soft text-success" : line.kind === "removed" ? "bg-danger-soft text-danger" : undefined}
                >
                  {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} {line.text}
                </div>
              ))
            : pretty(position.state)}
        </pre>
      )}
      {step?.actorId !== actorId || step.eventPayload === undefined ? null : (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[9px] font-bold tracking-widest text-muted">EVENT PAYLOAD · {step.eventTag}</summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-paper p-2 font-mono text-[10.5px]">{pretty(step.eventPayload)}</pre>
        </details>
      )}
      {history.encodingFailures.filter((failure) => failure.actorId === actorId).length === 0 ? null : (
        <p className="mt-2 font-mono text-[9.5px] text-danger">State snapshots for this actor could not be encoded.</p>
      )}
    </section>
  )
}
