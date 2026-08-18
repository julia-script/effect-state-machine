import { useAtom, useAtomValue } from "@effect/atom-react"
import { History } from "@effect-state-machine/studio-client"
import type { Graph } from "effect-state-machine/devtools"
import {
  diffAtom,
  displayedSequenceAtom,
  isLiveAtom,
  selectedActorIdAtom,
  selectedStepAtom,
} from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { JsonTree } from "./JsonTree.js"
import { SourceLink } from "./SourceLink.js"

export function StatePanel({ session }: { readonly session: ViewerClient.SessionView }) {
  const sequence = useAtomValue(displayedSequenceAtom) ?? 0
  const [diffEnabled, setDiffEnabled] = useAtom(diffAtom)
  const isLive = useAtomValue(isLiveAtom)
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
  // Actor counts used to sit in the top bar; the rail is where they belong.
  const liveCount = History.actorsAt(history, sequence).length

  return (
    <section className="border-b-2 border-ink px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-micro font-bold tracking-widest text-muted">
          STATE
        </span>
        {/* The state tag is the panel's headline: it never shrinks — the actor
            pill and source link absorb the width pressure instead. */}
        <span
          className="shrink-0 font-display text-[14px] font-extrabold"
          title={position?.stateTag}
        >
          {position?.stateTag ?? "—"}
        </span>
        <span
          className="min-w-0 shrink truncate rounded-full bg-paper px-1.5 py-0.5 font-mono text-micro font-bold whitespace-nowrap text-muted"
          title={`${actorId} · ${lifecycle}`}
        >
          {actorId} · {lifecycle}
        </span>
        <span className="min-w-0 flex-1" />
        {/* Time travel disables dispatch, so it has to be visible on the pinned
            panel rather than only inside the Events tab. */}
        {isLive ? null : (
          <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 font-mono text-micro font-bold whitespace-nowrap text-danger">
            time-traveling
          </span>
        )}
        <button
          type="button"
          className={`shrink-0 rounded-full border border-ink px-2 py-0.5 font-mono text-micro font-bold whitespace-nowrap ${diffEnabled ? "bg-pear text-pear-ink" : "bg-surface text-muted"}`}
          onClick={() => setDiffEnabled(!diffEnabled)}
        >
          ± diff
        </button>
        {location === undefined ? null : <SourceLink location={location} />}
      </div>
      {actor === undefined ? null : (
        <p className="mt-1 truncate font-mono text-micro text-muted" title={actor.definitionPath}>
          {actor.definitionPath} · depth {actor.depth}
          {actor.parentActorId === undefined ? " · root" : ` · parent ${actor.parentActorId}`} ·{" "}
          {liveCount} live / {history.actors.size} actors
        </p>
      )}
      {position === undefined ? (
        <p className="mt-2 text-caption text-muted">
          No committed state for this actor at the cursor.
        </p>
      ) : (
        <JsonTree
          className="mt-2 max-h-48 overflow-auto rounded bg-paper p-2 leading-relaxed"
          value={position.state}
          previous={previous?.state}
          diff={diffEnabled && previous !== undefined}
        />
      )}
      {step?.actorId !== actorId || step.eventPayload === undefined ? null : (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-micro font-bold tracking-widest text-muted">
            EVENT PAYLOAD · {step.eventTag}
          </summary>
          <JsonTree
            className="mt-1 max-h-32 overflow-auto rounded bg-paper p-2"
            value={step.eventPayload}
          />
        </details>
      )}
      {history.encodingFailures.filter((failure) => failure.actorId === actorId).length ===
      0 ? null : (
        <p className="mt-2 font-mono text-caption text-danger">
          State snapshots for this actor could not be encoded.
        </p>
      )}
    </section>
  )
}
