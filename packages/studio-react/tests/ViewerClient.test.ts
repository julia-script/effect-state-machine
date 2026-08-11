import { assert, describe, it } from "@effect/vitest"
import { MemoryTransport, type Protocol } from "@effect-state-machine/studio-client"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as ViewerClient from "../src/state/ViewerClient.js"

const hello: Protocol.HelloMessage = {
  _tag: "Hello",
  protocolVersion: 1,
  sessionId: "session-1",
  rootActorId: "actor-1",
  app: { name: "viewer-test", runtime: "browser" },
  machine: { id: "viewer-machine" },
  graph: {
    id: "viewer-machine",
    nodes: [{ id: "Idle", title: "Idle", kind: "state" }],
    edges: [],
    ignores: [],
  },
  jsonSchemas: { states: {}, events: {} },
  quickEvents: [],
  definitions: [
    {
      definitionPath: "root",
      machine: { id: "viewer-machine" },
      graph: {
        id: "viewer-machine",
        nodes: [{ id: "Idle", title: "Idle", kind: "state" }],
        edges: [],
        ignores: [],
      },
      jsonSchemas: { states: {}, events: {} },
      quickEvents: [],
      children: [],
    },
  ],
}

describe("ViewerClient", () => {
  it.live("folds direct messages and round-trips dispatch outcomes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pair = yield* MemoryTransport.makeDuplex
        const client = yield* ViewerClient.make({
          transport: pair.viewer,
          reconnectInterval: "10 millis",
        })
        const application = yield* pair.application.connect
        yield* application.send(hello)

        const world = yield* client.world.pipe(
          Stream.filter((candidate) => candidate.sessions.length === 1),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
          Effect.timeout("1 second"),
        )
        assert.strictEqual(world.sessions[0]?.hello.machine.id, "viewer-machine")

        const pending = yield* Effect.forkChild(
          client.dispatch({
            sessionId: hello.sessionId,
            actorId: hello.rootActorId,
            command: { _tag: "Quick", id: "start" },
          }),
        )
        const dispatched = yield* Queue.take(application.messages)
        assert.strictEqual(dispatched._tag, "Dispatch")
        if (dispatched._tag !== "Dispatch") return
        yield* application.send({
          _tag: "DispatchOutcome",
          sessionId: hello.sessionId,
          actorId: hello.rootActorId,
          correlationId: dispatched.correlationId,
          result: { _tag: "Accepted" },
        })
        assert.deepStrictEqual(yield* Fiber.join(pending), { _tag: "Accepted" })
      }),
    ),
  )

  it.effect("delegates source opening and preserves host failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const pair = yield* MemoryTransport.makeDuplex
        const opened: Array<string> = []
        const client = yield* ViewerClient.make({
          transport: pair.viewer,
          openSource: (location) => Effect.sync(() => opened.push(location.file)),
        })
        yield* client.openEditor({ file: "Machine.ts", line: 1, column: 1 })
        assert.deepStrictEqual(opened, ["Machine.ts"])

        const unavailable = yield* ViewerClient.make({ transport: pair.viewer })
        assert.strictEqual(
          (yield* Effect.flip(unavailable.openEditor({ file: "Machine.ts", line: 1, column: 1 })))
            .message,
          "No source opener is configured.",
        )
      }),
    ),
  )
})
