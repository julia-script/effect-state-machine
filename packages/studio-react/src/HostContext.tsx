import * as React from "react"

export type StudioTheme = "light" | "dark"
export type SourceAction = "open" | "copy"

export interface HostControls {
  readonly theme: StudioTheme
  readonly setTheme: (theme: StudioTheme) => void
  readonly sourceAction: SourceAction
  readonly setSourceAction: (action: SourceAction) => void
  readonly connectionKind: "direct" | "ws"
  readonly singleSession: boolean
  readonly canOpenSource: boolean
}

const defaultControls: HostControls = {
  theme: "light",
  setTheme: () => undefined,
  sourceAction: "copy",
  setSourceAction: () => undefined,
  connectionKind: "direct",
  singleSession: false,
  canOpenSource: false,
}

export const HostContext = React.createContext<HostControls>(defaultControls)

export const useHostControls = (): HostControls => React.useContext(HostContext)
