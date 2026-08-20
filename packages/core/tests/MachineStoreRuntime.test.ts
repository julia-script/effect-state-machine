import { describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { TestClock } from "effect/testing"
import { storeConformance } from "../src/MachineRuntimeConformance.js"
import * as MachineStore from "../src/MachineStore.js"
import { makeMachineRuntimeStore } from "../src/MachineStoreRuntime.js"

describe("MachineStore durable protocol adapter", () => {
  for (const conformance of storeConformance(
    () => Effect.flatMap(MachineStore.makeMemory(), makeMachineRuntimeStore),
    (millis) => TestClock.adjust(`${millis} millis`),
  )) {
    // The temporary protocol adapter is exercised by the same semantic corpus as the old store.
    it.effect(conformance.name, () => conformance.run)
  }
})
