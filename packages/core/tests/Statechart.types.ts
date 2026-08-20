/** Permanent compile-time contract for the shallow statechart authoring API. */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fn from "effect/Function"
import * as Schema from "effect/Schema"
import * as Machine from "../src/Machine.js"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition

const Mode = Schema.TaggedUnion({
  On: {},
  Off: { since: Schema.Number },
})

const State = Schema.TaggedUnion({
  A: { value: Schema.String },
  B: { value: Schema.String, mode: Mode },
  C: { value: Schema.String },
})

const Event = Schema.TaggedUnion({
  Go: {},
  Toggle: { at: Schema.Number },
})

const machine = Machine.builder({
  input: Schema.Struct({ seed: Schema.String }),
  state: State,
  event: Event,
})

class WorkFailure extends Schema.TaggedError<WorkFailure>()("WorkFailure", {
  code: Schema.Literal("failed"),
}) {}

class WorkService extends Context.Service<
  WorkService,
  Readonly<{ run: Effect.Effect<number, WorkFailure> }>
>()("Statechart.types/WorkService") {}

machine.define(
  { id: "missing-state", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  // @ts-expect-error The keyed state record is exhaustive.
  {
    A: machine.state({}),
    B: machine.final(),
  },
)

machine.define(
  { id: "target-fields", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  {
    A: machine.state({
      // @ts-expect-error A transition must supply every field owned by B.
      Go: { target: "B", reduce: ({ state }) => ({ value: state.value }) },
    }),
    B: machine.final(),
    C: machine.final(),
  },
)

const inferred = machine.define(
  { id: "inferred", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  {
    A: machine.invoke({
      name: "typed-work",
      success: Schema.Number,
      error: WorkFailure,
      effect: (state) => {
        const current: "A" = state._tag
        void current
        return Effect.flatMap(WorkService, ({ run }) => run)
      },
      onSuccess: {
        target: "C",
        reduce: ({ value }) => {
          value.toFixed()
          // @ts-expect-error The Effect success channel is number.
          value.toUpperCase()
          return { value: String(value) }
        },
      },
      onFailure: {
        target: "C",
        reduce: ({ error }) => {
          const code: "failed" = error.code
          // @ts-expect-error The typed failure has no arbitrary payload field.
          error.payload
          return { value: code }
        },
      },
    }),
    B: machine.regions({
      mode: {
        On: {
          Toggle: {
            target: "Off",
            reduce: ({ state, event, parent }) => {
              const region: "On" = state._tag
              const accepted: "Toggle" = event._tag
              const owner: "B" = parent._tag
              return {
                since:
                  event.at + parent.value.length + region.length + accepted.length + owner.length,
              }
            },
          },
        },
        Off: { Toggle: { target: "On", reduce: () => ({}) } },
      },
    }),
    C: machine.final(),
  },
)

const dataFirstRun = Machine.run(inferred, { seed: "first" })
const dataLastRun = Fn.pipe(inferred, Machine.run({ seed: "last" }))

// @ts-expect-error The data-last input must match the definition's input Schema.
Fn.pipe(inferred, Machine.run({ seed: 1 }))

machine.define(
  { id: "missing-region", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  {
    A: machine.state({}),
    B: machine.regions({
      // @ts-expect-error Region trees are exhaustive over the selected slot union.
      mode: { On: {} },
    }),
    C: machine.final(),
  },
)

machine.define(
  { id: "local-region-target", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  {
    A: machine.state({}),
    B: machine.regions({
      mode: {
        On: {
          // @ts-expect-error Region transitions cannot target a top-level state.
          Toggle: { target: "C", reduce: () => ({ since: 0 }) },
        },
        Off: {},
      },
    }),
    C: machine.final(),
  },
)

machine.define(
  { id: "all-product", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  {
    A: machine.invoke.all({
      name: "join",
      tasks: {
        text: {
          success: Schema.String,
          error: Schema.Never,
          effect: () => Effect.succeed("ok"),
        },
        count: {
          success: Schema.Number,
          error: Schema.Never,
          effect: () => Effect.succeed(1),
        },
      },
      onSuccess: {
        target: "C",
        reduce: ({ value }) => {
          value.text.toUpperCase()
          value.count.toFixed()
          // @ts-expect-error Joined values are keyed by the declared lane names.
          value.missing
          return { value: value.text }
        },
      },
      onFailure: { target: "C", reduce: () => ({ value: "failed" }) },
    }),
    B: machine.final(),
    C: machine.final(),
  },
)

machine.define(
  { id: "race-correlation", initial: ({ seed }) => ({ _tag: "A", value: seed }) },
  {
    A: machine.invoke.race({
      name: "race",
      tasks: {
        text: {
          success: Schema.String,
          error: Schema.Never,
          effect: () => Effect.succeed("ok"),
        },
        count: {
          success: Schema.Struct({ count: Schema.Number }),
          error: Schema.Never,
          effect: () => Effect.succeed({ count: 1 }),
        },
      },
      onSuccess: {
        target: "C",
        reduce: ({ winner, value }) => {
          if (winner === "text") {
            value.toUpperCase()
            // @ts-expect-error The text lane does not return the count object.
            value.count
          } else {
            value.count.toFixed()
            // @ts-expect-error The count lane does not return a string.
            value.toUpperCase()
          }
          return { value: winner }
        },
      },
      onFailure: { target: "C", reduce: () => ({ value: "failed" }) },
    }),
    B: machine.final(),
    C: machine.final(),
  },
)

type InferenceChecks = [
  Assert<Equal<Machine.MachineInput<typeof inferred>, { readonly seed: string }>>,
  Assert<Equal<Machine.MachineState<typeof inferred>, Schema.Schema.Type<typeof State>>>,
  Assert<Equal<Machine.MachineEvent<typeof inferred>, Schema.Schema.Type<typeof Event>>>,
  Assert<
    Equal<
      Machine.MachineCompletion<typeof inferred>,
      { readonly _tag: "C"; readonly value: string }
    >
  >,
  Assert<Equal<Machine.MachineRequirements<typeof inferred>, WorkService>>,
  Assert<Equal<typeof dataLastRun, typeof dataFirstRun>>,
]

export type StatechartInferenceContract = InferenceChecks
