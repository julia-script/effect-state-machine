import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export class RandomUnavailable extends Schema.TaggedError<RandomUnavailable>()(
  "RandomUnavailable",
  { message: Schema.String },
) {}

export interface Generator {
  readonly state: number
}

export const seeded = (seed: number): Generator => ({ state: seed >>> 0 || 0x6d2b79f5 })

export const next = (self: Generator): readonly [value: number, next: Generator] => {
  let state = self.state
  state ^= state << 13
  state ^= state >>> 17
  state ^= state << 5
  const normalized = (state >>> 0) / 4_294_967_296
  return [normalized, { state: state >>> 0 }]
}

export const integer = (
  self: Generator,
  upperExclusive: number,
): readonly [value: number, next: Generator] => {
  if (upperExclusive <= 0) return [0, self]
  const [value, generator] = next(self)
  return [Math.floor(value * upperExclusive), generator]
}

export const shuffle = <A>(
  self: Generator,
  values: ReadonlyArray<A>,
): readonly [values: ReadonlyArray<A>, next: Generator] => {
  const shuffled = [...values]
  let generator = self
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const [other, nextGenerator] = integer(generator, index + 1)
    generator = nextGenerator
    const current = shuffled[index]
    const replacement = shuffled[other]
    if (current === undefined || replacement === undefined) continue
    shuffled[index] = replacement
    shuffled[other] = current
  }
  return [shuffled, generator]
}

export const liveSeed = Effect.fn("Random.liveSeed")(function* () {
  const bytes = new Uint32Array(1)
  return yield* Effect.try({
    try: () => {
      globalThis.crypto.getRandomValues(bytes)
      return bytes[0] ?? 0x6d2b79f5
    },
    catch: (cause) => new RandomUnavailable({ message: String(cause) }),
  })
})
