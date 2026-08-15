import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as React from "react"
import { useHostControls } from "../HostContext.js"
import {
  currentSessionAtom,
  railCollapsedAtom,
  removeSessionAtom,
  selectedSessionIdAtom,
  worldViewAtom,
} from "../state/atoms.js"

const statusColor: Record<string, string> = {
  connected: "bg-success",
  disconnected: "bg-danger",
  ended: "bg-muted",
}

/**
 * Deliberately thin: identity, a liveness dot, and an overflow menu. Everything
 * that describes the *machine* lives in the rail, where there is room for it.
 */
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
  const selectSession = useAtomSet(selectedSessionIdAtom)
  const removeSession = useAtomSet(removeSessionAtom)
  const [railCollapsed, setRailCollapsed] = useAtom(railCollapsedAtom)
  const [menuOpen, setMenuOpen] = React.useState(false)
  // One ref wraps the trigger AND the menu: the dismiss handler must ignore
  // the trigger, or pressing ⋯ closes on pointerdown and the release click
  // toggles it straight back open.
  const menuAreaRef = React.useRef<HTMLDivElement | null>(null)

  // Dismiss on an outside press or Escape. The listener goes on `document`,
  // not the shadow root: pointerdown is composed, so in-Studio presses bubble
  // out to it, while host-page presses (which never enter the shadow tree)
  // reach it too.
  React.useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: Event) => {
      const area = menuAreaRef.current
      if (area !== null && !event.composedPath().includes(area)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [menuOpen])

  const status = world.connected
    ? `${connectionKind} · ${session?.hello.app.runtime ?? "studio"} · ${session?.connection ?? "idle"}`
    : `${connectionKind} · offline`

  // z-30 lifts the header and its popover above the rail, which paints later
  // and would otherwise clip the menu at its edge.
  return (
    <header className="relative z-30 flex h-7 shrink-0 items-center gap-2 border-b-2 border-ink bg-pear px-2.5 text-pear-ink">
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full border border-ink ${
          world.connected
            ? (statusColor[session?.connection ?? "connected"] ?? "bg-success")
            : "bg-danger"
        }`}
        title={status}
      />
      <span className="shrink-0 font-display text-[12px] font-extrabold">Studio</span>
      <span className="min-w-0 flex-1" />
      <div ref={menuAreaRef} className="relative flex shrink-0 items-center">
        <button
          type="button"
          className="h-5 shrink-0 rounded border border-ink bg-surface px-1.5 font-mono text-micro leading-none text-ink"
          title="Settings"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-7 z-20 flex w-60 flex-col gap-2.5 rounded border-2 border-ink bg-surface p-2.5 text-ink shadow-hard"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-micro font-bold tracking-widest text-muted">
                THEME
              </span>
              <button
                type="button"
                className="h-6 rounded border border-ink bg-paper px-2 font-mono text-caption font-semibold"
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              >
                {theme === "light" ? "◐ Light" : "◑ Dark"}
              </button>
            </div>
            {canOpenSource ? (
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-micro font-bold tracking-widest text-muted">
                  SOURCE
                </span>
                <select
                  className="h-6 rounded border border-ink bg-paper px-1 font-mono text-caption text-ink"
                  value={sourceAction}
                  onChange={(event) =>
                    setSourceAction(event.target.value === "copy" ? "copy" : "open")
                  }
                >
                  <option value="open">Open</option>
                  <option value="copy">Copy</option>
                </select>
              </div>
            ) : null}
            {singleSession ? null : (
              <div className="flex flex-col gap-1">
                <span className="font-mono text-micro font-bold tracking-widest text-muted">
                  SESSION
                </span>
                <select
                  className="h-6 w-full rounded border border-ink bg-paper px-1 font-mono text-caption text-ink"
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
                {session === undefined || session.connection === "connected" ? null : (
                  <button
                    type="button"
                    className="h-6 rounded border border-ink bg-paper px-2 font-mono text-caption font-semibold"
                    onClick={() => {
                      removeSession(session.sessionId)
                      setMenuOpen(false)
                    }}
                  >
                    Dismiss session
                  </button>
                )}
              </div>
            )}
            <p className="font-mono text-micro text-muted">{status}</p>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="h-5 shrink-0 rounded border border-ink bg-surface px-1.5 font-mono text-micro leading-none text-ink"
        title={railCollapsed ? "Show panels" : "Hide panels"}
        aria-expanded={!railCollapsed}
        onClick={() => setRailCollapsed(!railCollapsed)}
      >
        ▤
      </button>
    </header>
  )
}
