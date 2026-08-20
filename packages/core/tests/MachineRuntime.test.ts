import { assert, describe, it } from "@effect/vitest"
import * as Runtime from "./MachineRuntimeTestKit.js"

describe("Runtime", () => {
  it("derives stable total identities for well-formed and malformed strings", () => {
    const instance = Runtime.instanceId("acme:1")
    const entry = Runtime.deriveEntryId(instance, Runtime.revision(2), "Active/slot")
    assert.strictEqual(entry, "acme%3A1:2:Active%2Fslot")
    assert.strictEqual(
      Runtime.deriveMessageId(instance, Runtime.revision(2), "Active/slot", "timer one"),
      "acme%3A1:2:Active%2Fslot:timer%20one",
    )
    assert.strictEqual(
      Runtime.deriveRuntimeExecutionId(instance, entry, "Active/slot", "work", "lane"),
      "acme%3A1:acme%253A1%3A2%3AActive%252Fslot:Active%2Fslot:work:lane",
    )

    const malformed = Runtime.instanceId("instance\ud800")
    assert.strictEqual(
      Runtime.deriveEntryId(malformed, Runtime.revision(0), "state\udc00"),
      "instance%EF%BF%BD:0:state%EF%BF%BD",
    )
    assert.strictEqual(
      Runtime.deriveMessageId(malformed, Runtime.revision(0), "state\udc00", "timer\ud800"),
      "instance%EF%BF%BD:0:state%EF%BF%BD:timer%EF%BF%BD",
    )
  })
})
