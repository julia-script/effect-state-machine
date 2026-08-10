import {
  History,
  type Protocol,
  type Transport,
  WebSocketTransport,
} from "@effect-state-machine/studio-client"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import type * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"

/**
 * The browser side of the wire: keeps one auto-reconnecting viewer connection,
 * folds replayed and live facts into per-session history models, correlates
 * dispatch outcomes, and calls the server's editor-open endpoint.
 */

export type SessionConnection = "connected" | "disconnected" | "ended"

export interface SessionView {
  readonly sessionId: string
  readonly hello: Protocol.HelloMessage
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
>()("@effect-state-machine/studio/ViewerClient") {}

const upsertSession = (world: World, message: Protocol.HelloMessage): World => {
  const existing = world.sessions.find((session) => session.sessionId === message.sessionId)
  const next: SessionView = {
    sessionId: message.sessionId,
    hello: message,
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

export const make = (options?: { readonly viewerUrl?: string }) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient
    const url =
      options?.viewerUrl ??
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/viewer`
    const transport = WebSocketTransport.make({ url })
    const worldRef = yield* SubscriptionRef.make<World>(emptyWorld)
    const activeConnection = yield* Ref.make<Transport.Connection | undefined>(undefined)
    const pending = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<DispatchResult>>>(
      new Map(),
    )

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
          yield* Effect.sleep("1 second")
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

    const openEditor = (location: { file: string; line: number; column: number }) =>
      httpClient.post("/editor/open", { body: HttpBody.jsonUnsafe(location) }).pipe(
        Effect.flatMap((response) => response.json),
        Effect.mapError((cause) => new EditorOpenFailed({ message: String(cause) })),
        Effect.flatMap((result) => {
          const outcome = result as { ok?: boolean; message?: string }
          return outcome.ok === true
            ? Effect.void
            : Effect.fail(
                new EditorOpenFailed({ message: outcome.message ?? "editor failed to open" }),
              )
        }),
      )

    return {
      world: SubscriptionRef.changes(worldRef),
      dispatch,
      openEditor,
    }
  })

export const layer = (options?: { readonly viewerUrl?: string }): Layer.Layer<ViewerClient> =>
  Layer.effect(ViewerClient, make(options)).pipe(Layer.provide(FetchHttpClient.layer))
