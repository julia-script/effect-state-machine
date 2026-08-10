import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
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
})
