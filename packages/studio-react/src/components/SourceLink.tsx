import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/unstable/reactivity"
import * as SourceLocation from "effect-state-machine/SourceLocation"
import { useHostControls } from "../HostContext.js"
import { currentSessionAtom, openEditorAtom } from "../state/atoms.js"

interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
}

// Strip any ?query (dev servers append cache-busting params) before shortening.
const shortFile = (file: string) => (file.split("?")[0] ?? file).split("/").at(-1) ?? file

// ponytail: string-prefix join — dev-server-relative paths ("/main.tsx") can't
// be told apart from absolute ones, so an already-rooted path is left alone.
const absolutize = (file: string, root: string): string => {
  if (root.length === 0 || file.startsWith(root) || /^[A-Za-z]:[\\/]/.test(file)) return file
  return `${root.replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`
}

const linkClass =
  "min-w-0 truncate font-mono text-caption text-muted underline decoration-rule underline-offset-2 hover:text-ink hover:decoration-ink"

export function SourceLink({ location }: { readonly location: Location }) {
  const { editor, projectRoot, sourceAction } = useHostControls()
  const session = useAtomValue(currentSessionAtom)
  const openEditor = useAtomSet(openEditorAtom)
  const openState = useAtomValue(openEditorAtom)

  // The settings field overrides the root the attached app announced about itself.
  const root = projectRoot.length > 0 ? projectRoot : (session?.hello.app.projectRoot ?? "")

  // http(s) files mean source-map resolution failed; there is nothing an IDE
  // could open, so the reference renders as plain text.
  const linkable = !/^https?:/.test(location.file)
  const resolved = linkable ? { ...location, file: absolutize(location.file, root) } : location
  const reference = `${resolved.file}:${resolved.line}:${resolved.column}`
  const label = `${shortFile(resolved.file)}:${resolved.line}`

  return (
    <span className="flex min-w-0 shrink items-baseline">
      {sourceAction === "open" ? (
        <button
          type="button"
          className={linkClass}
          title={reference}
          onClick={() => openEditor(resolved)}
        >
          {label}
        </button>
      ) : linkable ? (
        <a
          className={linkClass}
          title={reference}
          href={(editor === "cursor" ? SourceLocation.cursor : SourceLocation.vscode)(resolved)}
        >
          {label}
        </a>
      ) : (
        <span className="min-w-0 truncate font-mono text-caption text-muted" title={reference}>
          {label}
        </span>
      )}
      {sourceAction === "open" && AsyncResult.isFailure(openState) ? (
        <span className="ml-1 font-mono text-micro text-danger" role="alert">
          Could not open source location.
        </span>
      ) : null}
    </span>
  )
}
