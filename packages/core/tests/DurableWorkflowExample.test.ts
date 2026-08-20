import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { program } from "../examples/DurableWorkflow.js"

describe("DurableWorkflow example", () => {
  it.effect("runs a durable machine activity through Effect Workflow", () =>
    Effect.gen(function* () {
      const result = yield* program
      assert.deepStrictEqual(result, { _tag: "Charged", receiptId: "receipt:42" })
    }),
  )
})
