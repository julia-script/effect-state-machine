"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { appName, docsRoute, gitConfig } from "@/lib/shared"

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`
const installCommand = "pnpm add effect-state-machine effect@4.0.0-beta.106"

interface CommandItem {
  readonly id: string
  readonly group: string
  readonly label: string
  readonly href?: string
  readonly action?: "copy-install"
}

const commands: ReadonlyArray<CommandItem> = [
  {
    id: "first-machine",
    group: "Tutorials",
    label: "Build your first machine",
    href: `${docsRoute}/tutorials/first-machine`,
  },
  {
    id: "studio",
    group: "Tutorials",
    label: "Explore an embedded Studio",
    href: `${docsRoute}/tutorials/embedded-studio`,
  },
  {
    id: "invoke",
    group: "Guides",
    label: "Run an Effect when a state becomes active",
    href: `${docsRoute}/guides/invoke-effects`,
  },
  {
    id: "parallel",
    group: "Guides",
    label: "Model parallel regions",
    href: `${docsRoute}/guides/model-parallel-regions`,
  },
  {
    id: "guards",
    group: "Guides",
    label: "Choose transitions with guards",
    href: `${docsRoute}/guides/guards-and-ignored-events`,
  },
  {
    id: "retry",
    group: "Guides",
    label: "Retry invoked work",
    href: `${docsRoute}/guides/retry-invoked-work`,
  },
  {
    id: "child",
    group: "Guides",
    label: "Compose behavior with a child machine",
    href: `${docsRoute}/guides/child-machines`,
  },
  {
    id: "observe",
    group: "Guides",
    label: "Observe a running machine",
    href: `${docsRoute}/guides/observe-a-machine`,
  },
  {
    id: "visualize",
    group: "Guides",
    label: "Visualize a machine definition",
    href: `${docsRoute}/guides/visualize-a-definition`,
  },
  {
    id: "definition",
    group: "Reference",
    label: "Machine definition API",
    href: `${docsRoute}/reference/machine-definition`,
  },
  {
    id: "runtime",
    group: "Reference",
    label: "Machine runtime API",
    href: `${docsRoute}/reference/machine-runtime`,
  },
  {
    id: "devtools",
    group: "Reference",
    label: "Graph, Mermaid, and Studio",
    href: `${docsRoute}/reference/devtools`,
  },
  {
    id: "effect-native",
    group: "Reference",
    label: "Why the library is Effect-native",
    href: `${docsRoute}/explanation/effect-native-design`,
  },
  { id: "install", group: "Actions", label: "Copy install command", action: "copy-install" },
  { id: "github", group: "Actions", label: "Open the GitHub repository", href: githubUrl },
]

function matchesQuery(label: string, query: string) {
  return label.toLowerCase().includes(query.trim().toLowerCase())
}

function highlight(label: string, query: string) {
  const needle = query.trim()
  if (needle.length === 0) {
    return label
  }
  const index = label.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) {
    return label
  }
  return (
    <>
      {label.slice(0, index)}
      <mark>{label.slice(index, index + needle.length)}</mark>
      {label.slice(index + needle.length)}
    </>
  )
}

export function LandingNav() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const [copied, setCopied] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const dialogRef = React.useRef<HTMLDivElement>(null)

  const results = React.useMemo(
    () => commands.filter((item) => matchesQuery(item.label, query)),
    [query],
  )

  const grouped = React.useMemo(() => {
    const groups: Array<{ name: string; items: Array<CommandItem & { index: number }> }> = []
    for (const [index, item] of results.entries()) {
      const last = groups.at(-1)
      if (last === undefined || last.name !== item.group) {
        groups.push({ name: item.group, items: [{ ...item, index }] })
      } else {
        last.items.push({ ...item, index })
      }
    }
    return groups
  }, [results])

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }
    setQuery("")
    setActive(0)
    setCopied(false)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      document.body.style.overflow = previousOverflow
      window.clearTimeout(focusTimer)
    }
  }, [open])

  async function runItem(item: CommandItem) {
    if (item.action === "copy-install") {
      try {
        await navigator.clipboard.writeText(installCommand)
        setCopied(true)
        window.setTimeout(() => setOpen(false), 700)
      } catch {
        setCopied(false)
      }
      return
    }
    if (item.href === undefined) {
      return
    }
    setOpen(false)
    if (item.href.startsWith("http")) {
      window.open(item.href, "_blank", "noopener,noreferrer")
      return
    }
    router.push(item.href)
  }

  function onDialogKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((current) => Math.min(current + 1, Math.max(results.length - 1, 0)))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const item = results[active]
      if (item !== undefined) {
        void runItem(item)
      }
      return
    }
    if (event.key !== "Tab") {
      return
    }
    const root = dialogRef.current
    if (root === null) {
      return
    }
    const nodes = [...root.querySelectorAll<HTMLElement>("input, button")]
    const first = nodes[0]
    const last = nodes.at(-1)
    if (first === undefined || last === undefined) {
      return
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <header className="landing-nav">
        <div className="landing-nav__inner">
          <Link className="landing-nav__brand" href="/" aria-current="page">
            {appName}
          </Link>
          <nav className="landing-nav__links" aria-label="Primary">
            <Link className="landing-nav__link" href={`${docsRoute}/tutorials/embedded-studio`}>
              Studio
            </Link>
            <Link className="landing-nav__link" href={`${docsRoute}/tutorials/first-machine`}>
              Tutorial
            </Link>
          </nav>
          <button
            type="button"
            className="searchpill"
            onClick={() => setOpen(true)}
            aria-label="Search documentation (Control or Command K)"
          >
            <span className="searchpill__text">Search</span>
            <kbd className="searchpill__kbd">⌘K</kbd>
          </button>
          <Link className="btn btn--primary" href={docsRoute}>
            Docs
          </Link>
        </div>
      </header>

      <div className={open ? "cmdk is-open" : "cmdk"} aria-hidden={open ? undefined : true}>
        <button
          type="button"
          className="cmdk__backdrop"
          tabIndex={-1}
          aria-label="Close search"
          onClick={() => setOpen(false)}
        />
        <div
          ref={dialogRef}
          className="cmdk__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cmdk-title"
          hidden={!open}
          onKeyDown={onDialogKey}
        >
          <h2 id="cmdk-title" className="cmdk__title">
            Search documentation
          </h2>
          <div className="cmdk__field">
            <input
              ref={inputRef}
              id="cmdk-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              placeholder="Search docs…"
              aria-controls="cmdk-results"
              aria-activedescendant={
                results[active] === undefined ? undefined : `cmdk-${results[active].id}`
              }
            />
            <kbd>esc</kbd>
          </div>
          <div
            id="cmdk-results"
            className="cmdk__results"
            role="listbox"
            aria-label="Search results"
          >
            {results.length === 0 ? (
              <p className="cmdk__empty">No matching pages. Try “invoke” or “studio”.</p>
            ) : (
              grouped.map((group) => (
                <div key={group.name} className="cmdk__group">
                  <p className="cmdk__group-label" id={`cmdk-group-${group.name}`}>
                    {group.name}
                  </p>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      id={`cmdk-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={item.index === active}
                      className={item.index === active ? "cmdk__item is-active" : "cmdk__item"}
                      onMouseEnter={() => setActive(item.index)}
                      onClick={() => void runItem(item)}
                    >
                      {item.action === "copy-install" && copied
                        ? "Copied install command"
                        : highlight(item.label, query)}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="cmdk__foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
