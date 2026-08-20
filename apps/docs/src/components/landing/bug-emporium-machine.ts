import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Machine from "effect-state-machine/Machine"
import * as MachineEngine from "effect-state-machine/MachineEngine"

class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()("PaymentDeclined", {
  message: Schema.String,
}) {}

class Orders extends Context.Service<
  Orders,
  Readonly<{ place: (total: number) => Effect.Effect<string, PaymentDeclined> }>
>()("landing/Orders") {}

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
  AddItem: {
    fields: { sku: Schema.String, amount: Schema.Number },
    description: "Add bugs to the jar.",
  },
  RemoveItem: {
    fields: { sku: Schema.String, amount: Schema.Number },
    description: "Remove bugs from the jar.",
  },
  BeginCheckout: { fields: {}, description: "Review the jar." },
  SubmitOrder: { fields: {}, description: "Place the reviewed order." },
  RetryPayment: { fields: {}, description: "Retry a declined payment." },
  BackToShop: { fields: {}, description: "Return to browsing." },
})
const checkout = Machine.builder({ input: Input, state: State, event: Event })

export type EmporiumState = typeof State.Type
export type EmporiumEvent = typeof Event.Type

export const emporiumDefinition = checkout.define(
  {
    id: "checkout",
    idempotencyKey: () => "checkout",
    description: "A checkout flow with expected payment failure and retry.",
    initial: () => ({ _tag: "Browsing", items: 0 }),
  },
  {
    Browsing: checkout.state({
      AddItem: {
        target: "Browsing",
        reduce: ({ state, event }) => ({ ...state, items: state.items + event.amount }),
      },
      RemoveItem: {
        target: "Browsing",
        reduce: ({ state, event }) => ({
          ...state,
          items: Math.max(0, state.items - event.amount),
        }),
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

// Odd attempts are declined so the retry path is always explorable.
const OrdersLive = Layer.effect(
  Orders,
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0)
    return Orders.of({
      place: (items) =>
        Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
          Effect.delay("900 millis"),
          Effect.flatMap((attempt) =>
            attempt % 2 === 1
              ? Effect.fail(new PaymentDeclined({ message: "card declined" }))
              : Effect.succeed(`order-${items}-${attempt}`),
          ),
        ),
    })
  }),
)

export const emporiumStart = emporiumDefinition
  .run({})
  .pipe(Effect.provide(OrdersLive), Effect.provide(MachineEngine.layerMemory()))

export interface Product {
  readonly sku: string
  readonly name: string
  readonly price: number
  readonly origin: string
  readonly note: string
  readonly sticker: string
  readonly stickerTone: "pear" | "cyan"
}

export const products: ReadonlyArray<Product> = [
  {
    sku: "heisenbug",
    name: "Heisenbug",
    price: 404,
    origin: "wild-caught",
    note: "disappears when observed",
    sticker: "shy",
    stickerTone: "pear",
  },
  {
    sku: "race-condition",
    name: "Race Condition",
    price: 21,
    origin: "free-range",
    note: "first come, first served. twice.",
    sticker: "2 for 1",
    stickerTone: "cyan",
  },
  {
    sku: "off-by-one",
    name: "Off-by-One",
    price: 99,
    origin: "farm-raised",
    note: "you get n−1, pay for n",
    sticker: "bestseller",
    stickerTone: "pear",
  },
]

const randomSku = () => {
  const product = products[Math.floor(Math.random() * products.length)] ?? products[0]
  return product.sku
}

export const emporiumQuickEvents = [
  {
    id: "add-random",
    label: "Add random",
    group: "cart",
    make: () => ({ _tag: "AddItem" as const, sku: randomSku(), amount: 1 }),
  },
  {
    id: "remove-random",
    label: "Remove random",
    group: "cart",
    make: () => ({ _tag: "RemoveItem" as const, sku: randomSku(), amount: 1 }),
  },
  { id: "begin", label: "Checkout", group: "cart", event: { _tag: "BeginCheckout" } },
  { id: "back", label: "Back to shop", group: "cart", event: { _tag: "BackToShop" } },
  { id: "submit", label: "Submit", group: "payment", event: { _tag: "SubmitOrder" } },
  { id: "retry", label: "Retry", group: "payment", event: { _tag: "RetryPayment" } },
] as const
