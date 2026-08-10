import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import type * as Protocol from "./Protocol.js"

/**
 * Typed failure reported by a Studio transport boundary.
 *
 * @category errors
 * @since 0.1.0
 */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: "unavailable" | "closed" | "send-failed"
  readonly cause?: unknown
}> {}

/**
 * One scoped, bidirectional connection to a Studio peer.
 *
 * @category models
 * @since 0.1.0
 */
export interface Connection {
  /**
   * Delivers one message to the connected peer.
   */
  readonly send: (message: Protocol.Message) => Effect.Effect<void, TransportError>
  /**
   * Inbound messages; ends or fails when the connection closes.
   */
  readonly messages: Queue.Dequeue<Protocol.Message, TransportError | Cause.Done>
}

/**
 * Transport-independent connection seam between an application and Studio.
 *
 * **Details**
 *
 * Announcement, buffering, reconnection, and dispatch handling live above this interface, so a
 * WebSocket, extension port, or in-memory test double only needs to implement `connect`.
 *
 * @category protocols
 * @since 0.1.0
 */
export interface Transport {
  /**
   * Opens one connection after the peer is reachable; the connection lives in the surrounding
   * Scope.
   */
  readonly connect: Effect.Effect<Connection, TransportError, Scope.Scope>
}

/**
 * Effect Context service that supplies the active Studio {@link Transport}.
 *
 * @category services
 * @since 0.1.0
 */
export class StudioTransport extends Context.Service<StudioTransport, Transport>()(
  "@effect-state-machine/studio-client/StudioTransport",
) {}
