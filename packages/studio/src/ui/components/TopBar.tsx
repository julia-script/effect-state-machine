import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  currentSessionAtom,
  displayedPositionAtom,
  railCollapsedAtom,
  selectedSessionIdAtom,
  sourceActionAtom,
  themeAtom,
  worldViewAtom,
} from "../state/atoms.js"

const statusColor: Record<string, string> = {
  connected: "bg-success",
  disconnected: "bg-danger",
  ended: "bg-muted",
}

export function TopBar() {
  const world = useAtomValue(worldViewAtom)
  const session = useAtomValue(currentSessionAtom)
  const displayed = useAtomValue(displayedPositionAtom)
  const selectSession = useAtomSet(selectedSessionIdAtom)
  const [theme, setTheme] = useAtom(themeAtom)
  const [sourceAction, setSourceAction] = useAtom(sourceActionAtom)
  const [railCollapsed, setRailCollapsed] = useAtom(railCollapsedAtom)

  const stateTag =
    session !== undefined && displayed !== undefined
      ? session.history.positions[displayed]?.stateTag
      : undefined

  return (
    <header className="flex h-10 shrink-0 items-center gap-2.5 border-b-2 border-ink bg-pear px-2.5 text-pear-ink">
      <span className="font-display text-[13px] font-extrabold">Machine devtools</span>
      <select
        className="h-6 rounded border border-ink bg-surface px-1 font-mono text-[11px] text-ink"
        value={session?.sessionId ?? ""}
        onChange={(event) => selectSession(event.target.value || undefined)}
      >
        {world.sessions.length === 0 ? <option value="">no sessions</option> : null}
        {world.sessions.map((candidate) => (
          <option key={candidate.sessionId} value={candidate.sessionId}>
            {candidate.hello.app.name} · {candidate.hello.machine.id}
          </option>
        ))}
      </select>
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full border border-ink ${
            world.connected
              ? (statusColor[session?.connection ?? "connected"] ?? "bg-success")
              : "bg-danger"
          }`}
        />
        {world.connected
          ? `ws · ${session?.hello.app.runtime ?? "studio"} · ${session?.connection ?? "idle"}`
          : "ws · offline"}
      </span>
      {stateTag === undefined ? null : (
        <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold text-ink">
          {stateTag}
        </span>
      )}
      <span className="flex-1" />
      <button
        type="button"
        className="h-6 w-6 rounded border border-ink bg-surface text-[13px] leading-none text-ink"
        title="Toggle theme"
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        ◐
      </button>
      <select
        className="h-6 rounded border border-ink bg-surface px-1 font-mono text-[11px] text-ink"
        value={sourceAction}
        onChange={(event) => setSourceAction(event.target.value === "copy" ? "copy" : "editor")}
        title="Source link action"
      >
        <option value="editor">Editor</option>
        <option value="copy">Copy</option>
      </select>
      <button
        type="button"
        className="h-6 rounded border border-ink bg-surface px-2 font-mono text-[10px] font-semibold text-ink"
        onClick={() => setRailCollapsed(!railCollapsed)}
      >
        {railCollapsed ? "⟨ Panels" : "Panels ⟩"}
      </button>
    </header>
  )
}
