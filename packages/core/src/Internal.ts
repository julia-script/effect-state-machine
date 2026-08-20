/** Materializes open runtime keys as ordinary own data properties. */
export const recordFromEntries = <Value>(
  entries: Iterable<readonly [string, Value]>,
): Record<string, Value> => {
  const record: Record<string, Value> = {}
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return record
}

const fallbackToWellFormed = (value: string): string => {
  let normalized = ""
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value[index] ?? ""
        normalized += value[index + 1] ?? ""
        index += 1
      } else {
        normalized += "\ufffd"
      }
      continue
    }
    normalized += code >= 0xdc00 && code <= 0xdfff ? "\ufffd" : (value[index] ?? "")
  }
  return normalized
}

/** Normalizes unpaired UTF-16 surrogates without changing well-formed strings. */
export const toWellFormed = (value: string): string => {
  // The cast probes a newer standard method while retaining compatibility with older TS libs.
  const native = (String.prototype as { toWellFormed?: (this: string) => string }).toWellFormed
  return native === undefined ? fallbackToWellFormed(value) : native.call(value)
}

/**
 * Encodes one identity/path component after deterministic UTF-16 normalization.
 * Unpaired surrogates normalize to U+FFFD, so malformed spellings may converge on one result.
 */
export const encodeComponent = (value: string): string => encodeURIComponent(toWellFormed(value))

/** Encodes a URI after the same deterministic malformed-UTF-16 normalization. */
export const encodeWellFormedUri = (value: string): string => encodeURI(toWellFormed(value))
