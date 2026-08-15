/// <reference path="./types/assets.d.ts" />

import { RegistryProvider } from "@effect/atom-react"
import type * as Layer from "effect/Layer"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as React from "react"
import { createPortal } from "react-dom"
import { App } from "./App.js"
import { type EditorId, HostContext, type SourceAction, type StudioTheme } from "./HostContext.js"
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

// IDE preference and project root are viewer-local settings, not host API:
// persisted directly so both embedded and standalone Studio remember them.
const readSetting = (key: string): string | undefined => {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
const writeSetting = (key: string, value: string): void => {
  try {
    globalThis.localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable (sandboxed iframe); the setting just won't persist.
  }
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
  defaultSourceAction = canOpenSource ? "open" : "link",
  onSourceActionChange,
  className,
  style,
}: StudioViewerProps) {
  const [shadowRoot, setShadowRoot] = React.useState<ShadowRoot | undefined>(undefined)
  const [localTheme, setLocalTheme] = React.useState<StudioTheme>(defaultTheme)
  const [localSourceAction, setLocalSourceAction] =
    React.useState<SourceAction>(defaultSourceAction)
  const [editor, setEditorState] = React.useState<EditorId>(() =>
    readSetting("studio-editor") === "cursor" ? "cursor" : "vscode",
  )
  const [projectRoot, setProjectRootState] = React.useState<string>(
    () => readSetting("studio-project-root") ?? "",
  )
  const theme = controlledTheme ?? localTheme
  const sourceAction = canOpenSource ? (controlledSourceAction ?? localSourceAction) : "link"

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
  const setEditor = React.useCallback((next: EditorId) => {
    setEditorState(next)
    writeSetting("studio-editor", next)
  }, [])
  const setProjectRoot = React.useCallback((next: string) => {
    setProjectRootState(next)
    writeSetting("studio-project-root", next)
  }, [])

  const controls = React.useMemo(
    () => ({
      theme,
      setTheme,
      sourceAction,
      setSourceAction,
      editor,
      setEditor,
      projectRoot,
      setProjectRoot,
      connectionKind,
      singleSession,
      canOpenSource,
    }),
    [
      canOpenSource,
      connectionKind,
      editor,
      projectRoot,
      setEditor,
      setProjectRoot,
      setSourceAction,
      setTheme,
      singleSession,
      sourceAction,
      theme,
    ],
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
