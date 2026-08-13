import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Machine from "../src/Machine.js"

export class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()("PaymentDeclined", {
  message: Schema.String,
}) {}

export class Orders extends Context.Service<
  Orders,
  Readonly<{ place: (total: number) => Effect.Effect<string, PaymentDeclined> }>
>()("examples/Orders") {}

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

export const definition = checkout.define(
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
        target: "Checkout",
        reduce: ({ state }) => ({ _tag: "Checkout", items: state.items }),
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

export const Checkout = { Input, State, Event, definition } as const
