"use client"

import * as React from "react"

type CopyState = "idle" | "loading" | "copied" | "error"

export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  readonly value: string
  readonly label?: string
  readonly className?: string
}) {
  const [state, setState] = React.useState<CopyState>("idle")

  React.useEffect(() => {
    if (state !== "copied" && state !== "error") {
      return
    }
    const timer = window.setTimeout(() => setState("idle"), 2500)
    return () => window.clearTimeout(timer)
  }, [state])

  async function onCopy() {
    setState("loading")
    try {
      await navigator.clipboard.writeText(value)
      setState("copied")
    } catch {
      setState("error")
    }
  }

  const visibleLabel =
    state === "copied"
      ? "Copied"
      : state === "error"
        ? "Blocked"
        : state === "loading"
          ? "Copying"
          : label

  return (
    <button
      type="button"
      className={className ?? "copy-btn"}
      data-state={state}
      onClick={() => void onCopy()}
      disabled={state === "loading"}
      aria-live="polite"
    >
      <span className="copy-btn__label">{visibleLabel}</span>
    </button>
  )
}
