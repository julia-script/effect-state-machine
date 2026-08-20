import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow"
import * as Machine from "effect-state-machine/Machine"
import * as MachineEngine from "effect-state-machine/MachineEngine"
import * as MachineWorkflow from "effect-state-machine/MachineWorkflow"

class ChargeFailed extends Schema.TaggedError<ChargeFailed>()("ChargeFailed", {
  message: Schema.String,
}) {}

class Payments extends Context.Service<
  Payments,
  Readonly<{
    charge: (orderId: string) => Effect.Effect<string, ChargeFailed>
  }>
>()("examples/Payments") {}

const ChargeOrder = Workflow.make("ChargeOrder", {
  payload: {
    orderId: Schema.String,
  },
  success: Schema.String,
  error: ChargeFailed,
  idempotencyKey: ({ orderId }) => orderId,
})

const ChargeOrderLive = ChargeOrder.toLayer(
  Effect.fnUntraced(function* ({ orderId }) {
    const payments = yield* Payments
    return yield* Activity.make({
      name: "Payments.charge",
      success: Schema.String,
      error: ChargeFailed,
      execute: payments.charge(orderId),
    })
  }),
)

const Input = Schema.Struct({ orderId: Schema.String })
const Waiting = Schema.TaggedStruct("Waiting", { orderId: Schema.String })
const Charging = Schema.TaggedStruct("Charging", { orderId: Schema.String })
const Charged = Schema.TaggedStruct("Charged", { receiptId: Schema.String })
const Expired = Schema.TaggedStruct("Expired", { orderId: Schema.String })
const Failed = Schema.TaggedStruct("Failed", { message: Schema.String })
const State = Schema.Union([Waiting, Charging, Charged, Expired, Failed]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Start = Schema.TaggedStruct("Start", {})
const Event = Schema.Union([Start]).pipe(Schema.toTaggedUnion("_tag"))
const order = Machine.builder({ input: Input, state: State, event: Event })

export const definition = order.define(
  {
    id: "workflow-order",
    idempotencyKey: ({ orderId }) => orderId,
    initial: ({ orderId }) => ({ _tag: "Waiting", orderId }),
  },
  {
    Waiting: order.state(
      {
        Start: {
          target: "Charging",
          reduce: ({ state }) => ({ orderId: state.orderId }),
        },
      },
      {
        after: {
          duration: "60 seconds",
          target: "Expired",
          reduce: ({ state }) => ({ orderId: state.orderId }),
        },
      },
    ),
    Charging: MachineWorkflow.invoke(order, {
      workflow: ChargeOrder,
      payload: ({ state }) => ({ orderId: state.orderId }),
      onSuccess: {
        target: "Charged",
        reduce: ({ value }) => ({ receiptId: value }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ message: error.message }),
      },
    }),
    Charged: order.final(),
    Expired: order.final(),
    Failed: order.final(),
  },
)

const PaymentsTest = Layer.succeed(Payments, {
  charge: (orderId) => Effect.succeed(`receipt:${orderId}`),
})

const WorkflowTest = ChargeOrderLive.pipe(
  Layer.provideMerge(Layer.merge(WorkflowEngine.layerMemory, PaymentsTest)),
)

export const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* definition.run({ orderId: "42" })

    yield* handle.send({ _tag: "Start" }, { idempotencyKey: "start:order:42" })
    return yield* handle.completion
  }),
).pipe(Effect.provide(MachineEngine.layerMemory()), Effect.provide(WorkflowTest))
