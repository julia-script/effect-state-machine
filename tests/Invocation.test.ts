import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"

class LoadFailed extends Data.TaggedError("LoadFailed")<{
  readonly message: string
}> {}

class NotFound extends Data.TaggedError("NotFound")<{
  readonly message: string
}> {}

class Documents extends Context.Service<
  Documents,
  Readonly<{
    load: (id: string) => Effect.Effect<string, LoadFailed | NotFound>
  }>
>()("tests/Documents") {}

const Input = Schema.Struct({ id: Schema.String })
const Loading = Schema.TaggedStruct("Loading", { id: Schema.String })
const Loaded = Schema.TaggedStruct("Loaded", { text: Schema.String })
const Failed = Schema.TaggedStruct("Failed", { message: Schema.String })
const Missing = Schema.TaggedStruct("Missing", { message: Schema.String })
const Cancelled = Schema.TaggedStruct("Cancelled", {})
const State = Schema.Union([Loading, Loaded, Missing, Failed, Cancelled]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Cancel = Schema.TaggedStruct("Cancel", {})
const Event = Schema.Union([Cancel]).pipe(Schema.toTaggedUnion("_tag"))

const document = Machine.builder({ input: Input, state: State, event: Event })
const definition = document.make({
  id: "load-document",
  initial: (input) => ({ _tag: "Loading", id: input.id }),
  nodes: [
    document.invoke("Loading", {
      name: "Documents.load",
      description: "Load the requested document through an application-provided service.",
      effect: (state) => Effect.flatMap(Documents, ({ load }) => load(state.id)),
      onSuccess: {
        target: "Loaded",
        reduce: ({ value }) => ({ _tag: "Loaded", text: value }),
      },
      onFailure: {
        branches: [
          {
            when: {
              name: "document-not-found",
              description: "Give missing documents a distinct modeled outcome.",
              guard: ({ error }) => error._tag === "NotFound",
            },
            target: "Missing",
            reduce: ({ error }) => ({ _tag: "Missing", message: error.message }),
          },
          {
            otherwise: true,
            target: "Failed",
            reduce: ({ error }) => ({ _tag: "Failed", message: error.message }),
          },
        ],
      },
      on: {
        Cancel: {
          target: "Cancelled",
          reduce: () => ({ _tag: "Cancelled" }),
        },
      },
    }),
    document.final("Loaded"),
    document.final("Missing"),
    document.final("Failed"),
    document.final("Cancelled"),
  ],
})

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
type RequirementsAreInferred = Assert<
  Equal<Machine.MachineRequirements<typeof definition>, Documents>
>
const requirementsTypeCheck: RequirementsAreInferred = true
void requirementsTypeCheck

describe("invoked Effects", () => {
  it.effect("uses a Layer supplied at run time and routes a successful result", () =>
    Effect.gen(function* () {
      const documents = Layer.succeed(
        Documents,
        Documents.of({ load: (id) => Effect.succeed(`document:${id}`) }),
      )
      const handle = yield* Machine.run(definition, { id: "one" }).pipe(Effect.provide(documents))

      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "Loaded",
        text: "document:one",
      })
      assert.deepStrictEqual(
        (yield* Stream.runCollect(Stream.take(handle.inspection, 5))).map(({ _tag }) => _tag),
        [
          "MachineStarted",
          "InvocationStarted",
          "InvocationSucceeded",
          "StateChanged",
          "MachineCompleted",
        ],
      )
    }),
  )

  it.effect("routes tagged typed failures through named alternatives and a fallback", () =>
    Effect.gen(function* () {
      const missingLayer = Layer.succeed(
        Documents,
        Documents.of({ load: () => Effect.fail(new NotFound({ message: "missing" })) }),
      )
      const missing = yield* Machine.run(definition, { id: "missing" }).pipe(
        Effect.provide(missingLayer),
      )
      assert.deepStrictEqual(yield* missing.completion, {
        _tag: "Missing",
        message: "missing",
      })
      assert.deepStrictEqual((yield* Stream.runCollect(Stream.take(missing.inspection, 5)))[2], {
        _tag: "InvocationFailed",
        machineId: "load-document",
        stateTag: "Loading",
        invocation: "Documents.load",
        generation: 0,
        branch: {
          kind: "guard",
          index: 0,
          name: "document-not-found",
        },
      })

      const failedLayer = Layer.succeed(
        Documents,
        Documents.of({ load: () => Effect.fail(new LoadFailed({ message: "offline" })) }),
      )
      const failed = yield* Machine.run(definition, { id: "offline" }).pipe(
        Effect.provide(failedLayer),
      )
      assert.deepStrictEqual(yield* failed.completion, {
        _tag: "Failed",
        message: "offline",
      })
    }),
  )

  it.effect("interrupts state-owned work when an external event exits the invoked state", () =>
    Effect.gen(function* () {
      const interrupted = yield* Deferred.make<void>()
      const documents = Layer.succeed(
        Documents,
        Documents.of({
          load: () =>
            Effect.never.pipe(
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
              ),
            ),
        }),
      )
      const handle = yield* Machine.run(definition, { id: "slow" }).pipe(Effect.provide(documents))

      yield* handle.send({ _tag: "Cancel" })
      yield* Deferred.await(interrupted)

      assert.deepStrictEqual(yield* handle.completion, { _tag: "Cancelled" })
      assert.deepStrictEqual(
        (yield* Stream.runCollect(Stream.take(handle.inspection, 7))).map(({ _tag }) => _tag),
        [
          "MachineStarted",
          "InvocationStarted",
          "EventReceived",
          "TransitionSelected",
          "InvocationCancelled",
          "StateChanged",
          "MachineCompleted",
        ],
      )
    }),
  )

  it.effect("preserves unexpected invocation defects on completion", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      const documents = Layer.succeed(Documents, Documents.of({ load: () => Effect.die(boom) }))
      const handle = yield* Machine.run(definition, { id: "broken" }).pipe(
        Effect.provide(documents),
      )

      const exit = yield* Effect.exit(handle.completion)
      assert.strictEqual(Exit.isFailure(exit), true)
      if (Exit.isFailure(exit)) {
        assert.strictEqual(Cause.hasDies(exit.cause), true)
        assert.strictEqual(Cause.squash(exit.cause), boom)
      }
      assert.deepStrictEqual(
        (yield* Stream.runCollect(Stream.take(handle.inspection, 3))).map(({ _tag }) => _tag),
        ["MachineStarted", "InvocationStarted", "InvocationDefected"],
      )
    }),
  )

  it.effect("ignores a late callback from work interrupted by state exit", () =>
    Effect.gen(function* () {
      let resumeLate: ((effect: Effect.Effect<string, LoadFailed | NotFound>) => void) | undefined
      const documents = Layer.succeed(
        Documents,
        Documents.of({
          load: () =>
            Effect.callback<string, LoadFailed | NotFound>((resume) => {
              resumeLate = resume
            }),
        }),
      )
      const handle = yield* Machine.run(definition, { id: "late" }).pipe(Effect.provide(documents))
      yield* Effect.yieldNow
      if (resumeLate === undefined) {
        return yield* Effect.die("Invocation did not register its callback")
      }

      yield* handle.send({ _tag: "Cancel" })
      resumeLate(Effect.succeed("too late"))
      yield* Effect.yieldNow

      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Cancelled" })
    }),
  )

  it("projects the named invocation and its declared outcomes without inspecting the Effect", () => {
    const graph = Graph.fromDefinition(definition)

    assert.deepStrictEqual(graph.nodes[0], {
      id: "Loading",
      title: "Loading",
      kind: "invoke",
      invocation: {
        name: "Documents.load",
        description: "Load the requested document through an application-provided service.",
      },
    })
    assert.deepStrictEqual(
      graph.edges.filter((edge) => edge.outcome !== undefined),
      [
        {
          source: "Loading",
          target: "Loaded",
          outcome: { kind: "success" },
        },
        {
          source: "Loading",
          target: "Missing",
          outcome: { kind: "failure" },
          branch: {
            kind: "guard",
            index: 0,
            name: "document-not-found",
            description: "Give missing documents a distinct modeled outcome.",
          },
        },
        {
          source: "Loading",
          target: "Failed",
          outcome: { kind: "failure" },
          branch: { kind: "otherwise", index: 1 },
        },
      ],
    )
  })
})
