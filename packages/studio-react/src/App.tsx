import { useAtom, useAtomValue } from "@effect/atom-react"
import { BehaviorMap } from "./components/BehaviorMap.js"
import { DetailCard } from "./components/DetailCard.js"
import { EventsPanel } from "./components/EventsPanel.js"
import { HistoryPanel } from "./components/HistoryPanel.js"
import { StatePanel } from "./components/StatePanel.js"
import { TopBar } from "./components/TopBar.js"
import { useHostControls } from "./HostContext.js"
import {
  currentSessionAtom,
  railCollapsedAtom,
  selectionAtom,
  worldViewAtom,
} from "./state/atoms.js"
import type { SessionView } from "./state/ViewerClient.js"

function SelectionDetails({ session }: { readonly session: SessionView }) {
  const [selection, setSelection] = useAtom(selectionAtom(session.sessionId))
  if (selection === undefined) return null
  return (
    <DetailCard session={session} selection={selection} onClose={() => setSelection(undefined)} />
  )
}

export function App() {
  const { connectionKind, theme } = useHostControls()
  const session = useAtomValue(currentSessionAtom)
  const world = useAtomValue(worldViewAtom)
  const railCollapsed = useAtomValue(railCollapsedAtom)

  return (
    <div className="studio-surface flex h-full flex-col" data-theme={theme}>
      <TopBar />
      {session === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <h1 className="font-display text-2xl font-extrabold">Studio</h1>
            <p className="mt-2 text-sm text-muted">
              {world.connected
                ? "Waiting for an application to connect. Attach a machine and it will appear here."
                : connectionKind === "direct"
                  ? "Connecting directly to the machine…"
                  : "Connecting to the studio server…"}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <BehaviorMap session={session} />
          {railCollapsed ? null : (
            <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l-2 border-ink bg-surface">
              <SelectionDetails session={session} />
              <StatePanel session={session} />
              <EventsPanel session={session} />
              <HistoryPanel session={session} />
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
