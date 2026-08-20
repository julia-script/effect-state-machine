/**
 * Runnable Studio walkthrough:
 *
 * 1. `pnpm --filter @effect-state-machine/studio build`
 * 2. `node packages/studio/bin/studio.mjs`
 * 3. `pnpm --filter @effect-state-machine/studio-client demo`
 * 4. open http://127.0.0.1:4747 and drive the checkout with quick events
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"
import * as Attach from "../src/Attach.js"
import { StudioTransport } from "../src/Transport.js"
import * as WebSocketTransport from "../src/WebSocketTransport.js"

class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()("PaymentDeclined", {
  message: Schema.String,
}) {}

class Orders extends Context.Service<
  Orders,
  Readonly<{ place: (total: number) => Effect.Effect<string, PaymentDeclined> }>
>()("demo/Orders") {}

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Browsing: { fields: { items: Schema.Number }, description: "Build a cart." },
  Checkout: { fields: { items: Schema.Number }, description: "Review the order." },
  PlacingOrder: { fields: { items: Schema.Number }, description: "Place the order." },
  PaymentFailed: {
    fields: { items: Schema.Number, message: Schema.String },
    description: "Let the shopper retry an expected decline.",
  },
  Ordered: { fields: { orderId: Schema.String }, description: "Finish with an order." },
})
const Event = Machine.taggedUnion({
  AddItem: { fields: { amount: Schema.Number }, description: "Add items to the cart." },
  BeginCheckout: { fields: {}, description: "Review the cart." },
  SubmitOrder: { fields: {}, description: "Place the reviewed order." },
  RetryPayment: { fields: {}, description: "Retry a declined payment." },
  BackToShop: { fields: {}, description: "Return to browsing." },
})
const checkout = Machine.builder({ input: Input, state: State, event: Event })

const definition = checkout.define(
  {
    id: "checkout",
    description: "A checkout flow with expected payment failure and retry.",
    initial: () => ({ _tag: "Browsing", items: 0 }),
  },
  {
    Browsing: checkout.state({
      AddItem: {
        target: "Browsing",
        reduce: ({ state, event }) => ({ ...state, items: state.items + event.amount }),
      },
      BeginCheckout: {
        branches: [
          {
            when: Machine.namedGuard({
              name: "Cart has items",
              description: "Checkout requires at least one item.",
              guard: ({ state }) => state.items > 0,
            }),
            target: "Checkout",
            reduce: ({ state }) => ({ _tag: "Checkout", items: state.items }),
          },
        ],
      },
    }),
    Checkout: checkout.state({
      SubmitOrder: {
        target: "PlacingOrder",
        reduce: ({ state }) => ({ _tag: "PlacingOrder", items: state.items }),
      },
      BackToShop: {
        target: "Browsing",
        reduce: ({ state }) => ({ _tag: "Browsing", items: state.items }),
      },
    }),
    PlacingOrder: checkout.invoke({
      name: "Orders.place",
      success: Schema.String,
      error: PaymentDeclined,
      effect: (state) => Effect.flatMap(Orders, ({ place }) => place(state.items)),
      onSuccess: {
        target: "Ordered",
        reduce: ({ value }) => ({ _tag: "Ordered", orderId: value }),
      },
      onFailure: {
        target: "PaymentFailed",
        reduce: ({ state, error }) => ({
          _tag: "PaymentFailed",
          items: state.items,
          message: error.message,
        }),
      },
    }),
    PaymentFailed: checkout.state({
      RetryPayment: {
        target: "PlacingOrder",
        reduce: ({ state }) => ({ _tag: "PlacingOrder", items: state.items }),
      },
      BackToShop: {
        target: "Browsing",
        reduce: ({ state }) => ({ _tag: "Browsing", items: state.items }),
      },
    }),
    Ordered: checkout.final(),
  },
)

// The first payment attempt is declined so the retry path is explorable.
const OrdersLive = Layer.effect(
  Orders,
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0)
    return Orders.of({
      place: (total) =>
        Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
          Effect.delay("900 millis"),
          Effect.flatMap((attempt) =>
            attempt % 2 === 1
              ? Effect.fail(new PaymentDeclined({ message: "card declined" }))
              : Effect.succeed(`order-${total}-${attempt}`),
          ),
        ),
    })
  }),
)

const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* Machine.run(definition, {}).pipe(Effect.provide(OrdersLive))
    yield* Attach.attach({
      definition,
      handle,
      appName: "checkout-demo",
      quickEvents: [
        {
          id: "add-random",
          label: "Add random",
          group: "cart",
          make: () => ({ _tag: "AddItem" as const, amount: 1 + Math.floor(Math.random() * 4) }),
        },
        { id: "begin", label: "Checkout", group: "cart", event: { _tag: "BeginCheckout" } },
        { id: "submit", label: "Submit", group: "payment", event: { _tag: "SubmitOrder" } },
        { id: "retry", label: "Retry", group: "payment", event: { _tag: "RetryPayment" } },
        { id: "back", label: "Back to shop", group: "cart", event: { _tag: "BackToShop" } },
      ],
    })
    yield* Effect.log("checkout-demo attached — drive it from Studio")
    const completion = yield* handle.completion
    yield* Effect.log(`checkout completed: ${completion.orderId}`)
    // Keep the session visible in Studio after completion.
    yield* Effect.sleep("120 seconds")
  }),
)

Effect.runPromise(program.pipe(Effect.provideService(StudioTransport, WebSocketTransport.make())))
