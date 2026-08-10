import type * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import type * as Protocol from "./Protocol.js"
import { type Connection, type Transport, TransportError } from "./Transport.js"

/**
 * Studio-side controls and observations for an in-memory transport pair.
 *
 * @category testing
 * @since 0.1.0
 */
export interface StudioDouble {
  /**
   * Every message the client has sent, in order.
   */
  readonly received: Queue.Dequeue<Protocol.Message>
  /**
   * Sends a message to the currently connected client.
   */
  readonly send: (message: Protocol.Message) => Effect.Effect<void>
  /**
   * Controls reachability; going offline also drops the live connection.
   */
  readonly setOnline: (online: boolean) => Effect.Effect<void>
  /**
   * Drops the live connection without going offline.
   */
  readonly dropConnection: Effect.Effect<void>
  /**
   * Number of connections established so far.
   */
  readonly connectionCount: Effect.Effect<number>
}

/**
 * Connected client transport and Studio test double created together.
 *
 * @category testing
 * @since 0.1.0
 */
export interface Pair {
  readonly transport: Transport
  readonly studio: StudioDouble
}

/**
 * Creates a scoped in-memory transport pair for deterministic tests.
 *
 * **Details**
 *
 * The client side implements {@link Transport}; the Studio side observes outbound messages, sends
 * inbound messages, toggles availability, and drops connections. Opening a new connection closes
 * the previous one.
 *
 * @category testing
 * @since 0.1.0
 */
export const make: Effect.Effect<Pair> = Effect.gen(function* () {
  const received = yield* Queue.unbounded<Protocol.Message>()
  const online = yield* Ref.make(true)
  const connections = yield* Ref.make(0)
  const current = yield* Ref.make<
    Queue.Queue<Protocol.Message, TransportError | Cause.Done> | undefined
  >(undefined)

  const closeCurrent = Effect.gen(function* () {
    const inbound = yield* Ref.get(current)
    if (inbound === undefined) return
    yield* Ref.set(current, undefined)
    yield* Queue.end(inbound)
  })

  const connect: Transport["connect"] = Effect.gen(function* () {
    if (!(yield* Ref.get(online))) {
      return yield* new TransportError({ reason: "unavailable" })
    }
    yield* closeCurrent
    const inbound = yield* Queue.unbounded<Protocol.Message, TransportError | Cause.Done>()
    yield* Ref.set(current, inbound)
    yield* Ref.update(connections, (count) => count + 1)
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const active = yield* Ref.get(current)
        if (active === inbound) yield* Ref.set(current, undefined)
        yield* Queue.end(inbound)
      }),
    )
    const connection: Connection = {
      send: (message) =>
        Effect.gen(function* () {
          const active = yield* Ref.get(current)
          if (active !== inbound) {
            return yield* new TransportError({ reason: "closed" })
          }
          yield* Queue.offer(received, message)
        }),
      messages: inbound,
    }
    return connection
  })

  const studio: StudioDouble = {
    received,
    send: (message) =>
      Effect.gen(function* () {
        const inbound = yield* Ref.get(current)
        if (inbound !== undefined) yield* Queue.offer(inbound, message)
      }),
    setOnline: (value) =>
      Effect.gen(function* () {
        yield* Ref.set(online, value)
        if (!value) yield* closeCurrent
      }),
    dropConnection: closeCurrent,
    connectionCount: Ref.get(connections),
  }

  return { transport: { connect }, studio }
})
