import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import { runMachine } from "./runMachine.js"

class SaveFailed extends Schema.TaggedError<SaveFailed>()("SaveFailed", {
  message: Schema.String,
}) {}

class ConflictStore extends Context.Service<
  ConflictStore,
  Readonly<{
    save: (text: string) => Effect.Effect<string, SaveFailed>
  }>
>()("tests/ConflictStore") {}

const ChildInput = Schema.Struct({ documentId: Schema.String })
const Choosing = Schema.TaggedStruct("Choosing", { documentId: Schema.String })
const Saving = Schema.TaggedStruct("Saving", { text: Schema.String })
const Chosen = Schema.TaggedStruct("Chosen", { text: Schema.String })
const ChildFailed = Schema.TaggedStruct("ChildFailed", { message: Schema.String })
const ChildState = Schema.Union([Choosing, Saving, Chosen, ChildFailed]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Choose = Schema.TaggedStruct("Choose", { text: Schema.String })
const ChildEvent = Schema.Union([Choose]).pipe(Schema.toTaggedUnion("_tag"))

const conflict = Machine.builder({ input: ChildInput, state: ChildState, event: ChildEvent })
const conflictDefinition = conflict.define(
  {
    id: "conflict-resolution",
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
    initial: (input) => ({ _tag: "Choosing", documentId: input.documentId }),
  },
  {
    Choosing: conflict.state({
      Choose: {
        target: "Saving",
        reduce: ({ event }) => ({ _tag: "Saving", text: event.text }),
      },
    }),
    Saving: conflict.invoke({
      name: "ConflictStore.save",
      success: Schema.String,
      error: SaveFailed,
      effect: (state) => Effect.flatMap(ConflictStore, ({ save }) => save(state.text)),
      onSuccess: {
        target: "Chosen",
        reduce: ({ value }) => ({ _tag: "Chosen", text: value }),
      },
      onFailure: {
        target: "ChildFailed",
        reduce: ({ error }) => ({ _tag: "ChildFailed", message: error.message }),
      },
    }),
    Chosen: conflict.final(),
    ChildFailed: conflict.final(),
  },
)

const ParentInput = Schema.Struct({ documentId: Schema.String })
const Resolving = Schema.TaggedStruct("Resolving", { documentId: Schema.String })
const Resolved = Schema.TaggedStruct("Resolved", { text: Schema.String })
const ResolutionFailed = Schema.TaggedStruct("ResolutionFailed", { message: Schema.String })
const Cancelled = Schema.TaggedStruct("Cancelled", {})
const ParentState = Schema.Union([Resolving, Resolved, ResolutionFailed, Cancelled]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const Resolve = Schema.TaggedStruct("Resolve", { text: Schema.String })
const Cancel = Schema.TaggedStruct("Cancel", {})
const ParentEvent = Schema.Union([Resolve, Cancel]).pipe(Schema.toTaggedUnion("_tag"))

const document = Machine.builder({
  input: ParentInput,
  state: ParentState,
  event: ParentEvent,
})
const definition = document.define(
  {
    id: "document-session",
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
    initial: (input) => ({ _tag: "Resolving", documentId: input.documentId }),
  },
  {
    Resolving: document.child(
      {
        name: "resolve-conflict",
        description: "Own the interactive conflict-resolution protocol.",
        definition: conflictDefinition,
        input: (state) => ({ documentId: state.documentId }),
        forward: {
          Resolve: {
            target: "Choose",
            map: ({ event }) => ({ _tag: "Choose", text: event.text }),
          },
        },
        onComplete: {
          branches: [
            {
              when: {
                name: "resolution-succeeded",
                guard: ({ value }) => value._tag === "Chosen",
              },
              target: "Resolved",
              reduce: ({ value }) => ({
                _tag: "Resolved",
                text: value._tag === "Chosen" ? value.text : "",
              }),
            },
            {
              otherwise: true,
              target: "ResolutionFailed",
              reduce: ({ value }) => ({
                _tag: "ResolutionFailed",
                message: value._tag === "ChildFailed" ? value.message : "unknown",
              }),
            },
          ],
        },
      },
      {
        Cancel: {
          target: "Cancelled",
          reduce: () => ({ _tag: "Cancelled" }),
        },
      },
    ),
    Resolved: document.final(),
    ResolutionFailed: document.final(),
    Cancelled: document.final(),
  },
)

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
type ChildRequirementsAreTransitive = Assert<
  Equal<Machine.MachineRequirements<typeof definition>, ConflictStore>
>
const requirementsTypeCheck: ChildRequirementsAreTransitive = true
void requirementsTypeCheck

const successStore = Layer.succeed(
  ConflictStore,
  ConflictStore.of({ save: (text) => Effect.succeed(text) }),
)

describe("scoped child machines", () => {
  it("constructs stable total definition paths for well-formed and malformed names", () => {
    assert.strictEqual(
      Machine.DefinitionPath.child(Machine.DefinitionPath.root, "Resolving state", "work/item"),
      "root/Resolving%20state:work%2Fitem",
    )
    assert.strictEqual(
      Machine.DefinitionPath.child(Machine.DefinitionPath.root, "state\ud800", "work\udc00"),
      "root/state%EF%BF%BD:work%EF%BF%BD",
    )
  })

  it.effect("addresses a child through the root tree and retains causal actor history", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(definition, { documentId: "tree" }).pipe(
        Effect.provide(successStore),
      )
      const starts = yield* Stream.runCollect(
        handle.tree.records.pipe(
          Stream.filter((record) => record.body._tag === "ActorStarted"),
          Stream.take(2),
        ),
      )
      const child = starts.find((record) => record.actorId !== handle.actorId)
      assert.notStrictEqual(child, undefined)
      if (child === undefined) return

      assert.strictEqual(child.definitionPath, "root/Resolving:resolve-conflict")
      assert.strictEqual(child.body._tag, "ActorStarted")
      if (child.body._tag === "ActorStarted") {
        assert.strictEqual(child.body.parentActorId, handle.actorId)
        assert.strictEqual(child.body.invocation, "resolve-conflict")
      }

      yield* handle.tree.dispatch(child.actorId, { _tag: "Choose", text: "direct" })
      assert.deepStrictEqual(yield* handle.completion, { _tag: "Resolved", text: "direct" })

      const records = yield* Stream.runCollect(
        handle.tree.records.pipe(
          Stream.takeUntil(
            (record) =>
              record.actorId === handle.actorId &&
              record.body._tag === "ActorTerminated" &&
              record.body.status === "completed",
          ),
        ),
      )
      const childTerminal = records.findIndex(
        (record) => record.actorId === child.actorId && record.body._tag === "ActorTerminated",
      )
      const parentCompletion = records.findIndex(
        (record) =>
          record.actorId === handle.actorId &&
          record.body._tag === "Inspection" &&
          record.body.metadata._tag === "ChildCompleted",
      )
      assert.strictEqual(childTerminal >= 0, true)
      assert.strictEqual(parentCompletion > childTerminal, true)

      const ended = yield* Effect.flip(
        handle.tree.dispatch(child.actorId, { _tag: "Choose", text: "late" }),
      )
      assert.strictEqual(ended.reason, "ended")
    }),
  )

  it.effect("forwards declared events and routes the child's inferred final state", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(definition, { documentId: "one" }).pipe(
        Effect.provide(successStore),
      )

      assert.strictEqual(yield* handle.can({ _tag: "Resolve", text: "merged" }), true)
      yield* handle.send({ _tag: "Resolve", text: "merged" })
      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "Resolved",
        text: "merged",
      })

      const lifecycle = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter((event) => event._tag.startsWith("Child")),
          Stream.take(3),
        ),
      )
      assert.deepStrictEqual(
        lifecycle.map(({ _tag }) => _tag),
        ["ChildStarted", "ChildEventForwarded", "ChildCompleted"],
      )
      const started = lifecycle[0]
      const completed = lifecycle[2]
      assert.strictEqual(started?._tag, "ChildStarted")
      assert.strictEqual(completed?._tag, "ChildCompleted")
      if (started?._tag === "ChildStarted" && completed?._tag === "ChildCompleted") {
        assert.strictEqual(started.instanceId, completed.instanceId)
      }
    }),
  )

  it.effect("links the authored invocation to the child definition in the static graph", () =>
    Effect.gen(function* () {
      const node = Graph.fromDefinition(definition).nodes[0]
      assert.strictEqual(node?.kind, "child")
      assert.strictEqual(node?.child?.name, "resolve-conflict")
      assert.strictEqual(node?.child?.definition.id, "conflict-resolution")
      assert.deepStrictEqual(node?.child?.forwards, [
        {
          parentEvent: { tag: "Resolve" },
          childEvent: { tag: "Choose" },
        },
      ])
      assert.deepStrictEqual(
        node?.child?.definition.nodes.map(({ id }) => id),
        ["Choosing", "Saving", "Chosen", "ChildFailed"],
      )
    }),
  )

  it.effect("interrupts the child scope before stale completion can affect the parent", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const store = Layer.succeed(
        ConflictStore,
        ConflictStore.of({
          save: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() =>
                Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
              ),
            ),
        }),
      )
      const handle = yield* runMachine(definition, { documentId: "slow" }).pipe(
        Effect.provide(store),
      )

      yield* handle.send({ _tag: "Resolve", text: "pending" })
      yield* Deferred.await(started)
      yield* handle.send({ _tag: "Cancel" })
      yield* Deferred.await(interrupted)

      assert.deepStrictEqual(yield* handle.completion, { _tag: "Cancelled" })
      const childEvents = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter((event) => event._tag.startsWith("Child")),
          Stream.take(3),
        ),
      )
      assert.deepStrictEqual(
        childEvents.map(({ _tag }) => _tag),
        ["ChildStarted", "ChildEventForwarded", "ChildCancelled"],
      )
      const terminalRecords = yield* Stream.runCollect(
        handle.tree.records.pipe(
          Stream.filter((record) => record.body._tag === "ActorTerminated"),
          Stream.take(2),
        ),
      )
      assert.deepStrictEqual(
        terminalRecords.map(({ body }) => (body._tag === "ActorTerminated" ? body.status : "")),
        ["cancelled", "completed"],
      )
    }),
  )

  it.effect("propagates child defects with correlated inspection identity", () =>
    Effect.gen(function* () {
      const boom = new Error("boom")
      const store = Layer.succeed(ConflictStore, ConflictStore.of({ save: () => Effect.die(boom) }))
      const handle = yield* runMachine(definition, { documentId: "broken" }).pipe(
        Effect.provide(store),
      )

      yield* handle.send({ _tag: "Resolve", text: "broken" })
      const error = yield* Effect.flip(handle.completion)
      assert.strictEqual(error._tag, "MachineInstanceDefect")
      if (error._tag !== "MachineInstanceDefect") return
      assert.strictEqual(String(error.instanceId), String(handle.instanceId))
      assert.deepStrictEqual(error.defect, {
        category: "activity",
        name: "Error",
        message: "boom",
      })

      const lifecycle = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter((event) => event._tag === "ChildStarted" || event._tag === "ChildDefected"),
          Stream.take(2),
        ),
      )
      const started = lifecycle[0]
      const defected = lifecycle[1]
      assert.strictEqual(started?._tag, "ChildStarted")
      assert.strictEqual(defected?._tag, "ChildDefected")
      if (started?._tag === "ChildStarted" && defected?._tag === "ChildDefected") {
        assert.strictEqual(started.instanceId, defected.instanceId)
      }
      const terminalRecords = yield* Stream.runCollect(
        handle.tree.records.pipe(
          Stream.filter((record) => record.body._tag === "ActorTerminated"),
          Stream.take(2),
        ),
      )
      assert.deepStrictEqual(
        terminalRecords.map(({ body }) => (body._tag === "ActorTerminated" ? body.status : "")),
        ["defected", "defected"],
      )
    }),
  )

  it.effect("assigns a fresh runtime instance ID on every repeated entry", () =>
    Effect.gen(function* () {
      const SessionInput = Schema.Struct({ documentId: Schema.String })
      const Idle = Schema.TaggedStruct("Idle", { documentId: Schema.String })
      const SessionResolving = Schema.TaggedStruct("SessionResolving", {
        documentId: Schema.String,
      })
      const SessionState = Schema.Union([Idle, SessionResolving]).pipe(Schema.toTaggedUnion("_tag"))
      const Begin = Schema.TaggedStruct("Begin", {})
      const Stop = Schema.TaggedStruct("Stop", {})
      const SessionEvent = Schema.Union([Begin, Stop]).pipe(Schema.toTaggedUnion("_tag"))
      const session = Machine.builder({
        input: SessionInput,
        state: SessionState,
        event: SessionEvent,
      })
      const repeatedDefinition = session.define(
        {
          id: "repeated-child-session",
          idempotencyKey: (input) => JSON.stringify(input) ?? "default",
          initial: (input) => ({ _tag: "SessionResolving", documentId: input.documentId }),
        },
        {
          Idle: session.state({
            Begin: {
              target: "SessionResolving",
              reduce: ({ state }) => ({
                _tag: "SessionResolving",
                documentId: state.documentId,
              }),
            },
          }),
          SessionResolving: session.child(
            {
              name: "resolve-conflict",
              definition: conflictDefinition,
              input: (state) => ({ documentId: state.documentId }),
              onComplete: {
                target: "Idle",
                reduce: ({ state }) => ({ _tag: "Idle", documentId: state.documentId }),
              },
            },
            {
              Stop: {
                target: "Idle",
                reduce: ({ state }) => ({ _tag: "Idle", documentId: state.documentId }),
              },
            },
          ),
        },
      )
      const handle = yield* runMachine(repeatedDefinition, { documentId: "one" }).pipe(
        Effect.provide(successStore),
      )

      yield* handle.send({ _tag: "Stop" })
      yield* handle.send({ _tag: "Begin" })

      const starts = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter((event) => event._tag === "ChildStarted"),
          Stream.take(2),
        ),
      )
      assert.strictEqual(starts.length, 2)
      assert.notStrictEqual(starts[0]?.instanceId, starts[1]?.instanceId)
      const lifecycle = yield* Stream.runCollect(
        handle.tree.records.pipe(
          Stream.filter(
            (record) =>
              record.actorId !== handle.actorId &&
              (record.body._tag === "ActorStarted" || record.body._tag === "ActorTerminated"),
          ),
          Stream.take(3),
        ),
      )
      const actors = lifecycle.filter((record) => record.body._tag === "ActorStarted")
      assert.strictEqual(actors.length, 2)
      assert.notStrictEqual(actors[0]?.actorId, actors[1]?.actorId)
      assert.deepStrictEqual(
        lifecycle.map((record) =>
          record.body._tag === "ActorTerminated"
            ? `${record.body._tag}:${record.body.status}`
            : record.body._tag,
        ),
        ["ActorStarted", "ActorTerminated:cancelled", "ActorStarted"],
      )
      assert.strictEqual(lifecycle[0]?.actorId, lifecycle[1]?.actorId)
      assert.strictEqual(lifecycle[2]?.actorId, actors[1]?.actorId)
      const endedActorId = lifecycle[1]?.actorId
      assert.strictEqual(
        lifecycle.slice(2).some((record) => record.actorId === endedActorId),
        false,
      )
    }),
  )
})
