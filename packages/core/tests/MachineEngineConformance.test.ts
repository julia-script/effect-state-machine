import { describe, it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as MachineEngine from "../src/MachineEngine.js"
import * as MachineEngineConformance from "../src/MachineEngineConformance.js"

describe("MachineEngine memory semantic conformance", () => {
  for (const conformance of MachineEngineConformance.make(MachineEngine.layerMemory(), (millis) =>
    TestClock.adjust(`${millis} millis`),
  )) {
    it.effect(conformance.name, () => conformance.run)
  }
})
