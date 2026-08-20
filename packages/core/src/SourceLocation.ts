import { encodeWellFormedUri } from "./Internal.js"
import type * as Source from "./Source.js"

/**
 * One-based source position suitable for display or editor navigation.
 *
 * @category models
 * @since 0.1.0
 */
export interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly functionName?: string
}

/**
 * Maps a generated position to its authored source position.
 *
 * **Details**
 *
 * Returning `undefined` marks the generated position as untrustworthy and omits it from tooling.
 *
 * @category transforming
 * @since 0.1.0
 */
export type Mapper = (generated: Location) => Location | undefined

/**
 * Converts a source location to an editor navigation link.
 *
 * @category converting
 * @since 0.1.0
 */
export type EditorResolver = (location: Location) => string | undefined

const internalFrame = (file: string): boolean =>
  /(?:^|\/)src\/(?:Machine|Source)\.[cm]?[jt]s$/.test(file) ||
  /(?:^|\/)dist\/(?:Machine|Source)\.js$/.test(file) ||
  /node_modules\/effect-state-machine\/(?:src|dist)\/(?:Machine|Source)/.test(file) ||
  // Vite pre-bundles the whole library into one flattened dev module.
  /node_modules\/\.vite\/deps\/effect-state-machine(?:\.|_)/.test(file)

const location = (
  file: string,
  line: string,
  column: string,
  functionName?: string,
): Location | undefined => {
  const parsedLine = Number(line)
  const parsedColumn = Number(column)
  if (
    file.length === 0 ||
    file === "<anonymous>" ||
    file.startsWith("node:") ||
    (/^https?:/.test(file) && /\.html(?:$|[?#])/.test(file)) ||
    !Number.isInteger(parsedLine) ||
    !Number.isInteger(parsedColumn) ||
    parsedLine < 1 ||
    parsedColumn < 1
  ) {
    return undefined
  }
  let decoded = file
  if (/^https?:/.test(decoded)) {
    // Dev servers append cache-busting queries (?t=, ?v=) that would defeat
    // internal-frame detection and source-map lookup.
    decoded = decoded.replace(/[?#].*$/, "")
  }
  if (decoded.startsWith("file://")) {
    try {
      decoded = decodeURIComponent(new URL(decoded).pathname)
    } catch {
      return undefined
    }
  }
  return {
    file: decoded,
    line: parsedLine,
    column: parsedColumn,
    ...(functionName === undefined || functionName.length === 0 ? {} : { functionName }),
  }
}

/**
 * Parses a Node- or browser-style stack frame into a validated source location.
 *
 * **Details**
 *
 * Node internals, anonymous frames, HTML document frames, and non-positive positions are rejected.
 * File URLs are decoded to filesystem paths.
 *
 * @category decoding
 * @since 0.1.0
 */
export const parseFrame = (frame: string): Location | undefined => {
  const trimmed = frame.trim()
  const nodeWithFunction = /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/.exec(trimmed)
  if (nodeWithFunction !== null) {
    return location(
      nodeWithFunction[2],
      nodeWithFunction[3],
      nodeWithFunction[4],
      nodeWithFunction[1],
    )
  }
  const node = /^at\s+(.+):(\d+):(\d+)$/.exec(trimmed)
  if (node !== null) return location(node[1], node[2], node[3])
  const browser = /^(.*?)@(.+):(\d+):(\d+)$/.exec(trimmed)
  if (browser !== null) return location(browser[2], browser[3], browser[4], browser[1])
  return undefined
}

/**
 * Resolves the first trustworthy authored location from a captured source reference.
 *
 * **Details**
 *
 * Internal library frames are skipped before and after optional mapping. Resolution is best-effort
 * and returns `undefined` when no usable frame remains.
 *
 * @category converting
 * @since 0.1.0
 */
export const resolve = (
  reference: Source.Reference | undefined,
  options?: Readonly<{ map?: Mapper }>,
): Location | undefined => {
  const stack = reference?.stack()
  if (stack === undefined) return undefined
  for (const frame of stack.split("\n")) {
    const parsed = parseFrame(frame)
    if (parsed === undefined || internalFrame(parsed.file)) continue
    const mapped = options?.map === undefined ? parsed : options.map(parsed)
    if (mapped === undefined || internalFrame(mapped.file)) continue
    return mapped
  }
  return undefined
}

const editorLink = (scheme: "vscode" | "cursor", source: Location): string => {
  const path = source.file.startsWith("/") ? source.file : `/${source.file}`
  return `${scheme}://file${encodeWellFormedUri(path)}:${source.line}:${source.column}`
}

/**
 * Resolves a source location to a VS Code `vscode://file` link.
 *
 * @category converting
 * @since 0.1.0
 */
export const vscode: EditorResolver = (source) => editorLink("vscode", source)

/**
 * Resolves a source location to a Cursor `cursor://file` link.
 *
 * @category converting
 * @since 0.1.0
 */
export const cursor: EditorResolver = (source) => editorLink("cursor", source)
