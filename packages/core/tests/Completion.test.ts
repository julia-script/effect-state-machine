import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Stream from "effect/Stream"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import { runMachine } from "./runMachine.js"

const Input = Schema.Struct({ value: Schema.Number })
const Running = Schema.TaggedStruct("Running", { value: Schema.Number })
const Done = Schema.TaggedStruct("Done", { value: Schema.Number }).annotate({
  description: "The workflow completed successfully.",
})
const State = Schema.Union([Running, Done]).pipe(Schema.toTaggedUnion("_tag"))
const Finish = Schema.TaggedStruct("Finish", {})
const Event = Schema.Union([Finish]).pipe(Schema.toTaggedUnion("_tag"))

const workflow = Machine.builder({ input: Input, state: State, event: Event })
const definition = workflow.define(
  {
    id: "completing-workflow",
    initial: (input) => ({ _tag: "Running", value: input.value }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Running: workflow.state({
      Finish: {
        target: "Done",
        reduce: ({ state }) => ({ _tag: "Done", value: state.value }),
      },
    }),
    Done: workflow.final(),
  },
)

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
type CompletionIsFinalState = Assert<
  Equal<
    Machine.MachineCompletion<typeof definition>,
    { readonly _tag: "Done"; readonly value: number }
  >
>

describe("machine completion", () => {
  it.effect("commits a final snapshot, completes, and ends changes atomically", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(definition, { value: 42 })
      const changesFiber = yield* Effect.forkChild(Stream.runCollect(handle.changes))
      yield* Effect.yieldNow

      yield* handle.send({ _tag: "Finish" })

      assert.deepStrictEqual(yield* handle.completion, { _tag: "Done", value: 42 })
      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Done", value: 42 })
      assert.deepStrictEqual(yield* Fiber.join(changesFiber), [
        { _tag: "Running", value: 42 },
        { _tag: "Done", value: 42 },
      ])

      const postCompletion = yield* Effect.flip(handle.send({ _tag: "Finish" }))
      assert.strictEqual(postCompletion._tag, "CompletedInstance")
      if (postCompletion._tag !== "CompletedInstance") return
      assert.strictEqual(String(postCompletion.instanceId), String(handle.instanceId))
    }),
  )

  it("marks final nodes in the renderer-independent graph", () => {
    assert.deepStrictEqual(
      Graph.fromDefinition(definition).nodes.map(({ location: _, ...node }) => node),
      [
        { id: "Running", title: "Running", kind: "state" },
        {
          id: "Done",
          title: "Done",
          description: "The workflow completed successfully.",
          kind: "final",
        },
      ],
    )
  })
})

class CodecOffset extends Context.Service<CodecOffset, { readonly value: number }>()(
  "tests/CodecOffset",
) {}

const OffsetNumber = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transformOrFail({
      decode: (encoded) => Effect.map(CodecOffset, ({ value }) => Number(encoded) + value),
      encode: (decoded) => Effect.map(CodecOffset, ({ value }) => String(decoded - value)),
    }),
  ),
)

const CodecInput = Schema.Struct({ value: OffsetNumber })
const CodecState = Schema.Union([Schema.TaggedStruct("Ready", { value: Schema.Number })]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const CodecEvent = Schema.Union([Schema.TaggedStruct("Set", { value: Schema.Number })]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const codecMachine = Machine.builder({
  input: CodecInput,
  state: CodecState,
  event: CodecEvent,
})
const codecDefinition = codecMachine.define(
  {
    id: "codec-boundaries",
    initial: (input) => ({ _tag: "Ready", value: input.value }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Ready: codecMachine.state({
      Set: {
        target: "Ready",
        reduce: ({ event }) => ({ _tag: "Ready", value: event.value }),
      },
    }),
  },
)
type NonTerminatingCompletionIsNever = Assert<
  Equal<Machine.MachineCompletion<typeof codecDefinition>, never>
>
const completionTypeChecks: readonly [CompletionIsFinalState, NonTerminatingCompletionIsNever] = [
  true,
  true,
]
void completionTypeChecks

describe("machine Schema codecs", () => {
  it.effect("keeps encoding and decoding explicit without adding codec services to run", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(codecDefinition, { value: 42 })
      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Ready", value: 42 })

      const offset = CodecOffset.of({ value: 2 })
      assert.deepStrictEqual(
        yield* Machine.decodeInput(codecDefinition, { value: "40" }).pipe(
          Effect.provideService(CodecOffset, offset),
        ),
        { value: 42 },
      )
      assert.deepStrictEqual(
        yield* Machine.encodeInput(codecDefinition, { value: 42 }).pipe(
          Effect.provideService(CodecOffset, offset),
        ),
        { value: "40" },
      )
      assert.deepStrictEqual(
        yield* Machine.decodeState(codecDefinition, { _tag: "Ready", value: 42 }),
        { _tag: "Ready", value: 42 },
      )
      assert.deepStrictEqual(
        yield* Machine.encodeState(codecDefinition, { _tag: "Ready", value: 42 }),
        { _tag: "Ready", value: 42 },
      )
      assert.deepStrictEqual(
        yield* Machine.decodeEvent(codecDefinition, { _tag: "Set", value: 7 }),
        { _tag: "Set", value: 7 },
      )
      assert.deepStrictEqual(
        yield* Machine.encodeEvent(codecDefinition, { _tag: "Set", value: 7 }),
        { _tag: "Set", value: 7 },
      )
    }),
  )
})
