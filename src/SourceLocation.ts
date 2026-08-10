import type * as Source from "./Source.js"

export interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly functionName?: string
}

export type Mapper = (generated: Location) => Location | undefined
export type EditorResolver = (location: Location) => string | undefined

const internalFrame = (file: string): boolean =>
  /(?:^|\/)src\/(?:Machine|Source)\.[cm]?[jt]s$/.test(file) ||
  /(?:^|\/)dist\/(?:Machine|Source)\.js$/.test(file) ||
  /node_modules\/effect-state-machine\/(?:src|dist)\/(?:Machine|Source)/.test(file)

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

export const resolve = (
  reference: Source.Reference | undefined,
  options?: Readonly<{ map?: Mapper }>,
): Location | undefined => {
  const stack = reference?.stack()
  if (stack === undefined) return undefined
  for (const frame of stack.split("\n")) {
    const parsed = parseFrame(frame)
    if (parsed === undefined || internalFrame(parsed.file)) continue
    return options?.map?.(parsed) ?? parsed
  }
  return undefined
}

const editorLink = (scheme: "vscode" | "cursor", source: Location): string => {
  const path = source.file.startsWith("/") ? source.file : `/${source.file}`
  return `${scheme}://file${encodeURI(path)}:${source.line}:${source.column}`
}

export const vscode: EditorResolver = (source) => editorLink("vscode", source)
export const cursor: EditorResolver = (source) => editorLink("cursor", source)
