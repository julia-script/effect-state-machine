import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/unstable/reactivity"
import * as React from "react"
import { useHostControls } from "../HostContext.js"
import { openEditorAtom } from "../state/atoms.js"

interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
}

const shortFile = (file: string) => file.split("/").at(-1) ?? file

export function SourceLink({ location }: { readonly location: Location }) {
  const { sourceAction } = useHostControls()
  const openEditor = useAtomSet(openEditorAtom)
  const openState = useAtomValue(openEditorAtom)
  const [copied, setCopied] = React.useState(false)

  const reference = `${location.file}:${location.line}:${location.column}`
  const copy = () => {
    void navigator.clipboard.writeText(reference)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <span>
      <button
        type="button"
        className="max-w-full truncate font-mono text-caption text-focus underline"
        title={reference}
        onClick={() => {
          if (sourceAction === "open") openEditor(location)
          else copy()
        }}
      >
        {copied ? "Copied" : `${shortFile(location.file)}:${location.line}`}
      </button>
      {AsyncResult.isFailure(openState) ? (
        <span className="ml-1 font-mono text-micro text-danger" role="alert">
          Could not open source location.
        </span>
      ) : null}
    </span>
  )
}
