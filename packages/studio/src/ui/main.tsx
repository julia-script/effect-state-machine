import { WebSocketTransport } from "@effect-state-machine/studio-client"
import {
  type SourceAction,
  type StudioTheme,
  StudioViewer,
  ViewerClient,
} from "@effect-state-machine/studio-react"
import * as Effect from "effect/Effect"
import * as React from "react"
import { createRoot } from "react-dom/client"

const viewerUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/viewer`
const openSource: ViewerClient.Options["openSource"] = (source) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch("/editor/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source),
      })
      const result = (await response.json()) as { ok?: boolean; message?: string }
      if (result.ok !== true) throw new Error(result.message ?? "editor failed to open")
    },
    catch: (cause) => new ViewerClient.EditorOpenFailed({ message: String(cause) }),
  })
const viewerLayer = ViewerClient.layer({
  transport: WebSocketTransport.make({ url: viewerUrl }),
  openSource,
})

const readTheme = (): StudioTheme =>
  globalThis.localStorage.getItem("studio-theme") === "dark" ? "dark" : "light"
const readSourceAction = (): SourceAction =>
  globalThis.localStorage.getItem("studio-source-action") === "copy" ? "copy" : "open"

function StandaloneStudio() {
  const [theme, setTheme] = React.useState<StudioTheme>(readTheme)
  const [sourceAction, setSourceAction] = React.useState<SourceAction>(readSourceAction)

  const updateTheme = (next: StudioTheme) => {
    setTheme(next)
    globalThis.localStorage.setItem("studio-theme", next)
  }
  const updateSourceAction = (next: SourceAction) => {
    setSourceAction(next)
    globalThis.localStorage.setItem("studio-source-action", next)
  }

  return (
    <StudioViewer
      viewerLayer={viewerLayer}
      connectionKind="ws"
      theme={theme}
      onThemeChange={updateTheme}
      sourceAction={sourceAction}
      onSourceActionChange={updateSourceAction}
      style={{ height: "100%" }}
    />
  )
}

const container = document.getElementById("root")
if (container === null) throw new Error("missing #root container")

createRoot(container).render(<StandaloneStudio />)
