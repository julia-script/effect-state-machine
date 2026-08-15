import type { SourceLocation } from "effect-state-machine/devtools"

interface Segment {
  readonly generatedColumn: number
  readonly sourceIndex: number
  readonly sourceLine: number
  readonly sourceColumn: number
}

interface DecodedMap {
  readonly sources: ReadonlyArray<string>
  readonly lines: ReadonlyArray<ReadonlyArray<Segment>>
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

const decodeVlq = (encoded: string): ReadonlyArray<number> | undefined => {
  const values: Array<number> = []
  let value = 0
  let shift = 0
  for (const char of encoded) {
    const digit = BASE64.indexOf(char)
    if (digit === -1) return undefined
    value += (digit & 31) * 2 ** shift
    if ((digit & 32) !== 0) {
      shift += 5
      continue
    }
    const magnitude = (value - (value % 2)) / 2
    values.push(value % 2 === 1 ? -magnitude : magnitude)
    value = 0
    shift = 0
  }
  return shift === 0 ? values : undefined
}

const decodeMappings = (mappings: string): ReadonlyArray<ReadonlyArray<Segment>> | undefined => {
  const lines: Array<Array<Segment>> = []
  let sourceIndex = 0
  let sourceLine = 0
  let sourceColumn = 0
  for (const encodedLine of mappings.split(";")) {
    const segments: Array<Segment> = []
    let generatedColumn = 0
    for (const encodedSegment of encodedLine.split(",")) {
      if (encodedSegment.length === 0) continue
      const values = decodeVlq(encodedSegment)
      if (values === undefined || values.length < 1) return undefined
      generatedColumn += values[0] ?? 0
      if (values.length >= 4) {
        sourceIndex += values[1] ?? 0
        sourceLine += values[2] ?? 0
        sourceColumn += values[3] ?? 0
        segments.push({ generatedColumn, sourceIndex, sourceLine, sourceColumn })
      }
    }
    lines.push(segments)
  }
  return lines
}

const resolveSource = (source: string, moduleUrl: string): string => {
  if (source.startsWith("/") || /^[A-Za-z]:[\\/]/.test(source)) return source
  try {
    return decodeURIComponent(new URL(source, moduleUrl).pathname)
  } catch {
    return source
  }
}

const MAP_URL_PATTERN = /\/\/[#@] sourceMappingURL=(\S+)/g

const decodeDataUri = (uri: string): unknown => {
  const marker = "base64,"
  const start = uri.indexOf(marker)
  if (start === -1) return undefined
  const bytes = Uint8Array.from(atob(uri.slice(start + marker.length)), (char) =>
    char.charCodeAt(0),
  )
  return JSON.parse(new TextDecoder().decode(bytes))
}

const loadMap = async (moduleUrl: string): Promise<DecodedMap | undefined> => {
  const response = await fetch(moduleUrl)
  if (!response.ok) return undefined
  const code = await response.text()
  let mapUrl: string | undefined
  for (const match of code.matchAll(MAP_URL_PATTERN)) mapUrl = match[1]
  if (mapUrl === undefined) return undefined
  let raw: unknown
  if (mapUrl.startsWith("data:")) {
    raw = decodeDataUri(mapUrl)
  } else {
    const mapResponse = await fetch(new URL(mapUrl, moduleUrl))
    if (!mapResponse.ok) return undefined
    raw = await mapResponse.json()
  }
  if (typeof raw !== "object" || raw === null) return undefined
  const map = raw as { sources?: unknown; mappings?: unknown; sourceRoot?: unknown }
  if (!Array.isArray(map.sources) || typeof map.mappings !== "string") return undefined
  const lines = decodeMappings(map.mappings)
  if (lines === undefined) return undefined
  const sourceRoot =
    typeof map.sourceRoot === "string" && map.sourceRoot.length > 0
      ? map.sourceRoot.replace(/\/?$/, "/")
      : ""
  const sources = map.sources.map((source) =>
    typeof source === "string" ? resolveSource(sourceRoot + source, moduleUrl) : "",
  )
  return { sources, lines }
}

/**
 * Builds a synchronous source-location mapper backed by pre-fetched dev-server source maps.
 *
 * **Details**
 *
 * Each distinct `http(s)` module is fetched once and its (usually inline) source map decoded.
 * Positions in modules without a usable map pass through unchanged; positions inside a mapped
 * module that cannot be mapped are dropped so frame resolution can fall back to a caller frame.
 * All failures are swallowed — the returned promise never rejects.
 *
 * @category constructors
 * @since 0.1.0
 */
export const mapper = async (
  files: Iterable<string>,
): Promise<SourceLocation.Mapper | undefined> => {
  const maps = new Map<string, DecodedMap>()
  await Promise.all(
    [...new Set(files)].map(async (file) => {
      if (!/^https?:/.test(file)) return
      try {
        const decoded = await loadMap(file)
        if (decoded !== undefined) maps.set(file, decoded)
      } catch {
        // Best effort: an unreachable module or malformed map leaves the raw frame in place.
      }
    }),
  )
  if (maps.size === 0) return undefined
  return (generated) => {
    const decoded = maps.get(generated.file)
    if (decoded === undefined) return generated
    const segments = decoded.lines[generated.line - 1] ?? []
    let candidate: Segment | undefined
    for (const segment of segments) {
      if (segment.generatedColumn > generated.column - 1) break
      candidate = segment
    }
    candidate ??= segments[0]
    if (candidate === undefined) return undefined
    const source = decoded.sources[candidate.sourceIndex]
    if (source === undefined || source.length === 0) return undefined
    return {
      file: source,
      line: candidate.sourceLine + 1,
      column: candidate.sourceColumn + 1,
      ...(generated.functionName === undefined ? {} : { functionName: generated.functionName }),
    }
  }
}
