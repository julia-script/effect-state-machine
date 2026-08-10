import { assert, describe, it } from "@effect/vitest"
import {
  Attach,
  Protocol,
  Transport,
  WebSocketTransport,
} from "@effect-state-machine/studio-client"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as HttpServer from "effect/unstable/http/HttpServer"
import { Machine } from "effect-state-machine"
import * as Server from "../src/server/Server.js"

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {} },
  Running: { fields: { speed: Schema.Number } },
  Done: { fields: {} },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number } },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: Input, state: State, event: Event })
const definition = runner.make({
  id: "server-test",
  initial: () => ({ _tag: "Idle" }),
  nodes: [
    runner.state("Idle", {
      on: {
        Start: {
          target: "Running",
          reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
        },
      },
    }),
    runner.state("Running", {
      on: { Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) } },
    }),
    runner.final("Done"),
  ],
})

const startServer = Effect.gen(function* () {
  const services = yield* Layer.build(Server.layer({ port: 0 }))
  const server = Context.get(services, HttpServer.HttpServer)
  if (server.address._tag !== "TcpAddress") {
    return yield* Effect.die(new Error("expected a TCP address"))
  }
  const base = `ws://127.0.0.1:${server.address.port}`
  return {
    appUrl: `${base}${Protocol.APP_PATH}`,
    viewerUrl: `${base}${Protocol.VIEWER_PATH}`,
  }
})

const connectViewer = (viewerUrl: string) => WebSocketTransport.make({ url: viewerUrl }).connect

const takeUntil = (
  messages: Transport.Connection["messages"],
  predicate: (message: Protocol.Message) => boolean,
  limit = 200,
): Effect.Effect<Protocol.Message, unknown> =>
  Effect.gen(function* () {
    for (let index = 0; index < limit; index += 1) {
      const message = yield* Queue.take(messages)
      if (predicate(message)) return message
    }
    return yield* Effect.die(new Error("expected message did not arrive"))
  })

describe("Server", () => {
  it.live("replays two sessions to a late viewer and relays live facts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl, viewerUrl } = yield* startServer

        const handleA = yield* Machine.run(definition, {})
        const attachedA = yield* Attach.attach({
          definition,
          handle: handleA,
          appName: "app-a",
        }).pipe(
          Effect.provideService(
            Transport.StudioTransport,
            WebSocketTransport.make({ url: appUrl }),
          ),
        )
        yield* handleA.send({ _tag: "Start", speed: 7 })

        const handleB = yield* Machine.run(definition, {})
        yield* Attach.attach({ definition, handle: handleB, appName: "app-b" }).pipe(
          Effect.provideService(
            Transport.StudioTransport,
            WebSocketTransport.make({ url: appUrl }),
          ),
        )

        // Give the facts time to reach the server before the viewer connects.
        yield* Effect.sleep("300 millis")

        const viewer = yield* connectViewer(viewerUrl)
        const helloA = yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "Hello" && message.app.name === "app-a",
        )
        assert.strictEqual(helloA._tag, "Hello")
        const runningCommit = yield* takeUntil(
          viewer.messages,
          (message) =>
            message._tag === "Fact" &&
            message.sessionId === attachedA.sessionId &&
            message.body._tag === "StateCommitted" &&
            (message.body.state as { _tag?: string })._tag === "Running",
        )
        assert.strictEqual(runningCommit._tag, "Fact")
        const helloB = yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "Hello" && message.app.name === "app-b",
        )
        assert.strictEqual(helloB._tag, "Hello")

        // Live relay after replay.
        yield* handleB.send({ _tag: "Start", speed: 1 })
        const liveFact = yield* takeUntil(
          viewer.messages,
          (message) =>
            message._tag === "Fact" &&
            helloB._tag === "Hello" &&
            message.sessionId === helloB.sessionId &&
            message.body._tag === "StateCommitted" &&
            (message.body.state as { _tag?: string })._tag === "Running",
        )
        assert.strictEqual(liveFact._tag, "Fact")

        // Dispatch through the server round-trips to the app.
        yield* viewer.send({
          _tag: "Dispatch",
          sessionId: attachedA.sessionId,
          correlationId: "v-1",
          command: { _tag: "Custom", event: { _tag: "Stop" } },
        })
        const outcome = yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "DispatchOutcome" && message.correlationId === "v-1",
        )
        assert.ok(outcome._tag === "DispatchOutcome" && outcome.result._tag === "Accepted")
        assert.deepStrictEqual(yield* handleA.completion, { _tag: "Done" })
      }),
    ),
  )

  it.live("fails dispatches to disconnected sessions fast and marks them", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl, viewerUrl } = yield* startServer

        const viewer = yield* connectViewer(viewerUrl)

        // A raw app connection that announces and then drops without SessionEnded.
        const hello: Protocol.Message = {
          _tag: "Hello",
          protocolVersion: Protocol.VERSION,
          sessionId: "crashing-session",
          app: { name: "crasher", runtime: "node" },
          machine: { id: "crash-machine" },
          graph: { id: "crash-machine", nodes: [], edges: [], ignores: [] },
          jsonSchemas: { states: {}, events: {} },
          quickEvents: [],
        }
        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* WebSocketTransport.make({ url: appUrl }).connect
            yield* connection.send(hello)
            yield* Effect.sleep("150 millis")
          }),
        )

        yield* takeUntil(
          viewer.messages,
          (message) =>
            message._tag === "SessionDisconnected" && message.sessionId === "crashing-session",
        )

        yield* viewer.send({
          _tag: "Dispatch",
          sessionId: "crashing-session",
          correlationId: "v-dead",
          command: { _tag: "Quick", id: "anything" },
        })
        const outcome = yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "DispatchOutcome" && message.correlationId === "v-dead",
        )
        assert.ok(outcome._tag === "DispatchOutcome" && outcome.result._tag === "Rejected")
        if (outcome._tag === "DispatchOutcome" && outcome.result._tag === "Rejected") {
          assert.strictEqual(outcome.result.reason, "disconnected")
        }
      }),
    ),
  )

  it.live("rejects only the session announcing an unsupported version", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl } = yield* startServer
        const connection = yield* WebSocketTransport.make({ url: appUrl }).connect
        yield* connection.send({
          _tag: "Hello",
          protocolVersion: 999,
          sessionId: "future-session",
          app: { name: "future", runtime: "node" },
          machine: { id: "future-machine" },
          graph: { id: "future-machine", nodes: [], edges: [], ignores: [] },
          jsonSchemas: { states: {}, events: {} },
          quickEvents: [],
        })
        const rejection = yield* takeUntil(
          connection.messages,
          (message) => message._tag === "SessionRejected",
        )
        assert.ok(rejection._tag === "SessionRejected")
        if (rejection._tag === "SessionRejected") {
          assert.strictEqual(rejection.sessionId, "future-session")
          assert.strictEqual(rejection.supportedVersion, Protocol.VERSION)
        }

        // The same connection can still announce a supported session.
        const handle = yield* Machine.run(definition, {})
        yield* Attach.attach({ definition, handle, appName: "healthy" }).pipe(
          Effect.provideService(
            Transport.StudioTransport,
            WebSocketTransport.make({ url: appUrl }),
          ),
        )
        yield* Effect.sleep("150 millis")
        const viewerUrl = appUrl.replace(Protocol.APP_PATH, Protocol.VIEWER_PATH)
        const viewer = yield* connectViewer(viewerUrl)
        const healthy = yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "Hello" && message.app.name === "healthy",
        )
        assert.strictEqual(healthy._tag, "Hello")
      }),
    ),
  )
})
