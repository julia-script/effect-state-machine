import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Durable from "../src/Durable.js"
import type * as Machine from "../src/Machine.js"

const State = Schema.Union([
  Schema.TaggedStruct("Active", {}),
  Schema.TaggedStruct("Done", {}),
]).pipe(Schema.toTaggedUnion("_tag"))
const Event = Schema.Union([Schema.TaggedStruct("Finish", {})]).pipe(Schema.toTaggedUnion("_tag"))

const definition = (states: Readonly<Record<string, unknown>>): Machine.DefinitionMetadata => ({
  id: "validation",
  schemas: { state: State, event: Event },
  states,
})

describe("Durable", () => {
  it("derives stable total identities for well-formed and malformed strings", () => {
    const instance = Durable.instanceId("acme:1")
    const entry = Durable.deriveEntryId(instance, Durable.revision(2), "Active/slot")
    assert.strictEqual(entry, "acme%3A1:2:Active%2Fslot")
    assert.strictEqual(
      Durable.deriveMessageId(instance, Durable.revision(2), "Active/slot", "timer one"),
      "acme%3A1:2:Active%2Fslot:timer%20one",
    )
    assert.strictEqual(
      Durable.deriveExecutionKey(instance, entry, "Active/slot", "work", "lane"),
      "acme%3A1:acme%253A1%3A2%3AActive%252Fslot:Active%2Fslot:work:lane",
    )

    const malformed = Durable.instanceId("instance\ud800")
    assert.strictEqual(
      Durable.deriveEntryId(malformed, Durable.revision(0), "state\udc00"),
      "instance%EF%BF%BD:0:state%EF%BF%BD",
    )
    assert.strictEqual(
      Durable.deriveMessageId(malformed, Durable.revision(0), "state\udc00", "timer\ud800"),
      "instance%EF%BF%BD:0:state%EF%BF%BD:timer%EF%BF%BD",
    )
  })

  it.effect("accepts state, invoke, regions, and final nodes", () =>
    Durable.validateDefinition(
      definition({
        Active: { on: {} },
        Invoking: { invoke: {} },
        Parallel: { regions: {} },
        Done: { final: true },
      }),
    ),
  )

  it.effect("rejects child-machine nodes", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Durable.validateDefinition(
          definition({
            Active: { child: { name: "nested" } },
            Done: { final: true },
          }),
        ),
      )

      assert.strictEqual(error._tag, "UnsupportedDefinition")
      assert.strictEqual(error.definitionId, "validation")
      assert.strictEqual(error.stateTag, "Active")
    }),
  )
})
