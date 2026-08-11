/** Minimal line diff (LCS) for the state panel's before/after view. */

export interface DiffLine {
  readonly kind: "same" | "added" | "removed"
  readonly text: string
}

export const diffLines = (before: string, after: string): ReadonlyArray<DiffLine> => {
  const a = before.split("\n")
  const b = after.split("\n")
  const lengths: Array<Array<number>> = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const lines: Array<DiffLine> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i] })
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      lines.push({ kind: "removed", text: a[i] })
      i += 1
    } else {
      lines.push({ kind: "added", text: b[j] })
      j += 1
    }
  }
  while (i < a.length) {
    lines.push({ kind: "removed", text: a[i] })
    i += 1
  }
  while (j < b.length) {
    lines.push({ kind: "added", text: b[j] })
    j += 1
  }
  return lines
}
