import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { Checkout, Orders, PaymentDeclined } from "../examples/Checkout.js"
import * as Machine from "../src/Machine.js"

describe("checkout proof", () => {
  it.effect("drives failure, retry, and terminal success through the handle", () =>
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

        yield* handle.send({ _tag: "AddItem", amount: 2 })
        yield* handle.send({ _tag: "BeginCheckout" })
        yield* handle.send({ _tag: "SubmitOrder" })
        yield* Stream.runHead(
          handle.changes.pipe(Stream.filter((state) => state._tag === "PaymentFailed")),
        )
        assert.isTrue(yield* handle.can({ _tag: "RetryPayment" }))
        yield* handle.send({ _tag: "RetryPayment" })
        assert.deepStrictEqual(yield* handle.completion, { _tag: "Ordered", orderId: "order-2" })
        assert.strictEqual(yield* Ref.get(attempts), 2)
      }),
    ),
  )
})
