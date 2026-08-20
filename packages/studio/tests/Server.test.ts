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
import * as Machine from "effect-state-machine/Machine"
import * as MachineEngine from "effect-state-machine/MachineEngine"
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
const definition = runner.define(
  {
    id: "server-test",
    idempotencyKey: () => "server",
    initial: () => ({ _tag: "Idle" }),
  },
  {
    Idle: runner.state({
      Start: {
        target: "Running",
        reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
      },
    }),
    Running: runner.state({
      Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) },
    }),
    Done: runner.final(),
  },
)

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

const rawHello = (sessionId: string, instanceKey?: string): Protocol.Message => ({
  _tag: "Hello",
  protocolVersion: Protocol.VERSION,
  sessionId,
  ...(instanceKey === undefined ? {} : { instanceKey }),
  rootActorId: "actor:0",
  app: { name: "raw", runtime: "node" },
  machine: { id: "raw-machine" },
  graph: { id: "raw-machine", nodes: [], edges: [], ignores: [] },
  jsonSchemas: { states: {}, events: {} },
  quickEvents: [],
  definitions: [
    {
      definitionPath: "root",
      machine: { id: "raw-machine" },
      graph: { id: "raw-machine", nodes: [], edges: [], ignores: [] },
      jsonSchemas: { states: {}, events: {} },
      quickEvents: [],
      children: [],
    },
  ],
})

/** Session ids of every Hello replayed before (and including) the sentinel session. */
const hellosUntil = (
  messages: Transport.Connection["messages"],
  sentinelSessionId: string,
): Effect.Effect<ReadonlyArray<string>, unknown> =>
  Effect.gen(function* () {
    const seen: Array<string> = []
    while (true) {
      const message = yield* Queue.take(messages)
      if (message._tag !== "Hello") continue
      seen.push(message.sessionId)
      if (message.sessionId === sentinelSessionId) return seen
    }
  })

describe("Server", () => {
  it.live("reruns supersede their stale predecessor only", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl, viewerUrl } = yield* startServer
        const viewer = yield* connectViewer(viewerUrl)

        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* WebSocketTransport.make({ url: appUrl }).connect
            yield* connection.send(rawHello("run-1", "raw:raw-machine"))
            yield* Effect.sleep("150 millis")
          }),
        )
        yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "SessionDisconnected" && message.sessionId === "run-1",
        )

        // The rerun evicts the disconnected predecessor before announcing.
        const second = yield* WebSocketTransport.make({ url: appUrl }).connect
        yield* second.send(rawHello("run-2", "raw:raw-machine"))
        yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "SessionRemoved" && message.sessionId === "run-1",
        )
        yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "Hello" && message.sessionId === "run-2",
        )

        // A second live instance with the same key never evicts a connected session.
        const third = yield* WebSocketTransport.make({ url: appUrl }).connect
        yield* third.send(rawHello("run-3", "raw:raw-machine"))
        yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "Hello" && message.sessionId === "run-3",
        )

        const late = yield* connectViewer(viewerUrl)
        const replayed = yield* hellosUntil(late.messages, "run-3")
        assert.deepStrictEqual(replayed, ["run-2", "run-3"])
      }),
    ),
  )

  it.live("viewer removal only touches non-live sessions", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl, viewerUrl } = yield* startServer
        const viewer = yield* connectViewer(viewerUrl)

        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* WebSocketTransport.make({ url: appUrl }).connect
            yield* connection.send(rawHello("live-1"))
            yield* takeUntil(
              viewer.messages,
              (message) => message._tag === "Hello" && message.sessionId === "live-1",
            )

            // Removal of a connected session is ignored.
            yield* viewer.send({ _tag: "RemoveSession", sessionId: "live-1" })
            yield* Effect.sleep("150 millis")
            const early = yield* connectViewer(viewerUrl)
            const replayed = yield* hellosUntil(early.messages, "live-1")
            assert.deepStrictEqual(replayed, ["live-1"])
          }),
        )
        yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "SessionDisconnected" && message.sessionId === "live-1",
        )

        // Once disconnected, removal is honored and broadcast.
        yield* viewer.send({ _tag: "RemoveSession", sessionId: "live-1" })
        yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "SessionRemoved" && message.sessionId === "live-1",
        )

        // A late viewer never sees the removed session; a sentinel proves replay ran.
        const sentinel = yield* WebSocketTransport.make({ url: appUrl }).connect
        yield* sentinel.send(rawHello("sentinel"))
        yield* Effect.sleep("150 millis")
        const late = yield* connectViewer(viewerUrl)
        const replayed = yield* hellosUntil(late.messages, "sentinel")
        assert.deepStrictEqual(replayed, ["sentinel"])
      }),
    ),
  )

  it.live("replays two sessions to a late viewer and relays live facts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { appUrl, viewerUrl } = yield* startServer

        const handleA = yield* definition.run({}).pipe(Effect.provide(MachineEngine.layerMemory()))
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

        const handleB = yield* definition.run({}).pipe(Effect.provide(MachineEngine.layerMemory()))
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
          actorId: handleA.actorId,
          correlationId: "v-1",
          command: { _tag: "Custom", event: { _tag: "Stop" } },
        })
        const outcome = yield* takeUntil(
          viewer.messages,
          (message) => message._tag === "DispatchOutcome" && message.correlationId === "v-1",
        )
        assert.ok(outcome._tag === "DispatchOutcome" && outcome.result._tag === "Accepted")
        if (outcome._tag === "DispatchOutcome") {
          assert.strictEqual(outcome.actorId, handleA.actorId)
        }
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
          rootActorId: "actor:0",
          app: { name: "crasher", runtime: "node" },
          machine: { id: "crash-machine" },
          graph: { id: "crash-machine", nodes: [], edges: [], ignores: [] },
          jsonSchemas: { states: {}, events: {} },
          quickEvents: [],
          definitions: [
            {
              definitionPath: "root",
              machine: { id: "crash-machine" },
              graph: { id: "crash-machine", nodes: [], edges: [], ignores: [] },
              jsonSchemas: { states: {}, events: {} },
              quickEvents: [],
              children: [],
            },
          ],
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
          actorId: "actor:0",
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
          rootActorId: "actor:0",
          app: { name: "future", runtime: "node" },
          machine: { id: "future-machine" },
          graph: { id: "future-machine", nodes: [], edges: [], ignores: [] },
          jsonSchemas: { states: {}, events: {} },
          quickEvents: [],
          definitions: [
            {
              definitionPath: "root",
              machine: { id: "future-machine" },
              graph: { id: "future-machine", nodes: [], edges: [], ignores: [] },
              jsonSchemas: { states: {}, events: {} },
              quickEvents: [],
              children: [],
            },
          ],
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
        const handle = yield* definition.run({}).pipe(Effect.provide(MachineEngine.layerMemory()))
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
