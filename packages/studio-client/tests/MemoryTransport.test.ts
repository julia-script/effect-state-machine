import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as MemoryTransport from "../src/MemoryTransport.js"
import type * as Protocol from "../src/Protocol.js"

const ended = (sessionId: string): Protocol.Message => ({ _tag: "SessionEnded", sessionId })

const connectionIn = (scope: Scope.Scope, transport: MemoryTransport.DuplexPair["application"]) =>
  transport.connect.pipe(Effect.provideService(Scope.Scope, scope))

describe("MemoryTransport.makeDuplex", () => {
  it.effect("delivers in both directions and buffers for a late peer", () =>
    Effect.gen(function* () {
      const pair = yield* MemoryTransport.makeDuplex
      const applicationScope = yield* Scope.make()
      const viewerScope = yield* Scope.make()
      const application = yield* connectionIn(applicationScope, pair.application)

      yield* application.send(ended("first"))
      yield* application.send(ended("second"))

      const viewer = yield* connectionIn(viewerScope, pair.viewer)
      assert.deepStrictEqual(yield* Queue.take(viewer.messages), ended("first"))
      assert.deepStrictEqual(yield* Queue.take(viewer.messages), ended("second"))

      yield* viewer.send(ended("reply"))
      assert.deepStrictEqual(yield* Queue.take(application.messages), ended("reply"))

      yield* Scope.close(viewerScope, Exit.void)
      yield* Scope.close(applicationScope, Exit.void)
    }),
  )

  it.effect("closes stale connections and permits reconnection", () =>
    Effect.gen(function* () {
      const pair = yield* MemoryTransport.makeDuplex
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      const viewerScope = yield* Scope.make()
      const first = yield* connectionIn(firstScope, pair.application)
      const viewer = yield* connectionIn(viewerScope, pair.viewer)
      const second = yield* connectionIn(secondScope, pair.application)

      assert.ok(Exit.isFailure(yield* Effect.exit(first.send(ended("stale")))))
      yield* second.send(ended("fresh"))
      assert.deepStrictEqual(yield* Queue.take(viewer.messages), ended("fresh"))

      yield* Scope.close(secondScope, Exit.void)
      assert.ok(Exit.isFailure(yield* Effect.exit(second.send(ended("closed")))))

      const thirdScope = yield* Scope.make()
      const third = yield* connectionIn(thirdScope, pair.application)
      yield* third.send(ended("reconnected"))
      assert.deepStrictEqual(yield* Queue.take(viewer.messages), ended("reconnected"))

      yield* Scope.close(thirdScope, Exit.void)
      yield* Scope.close(viewerScope, Exit.void)
      yield* Scope.close(firstScope, Exit.void)
    }),
  )
})
