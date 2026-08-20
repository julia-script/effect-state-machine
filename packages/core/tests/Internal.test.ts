import { assert, describe, it } from "@effect/vitest"
import {
  encodeComponent,
  encodeWellFormedUri,
  recordFromEntries,
  toWellFormed,
} from "../src/Internal.js"

describe("runtime key primitives", () => {
  it("preserves prototype-overlapping keys as ordinary own data properties", () => {
    const record = recordFromEntries([
      ["__proto__", 1] as const,
      ["constructor", 2] as const,
      ["prototype", 3] as const,
    ])

    assert.strictEqual(Object.getPrototypeOf(record), Object.prototype)
    assert.deepStrictEqual(Object.keys(record), ["__proto__", "constructor", "prototype"])
    assert.strictEqual(Reflect.get(record, "__proto__"), 1)
    assert.strictEqual(Reflect.get(record, "constructor"), 2)
    assert.strictEqual(Reflect.get(record, "prototype"), 3)
    for (const key of Object.keys(record)) {
      assert.deepStrictEqual(Object.getOwnPropertyDescriptor(record, key), {
        value: record[key],
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
  })

  it("keeps well-formed encodings stable and normalizes unpaired surrogates", () => {
    assert.strictEqual(encodeComponent("state/name: one"), "state%2Fname%3A%20one")
    assert.strictEqual(encodeWellFormedUri("/state/name: one"), "/state/name:%20one")
    assert.strictEqual(toWellFormed("paired:\ud83d\ude80"), "paired:\ud83d\ude80")
    assert.strictEqual(toWellFormed("left:\ud800:right:\udc00"), "left:\ufffd:right:\ufffd")
    assert.strictEqual(encodeComponent("left:\ud800"), "left%3A%EF%BF%BD")
  })
})
