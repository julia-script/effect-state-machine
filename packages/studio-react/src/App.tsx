import { useAtom, useAtomValue } from "@effect/atom-react"
import { BehaviorMap } from "./components/BehaviorMap.js"
import { DetailCard } from "./components/DetailCard.js"
import { EventsPanel } from "./components/EventsPanel.js"
import { HistoryPanel } from "./components/HistoryPanel.js"
import { RailTabs } from "./components/RailTabs.js"
import { StatePanel } from "./components/StatePanel.js"
import { TopBar } from "./components/TopBar.js"
import { useHostControls } from "./HostContext.js"
import {
  currentSessionAtom,
  railCollapsedAtom,
  railTabAtom,
  selectionAtom,
  worldViewAtom,
} from "./state/atoms.js"
import type { SessionView } from "./state/ViewerClient.js"

function SelectionDetails({ session }: { readonly session: SessionView }) {
  const [selection, setSelection] = useAtom(selectionAtom(session.sessionId))
  if (selection === undefined) {
    return (
      <p className="px-3 py-2.5 text-caption text-muted">
        No node selected. Click a state or transition on the map.
      </p>
    )
  }
  return (
    <DetailCard session={session} selection={selection} onClose={() => setSelection(undefined)} />
  )
}

/**
 * State stays pinned: it is the context you read *while* dispatching events or
 * scrubbing history. Only the genuinely secondary panels sit behind tabs.
 */
function Rail({ session }: { readonly session: SessionView }) {
  const tab = useAtomValue(railTabAtom)
  return (
    <>
      <StatePanel session={session} />
      <RailTabs />
      {/* Details lives behind a tab on purpose: selecting a node while
          navigating must not force the card open. */}
      {tab === "details" ? <SelectionDetails session={session} /> : null}
      {tab === "events" ? <EventsPanel session={session} /> : null}
      {tab === "history" ? <HistoryPanel session={session} /> : null}
    </>
  )
}

export function App() {
  const { connectionKind, theme } = useHostControls()
  const session = useAtomValue(currentSessionAtom)
  const world = useAtomValue(worldViewAtom)
  const railCollapsed = useAtomValue(railCollapsedAtom)

  // Rail placement (beside vs under the map) is decided by the CSS container
  // query on .studio-surface in theme.css — no JS measurement.
  return (
    <div className="studio-surface flex h-full flex-col" data-theme={theme}>
      <TopBar />
      {session === undefined ? (
        <div className="flex flex-1 items-center justify-center p-4">
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
        <div className="studio-body">
          <BehaviorMap session={session} />
          {railCollapsed ? null : (
            <aside className="studio-rail">
              <Rail session={session} />
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
