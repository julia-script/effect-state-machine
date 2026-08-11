import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { History } from "@effect-state-machine/studio-client"
import { useHostControls } from "../HostContext.js"
import {
  currentSessionAtom,
  displayedSequenceAtom,
  railCollapsedAtom,
  selectedActorIdAtom,
  selectedSessionIdAtom,
  worldViewAtom,
} from "../state/atoms.js"

const statusColor: Record<string, string> = {
  connected: "bg-success",
  disconnected: "bg-danger",
  ended: "bg-muted",
}

export function TopBar() {
  const {
    canOpenSource,
    connectionKind,
    setSourceAction,
    setTheme,
    singleSession,
    sourceAction,
    theme,
  } = useHostControls()
  const world = useAtomValue(worldViewAtom)
  const session = useAtomValue(currentSessionAtom)
  const sequence = useAtomValue(displayedSequenceAtom)
  const selectSession = useAtomSet(selectedSessionIdAtom)
  const [railCollapsed, setRailCollapsed] = useAtom(railCollapsedAtom)
  const selectedActorId = useAtomValue(selectedActorIdAtom(session?.sessionId ?? "no-session"))

  const stateTag =
    session !== undefined && sequence !== undefined
      ? History.positionAt(
          session.history,
          session.history.rootActorId ?? session.hello.rootActorId,
          sequence,
        )?.stateTag
      : undefined
  const liveActors =
    session === undefined || sequence === undefined
      ? []
      : History.actorsAt(session.history, sequence)
  const descendants = liveActors.filter((actor) => actor.actorId !== session?.history.rootActorId)

  return (
    <header className="flex h-10 shrink-0 items-center gap-2.5 border-b-2 border-ink bg-pear px-2.5 text-pear-ink">
      <span className="font-display text-[13px] font-extrabold">Machine devtools</span>
      {singleSession ? null : (
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
      )}
      <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold text-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full border border-ink ${
            world.connected
              ? (statusColor[session?.connection ?? "connected"] ?? "bg-success")
              : "bg-danger"
          }`}
        />
        {world.connected
          ? `${connectionKind} · ${session?.hello.app.runtime ?? "studio"} · ${session?.connection ?? "idle"}`
          : `${connectionKind} · offline`}
      </span>
      {stateTag === undefined ? null : (
        <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold text-ink">
          {stateTag}
        </span>
      )}
      {session === undefined ? null : (
        <span className="rounded-full bg-cyan px-2 py-0.5 font-mono text-[9px] font-semibold text-cyan-ink">
          {descendants.length} live descendant{descendants.length === 1 ? "" : "s"} ·{" "}
          {session.history.actors.size} actors
        </span>
      )}
      {selectedActorId === undefined ? null : (
        <span className="font-mono text-[9px] text-muted">selected {selectedActorId}</span>
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
      {canOpenSource ? (
        <select
          className="h-6 rounded border border-ink bg-surface px-1 font-mono text-[11px] text-ink"
          value={sourceAction}
          onChange={(event) => setSourceAction(event.target.value === "copy" ? "copy" : "open")}
          title="Source link action"
        >
          <option value="open">Open</option>
          <option value="copy">Copy</option>
        </select>
      ) : null}
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
