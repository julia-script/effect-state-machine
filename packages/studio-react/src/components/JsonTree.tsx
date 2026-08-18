import * as React from "react"

const Missing = Symbol("JsonTree.Missing")
type TreeValue = unknown | typeof Missing
type DiffKind = "same" | "added" | "removed" | "changed"

const isObject = (value: TreeValue): value is Readonly<Record<string, unknown>> =>
  value !== Missing && typeof value === "object" && value !== null && !Array.isArray(value)

const isContainer = (value: TreeValue): boolean => Array.isArray(value) || isObject(value)

const sizeOf = (value: TreeValue): number =>
  Array.isArray(value) ? value.length : isObject(value) ? Object.keys(value).length : 0

const compactArray = (value: TreeValue): value is ReadonlyArray<unknown> =>
  Array.isArray(value) &&
  value.length <= 16 &&
  value.every(
    (item) =>
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean",
  )

const primitiveText = (value: TreeValue): string => {
  if (value === Missing) return "undefined"
  if (value === undefined) return "undefined"
  if (typeof value === "bigint") return `${value}n`
  return JSON.stringify(value) ?? String(value)
}

const summary = (value: TreeValue): string => {
  if (Array.isArray(value)) return `[…] ${value.length} ${value.length === 1 ? "item" : "items"}`
  if (isObject(value)) {
    const count = Object.keys(value).length
    return `{…} ${count} ${count === 1 ? "key" : "keys"}`
  }
  return primitiveText(value)
}

const sameValue = (left: TreeValue, right: TreeValue): boolean => {
  if (left === Missing || right === Missing) return left === right
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
    )
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
    )
  }
  return false
}

const diffKind = (value: TreeValue, previous: TreeValue, enabled: boolean): DiffKind => {
  if (!enabled) return "same"
  if (previous === Missing) return "added"
  if (value === Missing) return "removed"
  return sameValue(value, previous) ? "same" : "changed"
}

const rowTone = (kind: DiffKind): string =>
  kind === "added"
    ? "bg-success-soft text-success"
    : kind === "removed"
      ? "bg-danger-soft text-danger line-through"
      : kind === "changed"
        ? "border-l-2 border-cyan-ink bg-paper-2 text-cyan-ink"
        : ""

const pathFor = (parent: string, key: string | number): string =>
  `${parent}/${encodeURIComponent(String(key))}`

const defaultExpanded = (value: TreeValue, path: string, depth: number): boolean =>
  path === "$" || (depth < 2 && sizeOf(value) <= 8)

interface TreeNodeProps {
  readonly value: TreeValue
  readonly previous: TreeValue
  readonly path: string
  readonly label?: string
  readonly depth: number
  readonly diff: boolean
  readonly expansion: Readonly<Record<string, boolean>>
  readonly setExpanded: (path: string, expanded: boolean) => void
}

function TreeNode({
  value,
  previous,
  path,
  label,
  depth,
  diff,
  expansion,
  setExpanded,
}: TreeNodeProps) {
  const displayed = value === Missing ? previous : value
  const kind = diffKind(value, previous, diff)
  const prefix =
    label === undefined ? null : (
      <span className="font-bold text-muted">{JSON.stringify(label)}: </span>
    )

  if (!isContainer(displayed) || compactArray(displayed)) {
    return (
      <div
        className={`rounded-sm px-1 leading-5 break-all ${rowTone(kind)}`}
        data-json-path={path}
        data-diff={kind}
      >
        {prefix}
        <span>{compactArray(displayed) ? primitiveText(displayed) : primitiveText(displayed)}</span>
      </div>
    )
  }

  const expanded = expansion[path] ?? defaultExpanded(displayed, path, depth)
  const currentArray = Array.isArray(value) ? value : undefined
  const previousArray = Array.isArray(previous) ? previous : undefined
  const currentObject = isObject(value) ? value : undefined
  const previousObject = isObject(previous) ? previous : undefined
  const keys: ReadonlyArray<string | number> =
    currentArray !== undefined || previousArray !== undefined
      ? Array.from(
          { length: Math.max(currentArray?.length ?? 0, previousArray?.length ?? 0) },
          (_, index) => index,
        )
      : Array.from(
          new Set([
            ...Object.keys(currentObject ?? {}),
            ...(diff ? Object.keys(previousObject ?? {}) : []),
          ]),
        )

  return (
    <div data-json-path={path} data-diff={kind}>
      <button
        type="button"
        className={`flex w-full items-baseline gap-1 rounded-sm px-1 text-left leading-5 ${rowTone(kind)}`}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${label ?? "root"}`}
        onClick={() => setExpanded(path, !expanded)}
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-muted">
          {expanded ? "▾" : "▸"}
        </span>
        {prefix}
        <span className="text-muted">{summary(displayed)}</span>
      </button>
      {expanded ? (
        <div className="border-l border-ink/20 pl-2" style={{ marginLeft: 6 }}>
          {keys.map((key) => {
            const current =
              typeof key === "number"
                ? currentArray === undefined || key >= currentArray.length
                  ? Missing
                  : currentArray[key]
                : currentObject === undefined || !Object.hasOwn(currentObject, key)
                  ? Missing
                  : currentObject[key]
            const before =
              typeof key === "number"
                ? previousArray === undefined || key >= previousArray.length
                  ? Missing
                  : previousArray[key]
                : previousObject === undefined || !Object.hasOwn(previousObject, key)
                  ? Missing
                  : previousObject[key]
            return (
              <TreeNode
                key={String(key)}
                value={current}
                previous={before}
                path={pathFor(path, key)}
                label={String(key)}
                depth={depth + 1}
                diff={diff}
                expansion={expansion}
                setExpanded={setExpanded}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export interface JsonTreeProps {
  readonly value: unknown
  readonly previous?: unknown
  readonly diff?: boolean
  readonly className?: string
}

/** Compact, shadow-root-safe JSON inspection with path-stable expansion and structured diffs. */
export function JsonTree({ value, previous, diff = false, className }: JsonTreeProps) {
  const [expansion, setExpansion] = React.useState<Readonly<Record<string, boolean>>>({})
  const setExpanded = React.useCallback((path: string, expanded: boolean) => {
    setExpansion((current) => ({ ...current, [path]: expanded }))
  }, [])

  return (
    <div className={`font-mono text-caption ${className ?? ""}`}>
      <TreeNode
        value={value}
        previous={diff ? previous : Missing}
        path="$"
        depth={0}
        diff={diff}
        expansion={expansion}
        setExpanded={setExpanded}
      />
    </div>
  )
}
