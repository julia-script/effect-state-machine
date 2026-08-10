/**
 * Lazily materialized JavaScript stack captured at an authored declaration site.
 *
 * @category references
 * @since 0.1.0
 */
export interface Reference {
  readonly stack: () => string | undefined
}

/**
 * Captures an Error callsite while deferring stack materialization to development tooling.
 *
 * @category constructors
 * @since 0.1.0
 */
export const capture = (): Reference => {
  const error = new Error()
  return { stack: () => error.stack }
}
