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
