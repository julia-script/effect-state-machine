import { useAtomValue } from "@effect/atom-react"
import * as React from "react"
import { BehaviorMap } from "./components/BehaviorMap.js"
import { EventsPanel } from "./components/EventsPanel.js"
import { HistoryPanel } from "./components/HistoryPanel.js"
import { StatePanel } from "./components/StatePanel.js"
import { TopBar } from "./components/TopBar.js"
import { currentSessionAtom, railCollapsedAtom, themeAtom, worldViewAtom } from "./state/atoms.js"

export function App() {
  const theme = useAtomValue(themeAtom)
  const session = useAtomValue(currentSessionAtom)
  const world = useAtomValue(worldViewAtom)
  const railCollapsed = useAtomValue(railCollapsedAtom)

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {session === undefined ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-md text-center">
            <h1 className="font-display text-2xl font-extrabold">Studio</h1>
            <p className="mt-2 text-sm text-muted">
              {world.connected
                ? "Waiting for an application to connect. Attach a machine and it will appear here."
                : "Connecting to the studio server…"}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <BehaviorMap session={session} />
          {railCollapsed ? null : (
            <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l-2 border-ink bg-surface">
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
