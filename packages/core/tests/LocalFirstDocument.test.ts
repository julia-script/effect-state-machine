import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import {
  Documents,
  LocalFirstDocument,
  OpenFailed,
  SyncConflict,
  Synchronizer,
  SyncOffline,
} from "../examples/LocalFirstDocument.js"
import * as Graph from "../src/Graph.js"
import * as Machine from "../src/Machine.js"
import * as Mermaid from "../src/Mermaid.js"
import { runMachine } from "./runMachine.js"

const documents = Layer.succeed(
  Documents,
  Documents.of({
    open: (id) => Effect.succeed({ id, text: "initial", revision: 1 }),
    save: ({ revision }) => Effect.succeed(revision + 1),
  }),
)

const synchronizer = Layer.succeed(
  Synchronizer,
  Synchronizer.of({ sync: ({ revision }) => Effect.succeed(revision + 1) }),
)

const application = Layer.merge(documents, synchronizer)

describe("local-first document reference workflow", () => {
  it.effect("opens, edits, saves, synchronizes, and closes one document", () =>
    Effect.gen(function* () {
      const handle = yield* runMachine(LocalFirstDocument.definition, {
        documentId: "one",
      }).pipe(Effect.provide(application))

      yield* Stream.runHead(handle.changes.pipe(Stream.filter((state) => state._tag === "Editing")))
      yield* handle.send({ _tag: "Edit", text: "changed" })
      yield* handle.send({ _tag: "Save" })
      const synchronized = yield* Stream.runHead(
        handle.changes.pipe(
          Stream.filter((state) => state._tag === "Editing" && state.revision === 3),
        ),
      )
      assert.strictEqual(synchronized._tag, "Some")

      yield* handle.send({ _tag: "Close" })
      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "Closed",
        documentId: "one",
      })

      const semanticTrace = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter(
            (event) =>
              event._tag === "MachineStarted" ||
              event._tag === "InvocationStarted" ||
              event._tag === "MachineCompleted",
          ),
          Stream.take(5),
        ),
      )
      assert.deepStrictEqual(
        semanticTrace.map(({ _tag }) => _tag),
        [
          "MachineStarted",
          "InvocationStarted",
          "InvocationStarted",
          "InvocationStarted",
          "MachineCompleted",
        ],
      )
    }),
  )

  it.effect("retries offline synchronization deterministically with TestClock", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const retryingSynchronizer = Layer.succeed(
        Synchronizer,
        Synchronizer.of({
          sync: ({ revision }) =>
            Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
              Effect.flatMap((attempt) =>
                attempt < 3
                  ? Effect.fail(new SyncOffline({ message: "offline" }))
                  : Effect.succeed(revision + 1),
              ),
            ),
        }),
      )
      const handle = yield* runMachine(
        LocalFirstDocument.definition,
        { documentId: "retry" },
        { activityLeaseMillis: 5 * 60_000, activityWorkerCount: 1 },
      ).pipe(Effect.provide(Layer.merge(documents, retryingSynchronizer)))

      yield* Stream.runHead(handle.changes.pipe(Stream.filter((state) => state._tag === "Editing")))
      yield* handle.send({ _tag: "Edit", text: "retry me" })
      yield* handle.send({ _tag: "Save" })

      const firstRetry = yield* Stream.runHead(
        handle.inspection.pipe(
          Stream.filter(
            (event) => event._tag === "InvocationRetryScheduled" && event.attempt === 1,
          ),
        ),
      )
      assert.strictEqual(firstRetry._tag, "Some")
      if (firstRetry._tag === "Some" && firstRetry.value._tag === "InvocationRetryScheduled") {
        assert.strictEqual(firstRetry.value.delayMillis, 60_000)
      }
      yield* TestClock.adjust("1 minute")

      yield* Stream.runHead(
        handle.inspection.pipe(
          Stream.filter(
            (event) => event._tag === "InvocationRetryScheduled" && event.attempt === 2,
          ),
        ),
      )
      yield* TestClock.adjust("1 minute")

      const synchronized = yield* Stream.runHead(
        handle.changes.pipe(
          Stream.filter((state) => state._tag === "Editing" && state.revision === 3),
        ),
      )
      assert.strictEqual(synchronized._tag, "Some")
      assert.strictEqual(yield* Ref.get(attempts), 3)
    }),
  )

  it.effect("continues offline and interrupts local save work on state exit", () =>
    Effect.gen(function* () {
      const saveStarted = yield* Deferred.make<void>()
      const saveInterrupted = yield* Deferred.make<void>()
      const slowDocuments = Layer.succeed(
        Documents,
        Documents.of({
          open: (id) => Effect.succeed({ id, text: "initial", revision: 1 }),
          save: () =>
            Effect.andThen(Deferred.succeed(saveStarted, undefined), Effect.never).pipe(
              Effect.onInterrupt(() =>
                Deferred.succeed(saveInterrupted, undefined).pipe(Effect.asVoid),
              ),
            ),
        }),
      )
      const handle = yield* runMachine(LocalFirstDocument.definition, {
        documentId: "offline",
      }).pipe(Effect.provide(Layer.merge(slowDocuments, synchronizer)))

      yield* Stream.runHead(handle.changes.pipe(Stream.filter((state) => state._tag === "Editing")))
      yield* handle.send({ _tag: "GoOffline" })
      yield* handle.send({ _tag: "Edit", text: "local only" })
      yield* handle.send({ _tag: "Save" })
      yield* Deferred.await(saveStarted)
      yield* handle.send({ _tag: "GoOffline" })
      yield* Deferred.await(saveInterrupted)

      assert.deepStrictEqual(yield* handle.snapshot, {
        _tag: "Offline",
        documentId: "offline",
        text: "local only",
        revision: 1,
        dirty: true,
        pendingSync: false,
      })
      yield* handle.send({ _tag: "Close" })
      assert.deepStrictEqual(yield* handle.completion, {
        _tag: "Closed",
        documentId: "offline",
      })
    }),
  )

  it.effect("resolves a remote conflict through the scoped child protocol", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const conflictingSynchronizer = Layer.succeed(
        Synchronizer,
        Synchronizer.of({
          sync: ({ revision }) =>
            Ref.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
              Effect.flatMap((attempt) =>
                attempt === 1
                  ? Effect.fail(new SyncConflict({ remoteText: "remote" }))
                  : Effect.succeed(revision + 1),
              ),
            ),
        }),
      )
      const handle = yield* runMachine(LocalFirstDocument.definition, {
        documentId: "conflict",
      }).pipe(Effect.provide(Layer.merge(documents, conflictingSynchronizer)))

      yield* Stream.runHead(handle.changes.pipe(Stream.filter((state) => state._tag === "Editing")))
      yield* handle.send({ _tag: "Edit", text: "local" })
      yield* handle.send({ _tag: "Save" })
      yield* Stream.runHead(
        handle.changes.pipe(Stream.filter((state) => state._tag === "ResolvingConflict")),
      )
      yield* handle.send({ _tag: "ResolveConflict", text: "merged" })

      const merged = yield* Stream.runHead(
        handle.changes.pipe(
          Stream.filter(
            (state) => state._tag === "Editing" && state.text === "merged" && state.revision === 4,
          ),
        ),
      )
      assert.strictEqual(merged._tag, "Some")
      const childLifecycle = yield* Stream.runCollect(
        handle.inspection.pipe(
          Stream.filter((event) => event._tag.startsWith("Child")),
          Stream.take(3),
        ),
      )
      assert.deepStrictEqual(
        childLifecycle.map(({ _tag }) => _tag),
        ["ChildStarted", "ChildEventForwarded", "ChildCompleted"],
      )
    }),
  )

  it.effect("routes expected open failures but terminates on unexpected sync defects", () =>
    Effect.gen(function* () {
      const failingDocuments = Layer.succeed(
        Documents,
        Documents.of({
          open: () => Effect.fail(new OpenFailed({ message: "missing" })),
          save: ({ revision }) => Effect.succeed(revision + 1),
        }),
      )
      const expected = yield* runMachine(LocalFirstDocument.definition, {
        documentId: "missing",
      }).pipe(Effect.provide(Layer.merge(failingDocuments, synchronizer)))
      assert.deepStrictEqual(yield* expected.completion, {
        _tag: "OpeningFailed",
        documentId: "missing",
        message: "missing",
      })

      const boom = new Error("unexpected")
      const defectingSynchronizer = Layer.succeed(
        Synchronizer,
        Synchronizer.of({ sync: () => Effect.die(boom) }),
      )
      const defected = yield* runMachine(LocalFirstDocument.definition, {
        documentId: "broken",
      }).pipe(Effect.provide(Layer.merge(documents, defectingSynchronizer)))
      yield* Stream.runHead(
        defected.changes.pipe(Stream.filter((state) => state._tag === "Editing")),
      )
      yield* defected.send({ _tag: "Edit", text: "changed" })
      yield* defected.send({ _tag: "Save" })
      const error = yield* Effect.flip(defected.completion)
      assert.strictEqual(error._tag, "MachineInstanceDefect")
      if (error._tag !== "MachineInstanceDefect") return
      assert.strictEqual(String(error.instanceId), String(defected.instanceId))
      assert.deepStrictEqual(error.defect, {
        category: "activity",
        name: "Error",
        message: "unexpected",
      })
    }),
  )

  it.effect("encodes and decodes only explicit schema boundaries", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* Machine.decodeInput(LocalFirstDocument.definition, { documentId: "codec" }),
        { documentId: "codec" },
      )
      assert.deepStrictEqual(
        yield* Machine.encodeState(LocalFirstDocument.definition, {
          _tag: "Editing",
          documentId: "codec",
          text: "text",
          revision: 1,
          dirty: false,
        }),
        {
          _tag: "Editing",
          documentId: "codec",
          text: "text",
          revision: 1,
          dirty: false,
        },
      )
      assert.deepStrictEqual(
        yield* Machine.decodeEvent(LocalFirstDocument.definition, {
          _tag: "ResolveConflict",
          text: "merged",
        }),
        { _tag: "ResolveConflict", text: "merged" },
      )
    }),
  )

  it("derives its read-only graph and Mermaid view from the executed definition", () => {
    const graph = Graph.fromDefinition(LocalFirstDocument.definition)
    const syncing = graph.nodes.find(({ id }) => id === "Syncing")
    const conflict = graph.nodes.find(({ id }) => id === "ResolvingConflict")

    assert.strictEqual(syncing?.invocation?.retry?.name, "retry-while-offline")
    assert.strictEqual(conflict?.child?.definition.id, "local-first-conflict-resolution")
    assert.deepStrictEqual(
      conflict?.child?.forwards.map(({ parentEvent, childEvent }) => [
        parentEvent.tag,
        childEvent.tag,
      ]),
      [
        ["ResolveConflict", "ChooseResolution"],
        ["AbortConflict", "AbortResolution"],
      ],
    )

    const mermaid = Mermaid.render(graph)
    assert.match(mermaid, /retry: retry-while-offline/)
    assert.match(mermaid, /child: resolve-conflict/)
  })
})
