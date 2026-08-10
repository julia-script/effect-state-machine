import type * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Socket from "effect/unstable/socket/Socket"
import * as Protocol from "./Protocol.js"
import { type Connection, StudioTransport, type Transport, TransportError } from "./Transport.js"

/**
 * The default transport: dials the local Studio server over WebSocket using
 * the runtime's global WebSocket constructor (browsers and Node 22+).
 * Malformed inbound frames are dropped; a failed open surfaces as
 * `TransportError` so the attach loop can back off and retry.
 */

export const defaultUrl = `ws://127.0.0.1:${Protocol.DEFAULT_PORT}${Protocol.APP_PATH}`

export interface Options {
  readonly url?: string
}

export const make = (options?: Options): Transport => ({
  connect: Effect.gen(function* () {
    const socket = yield* Socket.makeWebSocket(options?.url ?? defaultUrl, {
      openTimeout: "3 seconds",
    }).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal))
    const inbound = yield* Queue.unbounded<Protocol.Message, TransportError | Cause.Done>()
    const opened = yield* Deferred.make<void, TransportError>()
    yield* socket
      .runString(
        (text) =>
          Protocol.decodeMessageString(text).pipe(
            Effect.flatMap((message) => Queue.offer(inbound, message)),
            Effect.catch(() => Effect.void),
          ),
        { onOpen: Deferred.succeed(opened, undefined) },
      )
      .pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            yield* Deferred.fail(opened, new TransportError({ reason: "unavailable", cause: exit }))
            yield* Queue.end(inbound)
          }),
        ),
        Effect.forkScoped,
      )
    yield* Deferred.await(opened)
    const write = yield* socket.writer
    const connection: Connection = {
      send: (message) =>
        Protocol.encodeMessageString(message).pipe(
          Effect.flatMap(write),
          Effect.mapError((cause) => new TransportError({ reason: "send-failed", cause })),
        ),
      messages: inbound,
    }
    return connection
  }),
})

export const layer = (options?: Options): Layer.Layer<StudioTransport> =>
  Layer.succeed(StudioTransport, StudioTransport.of(make(options)))
