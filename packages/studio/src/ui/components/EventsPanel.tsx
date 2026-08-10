import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/unstable/reactivity"
import type { Graph } from "effect-state-machine/devtools"
import * as React from "react"
import { dispatchAtom, displayedPositionAtom, isLiveAtom } from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"

export function EventsPanel({ session }: { readonly session: ViewerClient.SessionView }) {
  const isLive = useAtomValue(isLiveAtom)
  const displayed = useAtomValue(displayedPositionAtom)
  const dispatch = useAtomSet(dispatchAtom)
  const dispatchState = useAtomValue(dispatchAtom)
  const [draftTag, setDraftTag] = React.useState<string | undefined>(undefined)
  const [draft, setDraft] = React.useState("")
  const [draftError, setDraftError] = React.useState<string | undefined>(undefined)

  const graph = session.hello.graph as Graph.Graph
  const activeTag =
    displayed === undefined ? undefined : session.history.positions[displayed]?.stateTag
  const running = session.history.status === "running" && session.connection === "connected"

  const accepts = (eventTag: string | undefined): boolean => {
    if (eventTag === undefined) return true
    if (activeTag === undefined) return false
    return (
      graph.edges.some((edge) => edge.source === activeTag && edge.event?.tag === eventTag) ||
      graph.ignores.some((ignore) => ignore.source === activeTag && ignore.event.tag === eventTag)
    )
  }

  const groups = new Map<string, Array<(typeof session.hello.quickEvents)[number]>>()
  for (const control of session.hello.quickEvents) {
    const group = control.group ?? ""
    groups.set(group, [...(groups.get(group) ?? []), control])
  }

  const eventTags = Object.keys(session.hello.jsonSchemas.events)
  const selectDraftTag = (tag: string) => {
    setDraftTag(tag)
    setDraft(JSON.stringify({ _tag: tag }, null, 2))
    setDraftError(undefined)
  }

  const submitCustom = () => {
    let event: unknown
    try {
      event = JSON.parse(draft)
    } catch (error) {
      setDraftError(`Invalid JSON: ${String(error)}`)
      return
    }
    if (
      typeof event !== "object" ||
      event === null ||
      typeof (event as { _tag?: unknown })._tag !== "string"
    ) {
      setDraftError("The event needs a string _tag field.")
      return
    }
    setDraftError(undefined)
    dispatch({ sessionId: session.sessionId, command: { _tag: "Custom", event } })
  }

  const lastOutcome = AsyncResult.value(dispatchState)
  const rejection =
    lastOutcome._tag === "Some" && lastOutcome.value._tag === "Rejected"
      ? lastOutcome.value
      : undefined
  const transportFailure = AsyncResult.isFailure(dispatchState)
    ? "Studio could not reach the application."
    : undefined

  return (
    <section className="border-b-2 border-ink px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">EVENTS</span>
        {isLive ? null : (
          <span className="rounded-full bg-danger-soft px-2 py-0.5 font-mono text-[9px] font-bold text-danger">
            time-traveling
          </span>
        )}
      </div>
      {[...groups.entries()].map(([group, controls]) => (
        <div key={group} className="mt-2">
          {group === "" ? null : (
            <div className="font-mono text-[8.5px] font-bold tracking-widest text-muted">
              {group.toUpperCase()}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {controls.map((control) => {
              const enabled = running && isLive && accepts(control.eventTag)
              return (
                <button
                  key={control.id}
                  type="button"
                  disabled={!enabled}
                  title={control.description}
                  className="h-6 rounded border border-accent-ink bg-accent px-2 font-mono text-[10px] font-bold text-accent-ink disabled:opacity-35"
                  onClick={() =>
                    dispatch({
                      sessionId: session.sessionId,
                      command: { _tag: "Quick", id: control.id },
                    })
                  }
                >
                  {control.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {session.hello.quickEvents.length === 0 ? (
        <p className="mt-1.5 text-[10px] text-muted">No quick events announced.</p>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-[9px] font-bold tracking-widest text-muted">
          CUSTOM EVENT
        </summary>
        <select
          className="mt-1.5 h-6 w-full rounded border border-ink bg-surface px-1 font-mono text-[10.5px]"
          value={draftTag ?? ""}
          onChange={(event) => selectDraftTag(event.target.value)}
        >
          <option value="" disabled>
            event type…
          </option>
          {eventTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <textarea
          className="mt-1.5 h-24 w-full rounded border border-ink bg-paper p-1.5 font-mono text-[10.5px]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          disabled={!running || !isLive || draft.trim() === ""}
          className="mt-1 h-6 rounded bg-ink px-3 font-mono text-[10px] font-bold text-paper disabled:opacity-35"
          onClick={submitCustom}
        >
          Dispatch
        </button>
      </details>
      {draftError === undefined ? null : (
        <p className="mt-1.5 font-mono text-[9.5px] text-danger">{draftError}</p>
      )}
      {rejection === undefined ? null : (
        <p className="mt-1.5 font-mono text-[9.5px] text-danger">
          Rejected: {rejection.reason}
          {rejection.message === undefined ? "" : ` — ${rejection.message}`}
        </p>
      )}
      {transportFailure === undefined ? null : (
        <p className="mt-1.5 font-mono text-[9.5px] text-danger">{transportFailure}</p>
      )}
    </section>
  )
}
