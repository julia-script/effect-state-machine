import { assert, it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as Runtime from "./MachineRuntimeTestKit.js"

for (const testCase of Runtime.storeConformance(Runtime.makeMemoryStore, TestClock.adjust)) {
  it.effect(`published conformance: ${testCase.name}`, () => testCase.run)
}

it("publishes a case for every Store contract topic", () => {
  const covered = new Set(
    Runtime.storeConformance(Runtime.makeMemoryStore).flatMap((testCase) => testCase.covers),
  )
  assert.deepStrictEqual([...covered].sort(), [...Runtime.storeConformanceTopics].sort())
})
