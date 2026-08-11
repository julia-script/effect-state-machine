import { createServer } from "node:http"
import { NodeHttpServer } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as HttpServer from "effect/unstable/http/HttpServer"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import { Machine } from "effect-state-machine"
import * as Attach from "../src/Attach.js"
import * as Protocol from "../src/Protocol.js"
import { StudioTransport } from "../src/Transport.js"
import * as WebSocketTransport from "../src/WebSocketTransport.js"
import { definition } from "./fixtures/Runner.js"

describe("WebSocketTransport", () => {
  it.live("announces and round-trips dispatches over a real socket", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const received = yield* Queue.unbounded<Protocol.Message>()
        const sends: Array<(message: Protocol.Message) => Effect.Effect<void>> = []

        const handler = Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const socket = yield* request.upgrade
          const write = yield* socket.writer
          sends.push((message) =>
            Protocol.encodeMessageString(message).pipe(
              Effect.flatMap(write),
              Effect.catch(() => Effect.void),
            ),
          )
          yield* socket.runString((text) =>
            Protocol.decodeMessageString(text).pipe(
              Effect.flatMap((message) => Queue.offer(received, message)),
              Effect.catch(() => Effect.void),
            ),
          )
          return HttpServerResponse.empty()
        }).pipe(Effect.scoped)

        const services = yield* Layer.build(
          HttpServer.serve()(handler).pipe(
            Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })),
          ),
        )
        const server = Context.get(services, HttpServer.HttpServer)
        assert.strictEqual(server.address._tag, "TcpAddress")
        if (server.address._tag !== "TcpAddress") return
        const url = `ws://127.0.0.1:${server.address.port}/app`

        const handle = yield* Machine.run(definition, {})
        yield* Attach.attach({
          definition,
          handle,
          quickEvents: [{ id: "start", label: "Start", event: { _tag: "Start", speed: 4 } }],
          reconnectInterval: "50 millis",
        }).pipe(Effect.provideService(StudioTransport, WebSocketTransport.make({ url })))

        const takeUntil = (predicate: (message: Protocol.Message) => boolean) =>
          Effect.gen(function* () {
            for (let index = 0; index < 100; index += 1) {
              const message = yield* Queue.take(received)
              if (predicate(message)) return message
            }
            return yield* Effect.die(new Error("expected message did not arrive"))
          })

        const hello = yield* takeUntil((message) => message._tag === "Hello")
        assert.strictEqual(hello._tag, "Hello")
        if (hello._tag !== "Hello") return
        assert.strictEqual(hello.machine.id, "runner")

        const commit = yield* takeUntil(
          (message) => message._tag === "Fact" && message.body._tag === "StateCommitted",
        )
        assert.strictEqual(commit._tag, "Fact")

        const send = sends[sends.length - 1]
        assert.ok(send !== undefined)
        yield* send({
          _tag: "Dispatch",
          sessionId: hello.sessionId,
          actorId: hello.rootActorId,
          correlationId: "ws-1",
          command: { _tag: "Quick", id: "start" },
        })
        const outcome = yield* takeUntil(
          (message) => message._tag === "DispatchOutcome" && message.correlationId === "ws-1",
        )
        assert.ok(outcome._tag === "DispatchOutcome" && outcome.result._tag === "Accepted")

        const running = yield* takeUntil(
          (message) =>
            message._tag === "Fact" &&
            message.body._tag === "StateCommitted" &&
            typeof message.body.state === "object" &&
            message.body.state !== null &&
            (message.body.state as { _tag?: string })._tag === "Running",
        )
        assert.strictEqual(running._tag, "Fact")
      }),
    ),
  )
})
