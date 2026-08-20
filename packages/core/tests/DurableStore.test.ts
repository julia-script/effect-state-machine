import { assert, it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as Durable from "../src/Durable.js"

for (const testCase of Durable.storeConformance(Durable.makeMemoryStore, TestClock.adjust)) {
  it.effect(`published conformance: ${testCase.name}`, () => testCase.run)
}

it("publishes a case for every Store contract topic", () => {
  const covered = new Set(
    Durable.storeConformance(Durable.makeMemoryStore).flatMap((testCase) => testCase.covers),
  )
  assert.deepStrictEqual([...covered].sort(), [...Durable.storeConformanceTopics].sort())
})
