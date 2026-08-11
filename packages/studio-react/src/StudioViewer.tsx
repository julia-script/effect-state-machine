/// <reference path="./types/assets.d.ts" />

import { RegistryProvider } from "@effect/atom-react"
import type * as Layer from "effect/Layer"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as React from "react"
import { createPortal } from "react-dom"
import { App } from "./App.js"
import { HostContext, type SourceAction, type StudioTheme } from "./HostContext.js"
import * as StudioAtoms from "./state/atoms.js"
import type * as ViewerClient from "./state/ViewerClient.js"
import styleText from "./theme.css?inline"

export interface StudioViewerProps {
  readonly viewerLayer: Layer.Layer<ViewerClient.ViewerClient>
  readonly registryKey?: React.Key
  readonly connectionKind?: "direct" | "ws"
  readonly singleSession?: boolean
  readonly canOpenSource?: boolean
  readonly theme?: StudioTheme
  readonly defaultTheme?: StudioTheme
  readonly onThemeChange?: (theme: StudioTheme) => void
  readonly sourceAction?: SourceAction
  readonly defaultSourceAction?: SourceAction
  readonly onSourceActionChange?: (action: SourceAction) => void
  readonly className?: string
  readonly style?: React.CSSProperties
}

export function StudioViewer({
  viewerLayer,
  registryKey,
  connectionKind = "ws",
  singleSession = false,
  canOpenSource = true,
  theme: controlledTheme,
  defaultTheme = "light",
  onThemeChange,
  sourceAction: controlledSourceAction,
  defaultSourceAction = canOpenSource ? "open" : "copy",
  onSourceActionChange,
  className,
  style,
}: StudioViewerProps) {
  const [shadowRoot, setShadowRoot] = React.useState<ShadowRoot | undefined>(undefined)
  const [localTheme, setLocalTheme] = React.useState<StudioTheme>(defaultTheme)
  const [localSourceAction, setLocalSourceAction] =
    React.useState<SourceAction>(defaultSourceAction)
  const theme = controlledTheme ?? localTheme
  const sourceAction = canOpenSource ? (controlledSourceAction ?? localSourceAction) : "copy"

  const hostRef = React.useCallback((host: HTMLDivElement | null) => {
    if (host === null) return
    setShadowRoot(host.shadowRoot ?? host.attachShadow({ mode: "open" }))
  }, [])

  const setTheme = React.useCallback(
    (next: StudioTheme) => {
      if (controlledTheme === undefined) setLocalTheme(next)
      onThemeChange?.(next)
    },
    [controlledTheme, onThemeChange],
  )
  const setSourceAction = React.useCallback(
    (next: SourceAction) => {
      if (controlledSourceAction === undefined) setLocalSourceAction(next)
      onSourceActionChange?.(next)
    },
    [controlledSourceAction, onSourceActionChange],
  )

  const controls = React.useMemo(
    () => ({
      theme,
      setTheme,
      sourceAction,
      setSourceAction,
      connectionKind,
      singleSession,
      canOpenSource,
    }),
    [canOpenSource, connectionKind, setSourceAction, setTheme, singleSession, sourceAction, theme],
  )

  return (
    <div
      ref={hostRef}
      className={className}
      data-effect-state-machine-studio=""
      style={{ display: "block", height: 640, width: "100%", ...style }}
    >
      {shadowRoot === undefined
        ? null
        : createPortal(
            <>
              <style data-studio-styles="">{styleText}</style>
              <RegistryProvider
                key={registryKey}
                initialValues={[Atom.initialValue(StudioAtoms.runtime.layer, viewerLayer)]}
              >
                <HostContext.Provider value={controls}>
                  <App />
                </HostContext.Provider>
              </RegistryProvider>
            </>,
            shadowRoot,
          )}
    </div>
  )
}
