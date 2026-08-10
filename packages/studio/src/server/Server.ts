import { createServer } from "node:http"
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import { Protocol } from "@effect-state-machine/studio-client"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as HttpStaticServer from "effect/unstable/http/HttpStaticServer"
import type * as Socket from "effect/unstable/socket/Socket"
import * as EditorOpener from "./EditorOpener.js"
import * as Relay from "./Relay.js"

/**
 * The Studio HTTP server: WebSocket endpoints for applications and viewers,
 * an editor-open endpoint, and the built interface as static assets — all on
 * one localhost port. Binding 127.0.0.1 is the security boundary.
 */

export interface Options {
  readonly port?: number
  readonly host?: string
  readonly editor?: string
  readonly historyLimit?: number
  /** Directory containing the built interface; a placeholder page without it. */
  readonly uiRoot?: string
}

const socketSender = (write: (chunk: string) => Effect.Effect<void, Socket.SocketError>) => {
  return (message: Protocol.Message): Effect.Effect<void> =>
    Protocol.encodeMessageString(message).pipe(
      Effect.flatMap(write),
      Effect.catch(() => Effect.void),
    )
}

const appRoute = HttpRouter.add(
  "GET",
  Protocol.APP_PATH,
  Effect.gen(function* () {
    const relay = yield* Relay.Relay
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* request.upgrade
    const write = yield* socket.writer
    const peer = yield* relay.app(socketSender(write))
    yield* socket
      .runString((text) =>
        Protocol.decodeMessageString(text).pipe(
          Effect.flatMap(peer.receive),
          Effect.catch(() => Effect.void),
        ),
      )
      .pipe(Effect.catch(() => Effect.void))
    return HttpServerResponse.empty()
  }).pipe(Effect.scoped),
)

const viewerRoute = HttpRouter.add(
  "GET",
  Protocol.VIEWER_PATH,
  Effect.gen(function* () {
    const relay = yield* Relay.Relay
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* request.upgrade
    const write = yield* socket.writer
    const send = socketSender(write)
    const peer = yield* relay.viewer
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        while (true) {
          const message = yield* Queue.take(peer.messages)
          yield* send(message)
        }
      }).pipe(Effect.catch(() => Effect.void)),
    )
    yield* socket
      .runString((text) =>
        Protocol.decodeMessageString(text).pipe(
          Effect.flatMap(peer.receive),
          Effect.catch(() => Effect.void),
        ),
      )
      .pipe(Effect.catch(() => Effect.void))
    return HttpServerResponse.empty()
  }).pipe(Effect.scoped),
)

const OpenEditorBody = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
})

const editorRoute = HttpRouter.add(
  "POST",
  "/editor/open",
  Effect.gen(function* () {
    const opener = yield* EditorOpener.EditorOpener
    const body = yield* HttpServerRequest.schemaBodyJson(OpenEditorBody).pipe(
      Effect.mapError(() => new EditorOpener.EditorOpenError({ message: "invalid body" })),
    )
    return yield* opener.open(body).pipe(
      Effect.as(HttpServerResponse.jsonUnsafe({ ok: true })),
      Effect.catchTag("EditorOpenError", (error) =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: false, message: error.message })),
      ),
    )
  }).pipe(
    Effect.catchTag("EditorOpenError", (error) =>
      Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: false, message: error.message })),
    ),
  ),
)

const placeholder = HttpServerResponse.html(
  `<!doctype html><meta charset="utf-8"><title>Studio</title>` +
    `<body style="font-family: system-ui; padding: 3rem"><h1>Studio</h1>` +
    `<p>The interface build was not found. Applications can still connect on <code>${Protocol.APP_PATH}</code>.</p>`,
)

const uiRoutes = (uiRoot: string | undefined) =>
  uiRoot === undefined
    ? HttpRouter.add("GET", "/", placeholder)
    : HttpRouter.use((router) =>
        Effect.gen(function* () {
          const staticApp = yield* HttpStaticServer.make({ root: uiRoot, spa: true })
          yield* router.add("GET", "/*", staticApp)
          yield* router.add("GET", "/", staticApp)
        }),
      )

export const layer = (options?: Options) => {
  const routes = Layer.mergeAll(appRoute, viewerRoute, editorRoute, uiRoutes(options?.uiRoot))
  return HttpRouter.serve(routes, { disableLogger: true }).pipe(
    Layer.provide(Relay.layer({ historyLimit: options?.historyLimit ?? 10_000 })),
    Layer.provide(EditorOpener.layer(options?.editor)),
    Layer.provide(NodeChildProcessSpawner.layer),
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        port: options?.port ?? Protocol.DEFAULT_PORT,
        host: options?.host ?? "127.0.0.1",
      }),
    ),
  )
}
