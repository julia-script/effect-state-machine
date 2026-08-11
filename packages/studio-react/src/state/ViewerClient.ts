import { History, type Protocol, Transport } from "@effect-state-machine/studio-client"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import type * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { type ComposedGraph, composeDefinitions } from "../lib/composedGraph.js"

/**
 * The browser side of the wire: keeps one auto-reconnecting viewer connection,
 * folds replayed and live facts into per-session history models, correlates
 * dispatch outcomes, and delegates source opening to its host.
 */

export type SessionConnection = "connected" | "disconnected" | "ended"

export interface SessionView {
  readonly sessionId: string
  readonly hello: Protocol.HelloMessage
  readonly composed: ComposedGraph
  readonly history: History.Model
  readonly connection: SessionConnection
}

export interface World {
  readonly connected: boolean
  readonly sessions: ReadonlyArray<SessionView>
}

export const emptyWorld: World = { connected: false, sessions: [] }

export class DispatchUnavailable extends Data.TaggedError("DispatchUnavailable")<{
  readonly reason: "offline" | "timeout"
}> {}

export class EditorOpenFailed extends Data.TaggedError("EditorOpenFailed")<{
  readonly message: string
}> {}

export interface DispatchInput {
  readonly sessionId: string
  readonly actorId: string
  readonly command: Protocol.DispatchMessage["command"]
}

export type DispatchResult = Protocol.DispatchOutcomeMessage["result"]

export class ViewerClient extends Context.Service<
  ViewerClient,
  Readonly<{
    /** Replays the current world immediately, then every change. */
    world: Stream.Stream<World>
    dispatch: (input: DispatchInput) => Effect.Effect<DispatchResult, DispatchUnavailable>
    openEditor: (location: {
      readonly file: string
      readonly line: number
      readonly column: number
    }) => Effect.Effect<void, EditorOpenFailed>
  }>
>()("@effect-state-machine/studio-react/ViewerClient") {}

export interface Options {
  readonly transport: Transport.Transport
  readonly openSource?: (location: {
    readonly file: string
    readonly line: number
    readonly column: number
  }) => Effect.Effect<void, EditorOpenFailed>
  readonly reconnectInterval?: import("effect/Duration").Input
}

const upsertSession = (world: World, message: Protocol.HelloMessage): World => {
  const existing = world.sessions.find((session) => session.sessionId === message.sessionId)
  const next: SessionView = {
    sessionId: message.sessionId,
    hello: message,
    composed: composeDefinitions(message.definitions),
    history: existing?.history ?? History.initial,
    connection: "connected",
  }
  return {
    ...world,
    sessions:
      existing === undefined
        ? [...world.sessions, next]
        : world.sessions.map((session) =>
            session.sessionId === message.sessionId ? next : session,
          ),
  }
}

const updateSession = (
  world: World,
  sessionId: string,
  update: (session: SessionView) => SessionView,
): World => ({
  ...world,
  sessions: world.sessions.map((session) =>
    session.sessionId === sessionId ? update(session) : session,
  ),
})

export const make = Effect.fnUntraced(function* (options: Options) {
  const transport = options.transport
  const worldRef = yield* SubscriptionRef.make<World>(emptyWorld)
  const activeConnection = yield* Ref.make<Transport.Connection | undefined>(undefined)
  const pending = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<DispatchResult>>>(new Map())

  const fold = (message: Protocol.Message) =>
    Effect.gen(function* () {
      switch (message._tag) {
        case "Hello":
          return yield* SubscriptionRef.update(worldRef, (world) => upsertSession(world, message))
        case "Fact":
          return yield* SubscriptionRef.update(worldRef, (world) =>
            updateSession(world, message.sessionId, (session) => ({
              ...session,
              history: History.reduce(session.history, message),
            })),
          )
        case "SessionDisconnected":
          return yield* SubscriptionRef.update(worldRef, (world) =>
            updateSession(world, message.sessionId, (session) => ({
              ...session,
              connection: "disconnected",
            })),
          )
        case "SessionEnded":
          return yield* SubscriptionRef.update(worldRef, (world) =>
            updateSession(world, message.sessionId, (session) => ({
              ...session,
              connection: "ended",
            })),
          )
        case "DispatchOutcome": {
          const waiting = (yield* Ref.get(pending)).get(message.correlationId)
          if (waiting !== undefined) yield* Deferred.succeed(waiting, message.result)
          return
        }
        default:
          return
      }
    })

  const runConnection = Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* transport.connect
      // A fresh connection replays the server's full history: start clean.
      yield* SubscriptionRef.set(worldRef, { connected: true, sessions: [] })
      yield* Ref.set(activeConnection, connection)
      while (true) {
        const message = yield* Queue.take(connection.messages)
        yield* fold(message)
      }
    }),
  ).pipe(
    Effect.ensuring(
      Ref.set(activeConnection, undefined).pipe(
        Effect.andThen(
          SubscriptionRef.update(worldRef, (world) => ({ ...world, connected: false })),
        ),
      ),
    ),
    Effect.catchCause(() => Effect.void),
  )

  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        yield* runConnection
        yield* Effect.sleep(options.reconnectInterval ?? "1 second")
      }
    }),
  )

  const dispatch = (input: DispatchInput) =>
    Effect.gen(function* () {
      const connection = yield* Ref.get(activeConnection)
      if (connection === undefined) {
        return yield* new DispatchUnavailable({ reason: "offline" })
      }
      const correlationId = crypto.randomUUID()
      const outcome = yield* Deferred.make<DispatchResult>()
      yield* Ref.update(pending, (map) => new Map(map).set(correlationId, outcome))
      yield* connection
        .send({
          _tag: "Dispatch",
          sessionId: input.sessionId,
          actorId: input.actorId,
          correlationId,
          command: input.command,
        })
        .pipe(Effect.mapError(() => new DispatchUnavailable({ reason: "offline" })))
      return yield* Deferred.await(outcome).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.fail(new DispatchUnavailable({ reason: "timeout" })),
        }),
        Effect.ensuring(
          Ref.update(pending, (map) => {
            const next = new Map(map)
            next.delete(correlationId)
            return next
          }),
        ),
      )
    })

  const openEditor =
    options.openSource ??
    (() => Effect.fail(new EditorOpenFailed({ message: "No source opener is configured." })))

  return {
    world: SubscriptionRef.changes(worldRef),
    dispatch,
    openEditor,
  }
})

const unavailableTransport: Transport.Transport = {
  connect: Effect.fail(new Transport.TransportError({ reason: "unavailable" })),
}

export const layer = (options?: Options): Layer.Layer<ViewerClient> =>
  Layer.effect(ViewerClient, make(options ?? { transport: unavailableTransport }))
