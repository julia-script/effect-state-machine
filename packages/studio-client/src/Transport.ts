import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import type * as Protocol from "./Protocol.js"

/**
 * The connection seam between an application and Studio. Everything above this
 * service (announcement, buffering, reconnection, dispatch handling) is
 * transport-independent; swapping WebSocket for an extension port or an
 * in-memory pair only replaces this implementation.
 */

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: "unavailable" | "closed" | "send-failed"
  readonly cause?: unknown
}> {}

export interface Connection {
  /** Delivers one message to the connected peer. */
  readonly send: (message: Protocol.Message) => Effect.Effect<void, TransportError>
  /** Inbound messages; ends (Done) or fails when the connection closes. */
  readonly messages: Queue.Dequeue<Protocol.Message, TransportError | Cause.Done>
}

export interface Transport {
  /**
   * Opens one connection, succeeding only once the peer is reachable. The
   * connection lives in the surrounding Scope.
   */
  readonly connect: Effect.Effect<Connection, TransportError, Scope.Scope>
}

export class StudioTransport extends Context.Service<StudioTransport, Transport>()(
  "@effect-state-machine/studio-client/StudioTransport",
) {}
