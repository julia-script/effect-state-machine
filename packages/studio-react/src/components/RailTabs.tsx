import { useAtom, useAtomValue } from "@effect/atom-react"
import { currentSessionAtom, type RailTab, railTabAtom, selectionAtom } from "../state/atoms.js"

const tabs: ReadonlyArray<{ readonly id: RailTab; readonly label: string }> = [
  { id: "details", label: "Details" },
  { id: "events", label: "Events" },
  { id: "history", label: "History" },
]

export function RailTabs() {
  const [tab, setTab] = useAtom(railTabAtom)
  const session = useAtomValue(currentSessionAtom)
  const stepCount = session?.history.steps.length
  const selection = useAtomValue(selectionAtom(session?.sessionId ?? "no-session"))

  return (
    <div
      role="tablist"
      aria-label="Studio panels"
      className="flex shrink-0 gap-1 border-b-2 border-ink bg-paper px-2 pt-1.5"
    >
      {tabs.map(({ id, label }) => {
        const active = tab === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`-mb-0.5 rounded-t border-2 border-b-0 px-2.5 py-1 font-mono text-caption font-bold ${
              active
                ? "border-ink bg-surface text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
            onClick={() => setTab(id)}
          >
            {label}
            {/* A quiet signal that clicking the map put something here. */}
            {id === "details" && selection !== undefined ? (
              <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
            ) : null}
            {id === "history" && stepCount !== undefined && stepCount > 0 ? (
              <span className={`ml-1 font-normal ${active ? "text-muted" : ""}`}>{stepCount}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
