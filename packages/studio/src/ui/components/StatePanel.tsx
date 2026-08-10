import { useAtom, useAtomValue } from "@effect/atom-react"
import type { Graph } from "effect-state-machine/devtools"
import { diffLines } from "../lib/diff.js"
import { diffAtom, displayedPositionAtom, selectedStepAtom } from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { SourceLink } from "./SourceLink.js"

const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "undefined"

export function StatePanel({ session }: { readonly session: ViewerClient.SessionView }) {
  const displayed = useAtomValue(displayedPositionAtom)
  const [diffEnabled, setDiffEnabled] = useAtom(diffAtom)
  const selectedStepIndex = useAtomValue(selectedStepAtom(session.sessionId))

  const history = session.history
  const position = displayed === undefined ? undefined : history.positions[displayed]
  const previous =
    displayed === undefined || displayed === 0 ? undefined : history.positions[displayed - 1]
  const step =
    selectedStepIndex !== undefined
      ? history.steps[selectedStepIndex]
      : [...history.steps]
          .reverse()
          .find(
            (candidate) => (candidate.committedPosition ?? candidate.statePosition) === displayed,
          )

  const graph = session.hello.graph as Graph.Graph
  const location =
    position === undefined
      ? undefined
      : graph.nodes.find((node) => node.id === position.stateTag)?.location

  return (
    <section className="border-b-2 border-ink px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">STATE</span>
        <span className="font-display text-[14px] font-extrabold">{position?.stateTag ?? "—"}</span>
        <span className="flex-1" />
        <button
          type="button"
          className={`rounded-full border border-ink px-2 py-0.5 font-mono text-[9px] font-bold ${
            diffEnabled ? "bg-pear text-pear-ink" : "bg-surface text-muted"
          }`}
          onClick={() => setDiffEnabled(!diffEnabled)}
        >
          ± diff
        </button>
        {location === undefined ? null : <SourceLink location={location} />}
      </div>
      {position === undefined ? (
        <p className="mt-2 text-[10px] text-muted">No committed state yet.</p>
      ) : (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-paper p-2 font-mono text-[11px] leading-relaxed">
          {diffEnabled && previous !== undefined
            ? diffLines(pretty(previous.state), pretty(position.state)).map((line, index) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines are positional
                  key={`${index}-${line.kind}`}
                  className={
                    line.kind === "added"
                      ? "bg-success-soft text-success"
                      : line.kind === "removed"
                        ? "bg-danger-soft text-danger"
                        : undefined
                  }
                >
                  {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} {line.text}
                </div>
              ))
            : pretty(position.state)}
        </pre>
      )}
      {step?.eventPayload === undefined ? null : (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[9px] font-bold tracking-widest text-muted">
            EVENT PAYLOAD · {step.eventTag}
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-paper p-2 font-mono text-[10.5px]">
            {pretty(step.eventPayload)}
          </pre>
        </details>
      )}
      {history.encodingFailures.length === 0 ? null : (
        <p className="mt-2 font-mono text-[9.5px] text-danger">
          {history.encodingFailures.length} state snapshot(s) could not be encoded.
        </p>
      )}
    </section>
  )
}
