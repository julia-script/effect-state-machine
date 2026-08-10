export interface Reference {
  readonly stack: () => string | undefined
}

/** Captures an Error callsite now while deferring stack materialization to development tooling. */
export const capture = (): Reference => {
  const error = new Error()
  return { stack: () => error.stack }
}
