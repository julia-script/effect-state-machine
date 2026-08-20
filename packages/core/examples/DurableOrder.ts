import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Durable from "../src/Durable.js"
import * as Machine from "../src/Machine.js"

class SubmitFailed extends Schema.TaggedError<SubmitFailed>()("SubmitFailed", {
  message: Schema.String,
}) {}

class TaskQueue extends Context.Service<
  TaskQueue,
  Readonly<{
    submit: (
      request: Readonly<{ key: string; orderId: string }>,
    ) => Effect.Effect<string, SubmitFailed>
  }>
>()("examples/TaskQueue") {}

const Input = Schema.Struct({ orderId: Schema.String })
const Waiting = Schema.TaggedStruct("Waiting", { orderId: Schema.String })
const Submitting = Schema.TaggedStruct("Submitting", { orderId: Schema.String })
const Submitted = Schema.TaggedStruct("Submitted", { jobId: Schema.String })
const Expired = Schema.TaggedStruct("Expired", { orderId: Schema.String })
const Failed = Schema.TaggedStruct("Failed", { message: Schema.String })
const State = Schema.Union([Waiting, Submitting, Submitted, Expired, Failed]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Submit = Schema.TaggedStruct("Submit", {})
const Event = Schema.Union([Submit]).pipe(Schema.toTaggedUnion("_tag"))
const order = Machine.builder({ input: Input, state: State, event: Event })

export const definition = order.define(
  { id: "durable-order", initial: (input) => ({ _tag: "Waiting", orderId: input.orderId }) },
  {
    Waiting: order.state(
      {
        Submit: {
          target: "Submitting",
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
    Submitting: order.invoke({
      name: "TaskQueue.submit",
      success: Schema.String,
      error: SubmitFailed,
      effect: (state, metadata) =>
        Effect.flatMap(TaskQueue, ({ submit }) =>
          submit({
            key: metadata?.executionKey ?? "missing-execution-key",
            orderId: state.orderId,
          }),
        ),
      onSuccess: { target: "Submitted", reduce: ({ value }) => ({ jobId: value }) },
      onFailure: { target: "Failed", reduce: ({ error }) => ({ message: error.message }) },
    }),
    Submitted: order.final(),
    Expired: order.final(),
    Failed: order.final(),
  },
)

export const startThenResume = Effect.gen(function* () {
  const store = yield* Durable.makeMemoryStore()
  const options: Durable.RunOptions = {
    instanceId: Durable.instanceId("order:42"),
    persistenceVersion: Durable.persistenceVersion("1"),
  }

  // Closing this Scope represents the first process stopping. The timer remains in the store.
  yield* Effect.scoped(
    Durable.run(definition, { orderId: "42" }, options).pipe(
      Effect.provideService(Durable.Store, store),
    ),
  )

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const resumed = yield* Durable.run(
        definition,
        { orderId: "ignored-on-resume" },
        options,
      ).pipe(Effect.provideService(Durable.Store, store))
      yield* resumed.send({ _tag: "Submit" }, { idempotencyKey: "submit-order-42" })
      return yield* resumed.completion
    }),
  )
})
