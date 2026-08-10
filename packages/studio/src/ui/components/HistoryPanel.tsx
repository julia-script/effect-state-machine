import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Graph } from "effect-state-machine/devtools"
import * as React from "react"
import { edgeForStep } from "../lib/layout.js"
import {
  cursorAtom,
  displayedPositionAtom,
  selectedStepAtom,
  selectionAtom,
} from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"

export function HistoryPanel({ session }: { readonly session: ViewerClient.SessionView }) {
  const [cursor, setCursor] = useAtom(cursorAtom(session.sessionId))
  const [selectedStep, setSelectedStep] = useAtom(selectedStepAtom(session.sessionId))
  const setSelection = useAtomSet(selectionAtom(session.sessionId))
  const displayed = useAtomValue(displayedPositionAtom)
  const listRef = React.useRef<HTMLOListElement | null>(null)

  const history = session.history
  const head = history.positions.length - 1
  const isLive = cursor === undefined
  const behind = isLive || displayed === undefined ? 0 : head - displayed

  const stepCount = history.steps.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new steps
  React.useEffect(() => {
    if (isLive && listRef.current !== null) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [isLive, stepCount])

  const selectStep = (index: number) => {
    const step = history.steps[index]
    if (step === undefined) return
    setSelectedStep(index)
    setCursor(step.committedPosition ?? Math.min(step.statePosition, Math.max(0, head)))
    // Mirror the step on the map: its traversed transition, or its state.
    const graph = session.hello.graph as Graph.Graph
    const edge = edgeForStep(graph, step)
    const stateTag = step.targetStateTag ?? step.sourceStateTag
    setSelection(
      edge !== undefined
        ? { kind: "edge", id: edge.id }
        : stateTag !== undefined
          ? { kind: "node", id: stateTag }
          : undefined,
    )
  }

  const move = (delta: number) => {
    const current = displayed ?? head
    const next = Math.min(Math.max(0, current + delta), Math.max(0, head))
    setSelectedStep(undefined)
    setCursor(next === head && delta > 0 ? undefined : next)
  }

  const raw =
    selectedStep === undefined
      ? undefined
      : history.steps[selectedStep]?.raw.flatMap((index) => {
          const fact = history.facts[index]
          return fact === undefined ? [] : [fact]
        })

  return (
    <section className="flex min-h-0 flex-1 flex-col px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">HISTORY</span>
        <span className="font-mono text-[9.5px] text-muted">{history.steps.length}</span>
        <span className="flex-1" />
        <button type="button" className="font-mono text-[11px]" onClick={() => move(-1)}>
          ◀
        </button>
        <span className="font-mono text-[9.5px] text-muted">
          {(displayed ?? 0) + (head >= 0 ? 1 : 0)}/{head + 1}
        </span>
        <button type="button" className="font-mono text-[11px]" onClick={() => move(1)}>
          ▶
        </button>
        <button
          type="button"
          className={`rounded-full border border-ink px-2 py-0.5 font-mono text-[9px] font-bold ${
            isLive ? "bg-pear text-pear-ink" : "bg-accent text-accent-ink"
          }`}
          onClick={() => {
            setSelectedStep(undefined)
            setCursor(undefined)
          }}
        >
          {isLive ? "Live" : `Live +${behind}`}
        </button>
      </div>
      {history.truncatedFacts === 0 ? null : (
        <p className="mt-1 font-mono text-[9px] text-danger">
          {history.truncatedFacts} earlier facts were dropped.
        </p>
      )}
      <ol ref={listRef} className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {history.steps.map((step) => {
          const selected = selectedStep === step.index
          const meta =
            step.sourceStateTag !== undefined && step.targetStateTag !== undefined
              ? `${step.sourceStateTag} → ${step.targetStateTag}`
              : (step.status ?? "")
          return (
            <li key={step.index}>
              <button
                type="button"
                className={`grid w-full grid-cols-[22px_1fr_auto] items-baseline gap-1 rounded px-1 py-0.5 text-left ${
                  selected ? "bg-cyan" : "hover:bg-paper"
                }`}
                onClick={() => selectStep(step.index)}
              >
                <span className="font-mono text-[10px] text-muted">{step.index}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-semibold">
                    {step.title}
                    {step.kind === "invocation" && step.status !== undefined
                      ? ` → ${step.status}`
                      : ""}
                  </span>
                  {meta === "" ? null : (
                    <span className="block truncate font-mono text-[9.5px] text-muted">{meta}</span>
                  )}
                </span>
                <span className="font-mono text-[9.5px] text-cyan-ink">
                  {step.targetStateTag ?? step.sourceStateTag ?? ""}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {raw === undefined || raw.length === 0 ? null : (
        <details className="mt-1.5 shrink-0">
          <summary className="cursor-pointer font-mono text-[9px] font-bold tracking-widest text-muted">
            RAW EVENTS · {raw.length}
          </summary>
          <pre className="mt-1 max-h-36 overflow-auto rounded bg-paper p-2 font-mono text-[9.5px]">
            {JSON.stringify(
              raw.map((fact) => fact.body),
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </section>
  )
}
