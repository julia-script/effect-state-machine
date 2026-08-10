import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { ConflictResolution } from "../examples/LocalFirstDocument.js"
import * as DevToolsSession from "../src/DevToolsSession.js"
import * as Machine from "../src/Machine.js"
import { counterDefinition } from "./fixtures/Counter.js"

describe("DevToolsSession", () => {
  it.effect("attaches through the public machine handle and follows application transitions", () =>
    Effect.gen(function* () {
      const machineScope = yield* Scope.make()
      const sessionScope = yield* Scope.make()
      const handle = yield* Machine.run(counterDefinition, { count: 1 }).pipe(
        Effect.provideService(Scope.Scope, machineScope),
      )
      const session = yield* DevToolsSession.attach({
        definition: counterDefinition,
        handle,
        projectState: (state) => ({ count: state.count }),
      }).pipe(Effect.provideService(Scope.Scope, sessionScope))

      yield* Effect.yieldNow
      const initial = yield* session.view
      assert.strictEqual(initial.machine.id, "counter")
      assert.strictEqual(initial.liveHead, 0)
      assert.strictEqual(initial.selected.state.tag, "Active")
      assert.deepStrictEqual(initial.selected.state.details, { count: 1 })
      assert.strictEqual("count" in initial.selected.state, false)

      yield* handle.send({ _tag: "Increment", amount: 2 })
      const advanced = yield* session.changes.pipe(
        Stream.filter((view) => view.liveHead === 1),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      )
      assert.strictEqual(advanced.liveHead, 1)
      assert.deepStrictEqual(advanced.selected.state.details, { count: 3 })
      assert.deepStrictEqual(
        advanced.history.raw.map((record) => record.event._tag),
        ["MachineStarted", "EventReceived", "TransitionSelected", "StateChanged"],
      )
      const eventStep = advanced.history.semantic.find((step) => step.kind === "event")
      assert.strictEqual(eventStep?.eventTag, "Increment")
      assert.strictEqual(eventStep?.committedPosition, 1)
      assert.deepStrictEqual(eventStep?.raw, [1, 2, 3])

      yield* Scope.close(sessionScope, Exit.void)
      yield* handle.send({ _tag: "Increment", amount: 4 })
      assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 7 })
      assert.strictEqual((yield* session.view).liveHead, 1)

      yield* Scope.close(machineScope, Exit.void)
    }),
  )

  it.effect("subscribes when attached rather than when its changes Stream is consumed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(counterDefinition, { count: 0 })
        const session = yield* DevToolsSession.attach({ definition: counterDefinition, handle })

        yield* handle.send({ _tag: "Increment", amount: 1 })
        yield* handle.send({ _tag: "Pause" })
        const view = yield* session.changes.pipe(
          Stream.filter((candidate) => candidate.liveHead === 2),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        assert.strictEqual(view.liveHead, 2)
        assert.deepStrictEqual(
          view.positions.map((entry) => entry.state.tag),
          ["Active", "Active", "Paused"],
        )
        assert.strictEqual(yield* Stream.runCount(Stream.take(session.changes, 1)), 1)
      }),
    ),
  )

  it.effect("retains completion and defect evidence as semantic and raw history", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const completedHandle = yield* Machine.run(ConflictResolution, {
          localText: "local",
          remoteText: "remote",
        })
        const completed = yield* DevToolsSession.attach({
          definition: ConflictResolution,
          handle: completedHandle,
        })
        yield* completedHandle.send({ _tag: "ChooseResolution", text: "merged" })
        const completedView = yield* completed.changes.pipe(
          Stream.filter((view) => view.status === "completed" && view.liveHead === 1),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        assert.deepStrictEqual(
          completedView.history.semantic.map((step) => step.kind),
          ["machine", "event", "completion"],
        )

        const defectedHandle = yield* Machine.run(counterDefinition, { count: 0 })
        const defected = yield* DevToolsSession.attach({
          definition: counterDefinition,
          handle: defectedHandle,
        })
        yield* Effect.exit(defectedHandle.send({ _tag: "Resume" }))
        const defectedView = yield* defected.changes.pipe(
          Stream.filter((view) => view.status === "defected"),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        const failedEvent = defectedView.history.semantic.find((step) => step.kind === "event")
        assert.strictEqual(failedEvent?.status, "defected")
        assert.deepStrictEqual(
          defectedView.history.raw.map((record) => record.event._tag),
          ["MachineStarted", "EventReceived", "MachineDefected"],
        )
      }),
    ),
  )

  it.effect("navigates recorded snapshots while live execution keeps advancing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(counterDefinition, { count: 0 })
        const session = yield* DevToolsSession.attach({
          definition: counterDefinition,
          handle,
          projectState: (state) => ({ count: state.count }),
        })

        yield* handle.send({ _tag: "Increment", amount: 1 })
        yield* session.changes.pipe(
          Stream.filter((view) => view.liveHead === 1),
          Stream.runHead,
        )
        yield* session.previous
        let view = yield* session.view
        assert.strictEqual(view.cursor, 0)
        assert.strictEqual(view.liveHead, 1)
        assert.strictEqual(view.isLive, false)
        assert.deepStrictEqual(view.selected.state.details, { count: 0 })

        yield* handle.send({ _tag: "Increment", amount: 2 })
        view = yield* session.changes.pipe(
          Stream.filter((candidate) => candidate.liveHead === 2),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        assert.strictEqual(view.cursor, 0)
        assert.strictEqual(view.liveHead, 2)
        assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 3 })

        yield* session.next
        assert.deepStrictEqual((yield* session.view).selected.state.details, { count: 1 })
        const eventStep = [...(yield* session.view).history.semantic]
          .reverse()
          .find((step) => step.eventTag === "Increment")
        assert.strictEqual(yield* session.selectStep(eventStep?.index ?? -1), true)
        assert.strictEqual((yield* session.view).cursor, 2)
        yield* session.previous
        yield* session.returnToLive
        assert.strictEqual((yield* session.view).cursor, 2)
        assert.strictEqual(yield* session.selectPosition(99), false)
        assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Active", count: 3 })
      }),
    ),
  )
})
