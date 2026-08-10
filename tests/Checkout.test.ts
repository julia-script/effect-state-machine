import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { Checkout, Orders, PaymentDeclined } from "../examples/Checkout.js"
import * as DevToolsSession from "../src/DevToolsSession.js"
import * as Machine from "../src/Machine.js"

describe("checkout devtools proof", () => {
  it.effect("uses the generic session for failure, retry, and terminal success", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0)
        const orders = Layer.succeed(
          Orders,
          Orders.of({
            place: () =>
              Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
                Effect.flatMap((attempt) =>
                  attempt === 1
                    ? Effect.fail(new PaymentDeclined({ message: "card declined" }))
                    : Effect.succeed("order-2"),
                ),
              ),
          }),
        )
        const handle = yield* Machine.run(Checkout.definition, {}).pipe(Effect.provide(orders))
        const session = yield* DevToolsSession.attach({
          definition: Checkout.definition,
          handle,
          quickEvents: [
            {
              id: "add",
              label: "Add random",
              make: () => ({ _tag: "AddItem" as const, amount: 2 }),
            },
            { id: "checkout", label: "Checkout", event: { _tag: "BeginCheckout" } },
            { id: "submit", label: "Submit", event: { _tag: "SubmitOrder" } },
            { id: "retry", label: "Retry", event: { _tag: "RetryPayment" } },
          ],
        })

        yield* session.dispatchQuickEvent("add")
        yield* session.dispatchQuickEvent("checkout")
        yield* session.dispatchQuickEvent("submit")
        yield* Stream.runHead(
          handle.changes.pipe(Stream.filter((state) => state._tag === "PaymentFailed")),
        )
        yield* session.dispatchQuickEvent("retry")
        assert.deepStrictEqual(yield* handle.completion, { _tag: "Ordered", orderId: "order-2" })
        const view = yield* session.changes.pipe(
          Stream.filter((candidate) => candidate.status === "completed"),
          Stream.runHead,
        )
        assert.strictEqual(view._tag, "Some")
        assert.strictEqual(yield* Ref.get(attempts), 2)
      }),
    ),
  )
})
