import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as React from "react"
import { openEditorAtom, sourceActionAtom } from "../state/atoms.js"

interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
}

const shortFile = (file: string) => file.split("/").at(-1) ?? file

export function SourceLink({ location }: { readonly location: Location }) {
  const sourceAction = useAtomValue(sourceActionAtom)
  const openEditor = useAtomSet(openEditorAtom)
  const [copied, setCopied] = React.useState(false)

  const reference = `${location.file}:${location.line}:${location.column}`
  const copy = () => {
    void navigator.clipboard.writeText(reference)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      type="button"
      className="max-w-full truncate font-mono text-[10px] text-focus underline"
      title={reference}
      onClick={() => {
        if (sourceAction === "editor") openEditor(location)
        else copy()
      }}
    >
      {copied ? "Copied" : `${shortFile(location.file)}:${location.line}`}
    </button>
  )
}
