import * as React from "react"

export type StudioTheme = "light" | "dark"
/** "open" delegates to the host's source opener; "link" renders an IDE deeplink. */
export type SourceAction = "open" | "link"
export type EditorId = "vscode" | "cursor"

export interface HostControls {
  readonly theme: StudioTheme
  readonly setTheme: (theme: StudioTheme) => void
  readonly sourceAction: SourceAction
  readonly setSourceAction: (action: SourceAction) => void
  readonly editor: EditorId
  readonly setEditor: (editor: EditorId) => void
  /** Prefixed onto dev-server-relative source paths so IDE deeplinks resolve. */
  readonly projectRoot: string
  readonly setProjectRoot: (root: string) => void
  readonly connectionKind: "direct" | "ws"
  readonly singleSession: boolean
  readonly canOpenSource: boolean
}

const defaultControls: HostControls = {
  theme: "light",
  setTheme: () => undefined,
  sourceAction: "link",
  setSourceAction: () => undefined,
  editor: "vscode",
  setEditor: () => undefined,
  projectRoot: "",
  setProjectRoot: () => undefined,
  connectionKind: "direct",
  singleSession: false,
  canOpenSource: false,
}

export const HostContext = React.createContext<HostControls>(defaultControls)

export const useHostControls = (): HostControls => React.useContext(HostContext)
