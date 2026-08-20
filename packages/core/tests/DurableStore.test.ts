import { it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as Durable from "../src/Durable.js"
import { storeConformance } from "./DurableStoreConformance.js"

storeConformance("in-memory", Durable.makeMemoryStore)

for (const testCase of Durable.storeConformance(Durable.makeMemoryStore, TestClock.adjust)) {
  it.effect(`published conformance: ${testCase.name}`, () => testCase.run)
}
