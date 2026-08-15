import { Protocol } from "@effect-state-machine/studio-client"
import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"

/**
 * The hub between applications and viewers: tracks announced sessions, retains
 * bounded per-session history, replays it to late viewers, and routes
 * dispatches to the owning application connection with honest failures.
 */

export interface Options {
  /** Facts retained per session; older facts fold into a truncation marker. */
  readonly historyLimit?: number
}

type Send = (message: Protocol.Message) => Effect.Effect<void>

export interface AppPeer {
  readonly receive: (message: Protocol.Message) => Effect.Effect<void>
}

export interface ViewerPeer {
  /** Replayed history followed by live messages; ends when unregistered. */
  readonly messages: Queue.Dequeue<Protocol.Message, Cause.Done>
  readonly receive: (message: Protocol.Message) => Effect.Effect<void>
}

interface SessionEntry {
  readonly hello: Protocol.HelloMessage
  readonly facts: ReadonlyArray<Protocol.FactMessage>
  readonly lastSequence: number
  readonly status: "connected" | "disconnected" | "ended"
  readonly appSend: Send | undefined
}

export class Relay extends Context.Service<
  Relay,
  Readonly<{
    /** Registers an application connection for the lifetime of the Scope. */
    app: (send: Send) => Effect.Effect<AppPeer, never, Scope.Scope>
    /** Registers a viewer for the lifetime of the Scope, replaying history. */
    viewer: Effect.Effect<ViewerPeer, never, Scope.Scope>
  }>
>()("@effect-state-machine/studio/Relay") {}

const make = (options?: Options) =>
  Effect.gen(function* () {
    const historyLimit = options?.historyLimit ?? 10_000
    // All registry access runs under one permit; the maps are never touched
    // outside it, so plain mutation stays contained to this module.
    const mutex = yield* Semaphore.make(1)
    const sessions = new Map<string, SessionEntry>()
    const viewers = new Map<number, Queue.Queue<Protocol.Message, Cause.Done>>()
    let nextViewerId = 0

    const broadcast = (message: Protocol.Message) =>
      Effect.forEach(viewers.values(), (queue) => Queue.offer(queue, message), {
        discard: true,
      })

    const endedMessageFor = (entry: SessionEntry): Protocol.Message | undefined =>
      entry.status === "ended"
        ? { _tag: "SessionEnded", sessionId: entry.hello.sessionId }
        : entry.status === "disconnected"
          ? { _tag: "SessionDisconnected", sessionId: entry.hello.sessionId }
          : undefined

    const receiveFromApp = (appSend: Send) => (message: Protocol.Message) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          switch (message._tag) {
            case "Hello": {
              if (message.protocolVersion !== Protocol.VERSION) {
                yield* appSend({
                  _tag: "SessionRejected",
                  sessionId: message.sessionId,
                  supportedVersion: Protocol.VERSION,
                  announcedVersion: message.protocolVersion,
                  message: `Studio supports protocol version ${Protocol.VERSION}, the application announced ${message.protocolVersion}.`,
                })
                return
              }
              if (message.instanceKey !== undefined) {
                for (const [staleId, stale] of sessions) {
                  if (
                    staleId === message.sessionId ||
                    stale.hello.instanceKey !== message.instanceKey ||
                    stale.status === "connected"
                  ) {
                    continue
                  }
                  sessions.delete(staleId)
                  yield* broadcast({ _tag: "SessionRemoved", sessionId: staleId })
                }
              }
              const existing = sessions.get(message.sessionId)
              sessions.set(message.sessionId, {
                hello: message,
                facts: existing?.facts ?? [],
                lastSequence: existing?.lastSequence ?? -1,
                status: "connected",
                appSend,
              })
              yield* broadcast(message)
              return
            }
            case "Fact": {
              const entry = sessions.get(message.sessionId)
              if (entry === undefined || message.sequence <= entry.lastSequence) return
              const appended = [...entry.facts, message]
              sessions.set(message.sessionId, {
                ...entry,
                facts:
                  appended.length > historyLimit
                    ? Protocol.truncateOldest(message.sessionId, appended)
                    : appended,
                lastSequence: message.sequence,
              })
              yield* broadcast(message)
              return
            }
            case "DispatchOutcome":
              yield* broadcast(message)
              return
            case "SessionEnded": {
              const entry = sessions.get(message.sessionId)
              if (entry === undefined) return
              sessions.set(message.sessionId, { ...entry, status: "ended", appSend: undefined })
              yield* broadcast(message)
              return
            }
            default:
              return
          }
        }),
      )

    const app = (send: Send) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              for (const [sessionId, entry] of sessions) {
                if (entry.appSend !== send || entry.status !== "connected") continue
                sessions.set(sessionId, { ...entry, status: "disconnected", appSend: undefined })
                yield* broadcast({ _tag: "SessionDisconnected", sessionId })
              }
            }),
          ),
        )
        const peer: AppPeer = { receive: receiveFromApp(send) }
        return peer
      })

    const viewer = Effect.gen(function* () {
      const queue = yield* Queue.unbounded<Protocol.Message, Cause.Done>()
      const viewerId = nextViewerId
      nextViewerId += 1
      yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          for (const entry of sessions.values()) {
            yield* Queue.offer(queue, entry.hello)
            yield* Queue.offerAll(queue, entry.facts)
            const ended = endedMessageFor(entry)
            if (ended !== undefined) yield* Queue.offer(queue, ended)
          }
          viewers.set(viewerId, queue)
        }),
      )
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          viewers.delete(viewerId)
          yield* Queue.end(queue)
        }),
      )
      const receive = (message: Protocol.Message): Effect.Effect<void> => {
        if (message._tag === "RemoveSession") {
          return mutex.withPermits(1)(
            Effect.gen(function* () {
              const entry = sessions.get(message.sessionId)
              if (entry === undefined || entry.status === "connected") return
              sessions.delete(message.sessionId)
              yield* broadcast({ _tag: "SessionRemoved", sessionId: message.sessionId })
            }),
          )
        }
        if (message._tag !== "Dispatch") return Effect.void
        const rejectWith = (reason: Protocol.DispatchFailure) =>
          Queue.offer(queue, {
            _tag: "DispatchOutcome",
            sessionId: message.sessionId,
            actorId: message.actorId,
            correlationId: message.correlationId,
            result: { _tag: "Rejected", reason },
          }).pipe(Effect.asVoid)
        return mutex
          .withPermits(1)(Effect.sync(() => sessions.get(message.sessionId)))
          .pipe(
            Effect.flatMap((entry) => {
              if (entry === undefined) return rejectWith("not-found")
              if (entry.appSend === undefined) return rejectWith("disconnected")
              // Never hold the relay mutex across a socket write. The application may answer
              // immediately, and its outcome handler needs the same mutex to broadcast the reply.
              return entry.appSend(message)
            }),
          )
      }
      const peer: ViewerPeer = { messages: queue, receive }
      return peer
    })

    return { app, viewer }
  })

export const layer = (options?: Options): Layer.Layer<Relay> => Layer.effect(Relay, make(options))
