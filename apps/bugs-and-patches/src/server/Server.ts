import { createServer } from "node:http"
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as HttpStaticServer from "effect/unstable/http/HttpStaticServer"
import type * as Socket from "effect/unstable/socket/Socket"
import * as Protocol from "../protocol/Protocol.js"
import * as AgentMcp from "./AgentMcp.js"
import { Config, type ServerConfiguration } from "./Config.js"
import { apiLive, GitHubAuth, layer as githubAuthLayer } from "./GitHubAuth.js"
import * as Identity from "./Identity.js"
import * as Origin from "./Origin.js"
import * as Registry from "./Registry.js"
import { Session, layer as sessionLayer } from "./Session.js"
import { Storage, layer as storageLayer } from "./Storage.js"

export interface Options {
  readonly host?: string
  readonly port?: number
  readonly uiRoot?: string
}

const sendWith = (write: (text: string) => Effect.Effect<void, Socket.SocketError>) =>
  Effect.fn("Server.send")(function* (message: Protocol.ServerMessage) {
    yield* write(yield* Protocol.encodeServer(message))
  })

const jsonError = (status: number, code: string, message: string) =>
  HttpServerResponse.jsonUnsafe({ error: { code, message } }, { status })

const gameRoute = HttpRouter.add(
  "GET",
  Protocol.PATH,
  Effect.gen(function* () {
    const registry = yield* Registry.Registry
    const sessions = yield* Session
    const config = yield* Config
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!Origin.isAllowed(request.headers.origin, config.clientUrl))
      return jsonError(403, "OriginNotAllowed", "This client origin is not allowed.")
    const account = yield* sessions.authenticate(request.cookies[config.cookieName])
    if (account === undefined)
      return jsonError(401, "NotAuthenticated", "Sign in with GitHub before playing.")

    const socket = yield* request.upgrade
    const write = yield* socket.writer
    const send = (message: Protocol.ServerMessage) =>
      sendWith(write)(message).pipe(Effect.catch(() => Effect.void))
    let seat: Registry.Seat | undefined
    let queued = false

    const reject = (
      code: Protocol.RejectionCode,
      message: string,
      requestId: string | null = null,
    ) => send({ _tag: "Rejected", requestId, code, message, view: null })

    const authenticateConnection = Effect.fn("Server.authenticateConnection")(function* (
      next: Registry.Seat,
    ) {
      if (seat !== undefined) {
        yield* reject("NotAuthenticated", "This connection already owns a match seat.")
        return
      }
      seat = next
      queued = false
      yield* registry.subscribe(next, send)
    })

    const matched = Effect.fn("Server.matched")(function* (next: Registry.Seat) {
      yield* send({
        _tag: "Matched",
        matchId: next.matchId,
        seatToken: next.seatToken,
        playerId: next.playerId,
      })
      yield* authenticateConnection(next)
    })

    const receive = Effect.fn("Server.receive")(function* (text: string) {
      const decoded = yield* Protocol.decodeClient(text).pipe(Effect.option)
      if (decoded._tag === "None") {
        yield* reject("InvalidMessage", "Message did not match the protocol schema.")
        return
      }
      const message = decoded.value
      switch (message._tag) {
        case "CreateFriendly": {
          if (seat !== undefined || queued) {
            yield* reject("NotAuthenticated", "Leave the current match or queue first.")
            return
          }
          const created = yield* registry.createFriendly(account)
          if (created._tag === "Rejected") {
            yield* reject(created.code, created.message)
            return
          }
          yield* send({
            _tag: "FriendlyCreated",
            matchId: created.value.matchId,
            inviteCode: created.value.inviteCode,
            seatToken: created.value.seatToken,
            playerId: created.value.playerId,
          })
          yield* authenticateConnection(created.value)
          return
        }
        case "CreateAgentChallenge": {
          if (!config.agentChallengesEnabled) {
            yield* reject(
              "ChallengeUnavailable",
              "Agent challenges are not enabled on this server.",
            )
            return
          }
          if (seat !== undefined || queued) {
            yield* reject("NotAuthenticated", "Leave the current match or queue first.")
            return
          }
          const created = yield* registry.createAgentChallenge(account)
          if (created._tag === "Rejected") {
            yield* reject(created.code, created.message)
            return
          }
          yield* send({
            _tag: "AgentChallengeCreated",
            matchId: created.value.matchId,
            seatToken: created.value.seatToken,
            playerId: created.value.playerId,
            challenge: created.value.challenge,
          })
          yield* authenticateConnection(created.value)
          return
        }
        case "RevokeAgentChallenge": {
          const revoked = yield* registry.revokeAgentChallenge(account.id)
          if (revoked._tag === "Rejected") {
            yield* reject(revoked.code, revoked.message)
            return
          }
          yield* send({ _tag: "AgentChallengeUpdated", challenge: revoked.value })
          seat = undefined
          return
        }
        case "JoinFriendly": {
          if (seat !== undefined || queued) {
            yield* reject("NotAuthenticated", "Leave the current match or queue first.")
            return
          }
          const joined = yield* registry.joinFriendly(account, message.inviteCode)
          if (joined._tag === "Rejected") {
            yield* reject(joined.code, joined.message)
            return
          }
          yield* send({
            _tag: "Joined",
            matchId: joined.value.matchId,
            seatToken: joined.value.seatToken,
            playerId: joined.value.playerId,
          })
          yield* authenticateConnection(joined.value)
          return
        }
        case "JoinRankedQueue": {
          if (seat !== undefined) {
            yield* reject("NotAuthenticated", "This connection already owns a match seat.")
            return
          }
          const result = yield* registry.joinRanked(account, matched)
          if (result._tag === "Rejected") {
            yield* reject(result.code, result.message)
            return
          }
          if (result.value._tag === "Waiting") {
            queued = true
            yield* send({ _tag: "Waiting", queue: "Ranked" })
          } else {
            yield* matched(result.value.seat)
          }
          return
        }
        case "LeaveRankedQueue": {
          const result = yield* registry.leaveRanked(account.id)
          if (result._tag === "Rejected") {
            yield* reject(result.code, result.message)
            return
          }
          queued = false
          yield* send({ _tag: "LeftQueue", queue: "Ranked" })
          return
        }
        case "Reconnect": {
          if (seat !== undefined || queued) {
            yield* reject("NotAuthenticated", "Leave the current match or queue first.")
            return
          }
          const reconnected = yield* registry.reconnect(
            account.id,
            message.matchId,
            message.seatToken,
          )
          if (reconnected._tag === "Rejected") {
            yield* reject(reconnected.code, reconnected.message)
            return
          }
          yield* send({
            _tag: "Joined",
            matchId: reconnected.value.matchId,
            seatToken: reconnected.value.seatToken,
            playerId: reconnected.value.playerId,
          })
          const challenge = yield* registry.inspectAgentChallenge(account.id)
          if (challenge._tag === "Accepted") {
            yield* send({ _tag: "AgentChallengeUpdated", challenge: challenge.value })
          }
          yield* authenticateConnection(reconnected.value)
          return
        }
        case "Command": {
          if (seat === undefined) {
            yield* reject(
              "NotAuthenticated",
              "Join a match before sending commands.",
              message.requestId,
            )
            return
          }
          const result = yield* registry.command(seat, message.event)
          if (result._tag === "Rejected") {
            const current = yield* registry.view(seat)
            yield* send({
              _tag: "Rejected",
              requestId: message.requestId,
              code: result.code,
              message: result.message,
              view: current._tag === "Accepted" ? current.value : null,
            })
            return
          }
          yield* send({ _tag: "Acknowledged", requestId: message.requestId, view: result.value })
        }
      }
    })

    yield* socket.runString(receive).pipe(Effect.catch(() => Effect.void))
    if (queued) yield* registry.leaveRanked(account.id).pipe(Effect.asVoid)
    return HttpServerResponse.empty()
  }).pipe(
    Effect.catchTag("StorageError", () =>
      Effect.succeed(
        jsonError(503, "StorageUnavailable", "Authentication storage is unavailable."),
      ),
    ),
    Effect.scoped,
  ),
)

const unavailableChallenge = () =>
  HttpServerResponse.text(
    "<!doctype html><meta charset=utf-8><title>Challenge unavailable</title>" +
      "<main><h1>Challenge unavailable</h1><p>This challenge is unknown, expired, revoked, or complete.</p></main>",
    { status: 404, contentType: "text/html; charset=utf-8" },
  )

const challengeHandler = Effect.gen(function* () {
  const registry = yield* Registry.Registry
  const config = yield* Config
  const request = yield* HttpServerRequest.HttpServerRequest
  const params = yield* HttpRouter.params
  const capability = params.capability
  if (!config.agentChallengesEnabled || capability === undefined || capability.length > 256)
    return unavailableChallenge()

  const info = yield* registry.challengeInfo(capability)
  if (info._tag === "Rejected") return unavailableChallenge()
  const endpoint = `${config.challengeOrigin}/challenge/${capability}`
  const accept = request.headers.accept ?? ""

  if (request.method === "GET" && !accept.includes("text/event-stream")) {
    if (accept.includes("application/json")) {
      return HttpServerResponse.jsonUnsafe({
        game: "Bugs & Patches",
        mode: "Friendly",
        status: info.value.status,
        expiresAt: info.value.expiresAt,
        mcpEndpoint: endpoint,
        tools: ["accept_challenge", "get_match", "wait_for_turn", "take_action", "surrender"],
      })
    }
    if (accept.includes("text/markdown") || accept.includes("text/plain")) {
      return HttpServerResponse.text(AgentMcp.markdown(endpoint, info.value), {
        contentType: accept.includes("text/markdown") ? "text/markdown" : "text/plain",
      })
    }
    return HttpServerResponse.text(AgentMcp.html(info.value), {
      contentType: "text/html; charset=utf-8",
    })
  }

  const remoteAddress = Option.getOrElse(request.remoteAddress, () => "unknown")
  if (!AgentMcp.allowRequest(remoteAddress, capability, config.mcpRequestsPerMinute)) {
    return HttpServerResponse.setHeader(
      jsonError(429, "RateLimited", "Too many requests for this agent challenge."),
      "retry-after",
      "60",
    )
  }
  const contentLength = Number(request.headers["content-length"] ?? "0")
  if (Number.isFinite(contentLength) && contentLength > config.mcpMaxBodyBytes)
    return jsonError(413, "RequestTooLarge", "The MCP request body is too large.")

  const body = request.method === "POST" ? yield* request.text : undefined
  if (body !== undefined && new TextEncoder().encode(body).byteLength > config.mcpMaxBodyBytes)
    return jsonError(413, "RequestTooLarge", "The MCP request body is too large.")
  const webRequest = new Request(new URL(request.url, config.serverUrl), {
    method: request.method,
    headers: request.headers,
    body,
  })
  const response = yield* AgentMcp.handleRequest(webRequest, registry, capability, config)
  return HttpServerResponse.fromWeb(response)
}).pipe(
  Effect.catch(() =>
    Effect.succeed(jsonError(500, "McpTransportError", "The MCP request could not be handled.")),
  ),
)

const challengeRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", "/challenge/:capability", challengeHandler)
    yield* router.add("POST", "/challenge/:capability", challengeHandler)
    yield* router.add("DELETE", "/challenge/:capability", challengeHandler)
  }),
)

const authRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* Config
    const github = yield* GitHubAuth
    const sessions = yield* Session
    const storage = yield* Storage

    yield* router.add(
      "GET",
      "/auth/github",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!Origin.isAllowed(request.headers.origin, config.clientUrl))
          return jsonError(403, "OriginNotAllowed", "This client origin is not allowed.")
        const { url } = yield* github.authorize()
        return HttpServerResponse.redirect(url)
      }),
    )
    yield* router.add(
      "GET",
      "/auth/github/callback",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = new URL(request.url, config.serverUrl)
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        if (code === null || state === null)
          return jsonError(400, "InvalidOAuthCallback", "GitHub did not provide code and state.")
        const profile = yield* github.complete(code, state)
        const issued = yield* sessions.issue(profile)
        return HttpServerResponse.setCookieUnsafe(
          HttpServerResponse.redirect(config.clientUrl),
          config.cookieName,
          issued.token,
          {
            httpOnly: true,
            sameSite: "lax",
            secure: config.secureCookies,
            path: "/",
            expires: new Date(issued.expiresAt),
          },
        )
      }).pipe(
        Effect.catchTag("AuthenticationError", (error) =>
          Effect.succeed(jsonError(400, error.code, error.message)),
        ),
        Effect.catchTag("StorageError", () =>
          Effect.succeed(
            jsonError(503, "StorageUnavailable", "Could not create the application session."),
          ),
        ),
      ),
    )
    yield* router.add(
      "POST",
      "/auth/logout",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!Origin.isAllowed(request.headers.origin, config.clientUrl))
          return jsonError(403, "OriginNotAllowed", "This client origin is not allowed.")
        yield* sessions.signOut(request.cookies[config.cookieName])
        return HttpServerResponse.setCookieUnsafe(
          HttpServerResponse.jsonUnsafe({ ok: true }),
          config.cookieName,
          "",
          {
            httpOnly: true,
            sameSite: "lax",
            secure: config.secureCookies,
            path: "/",
            expires: new Date(0),
          },
        )
      }).pipe(
        Effect.catchTag("StorageError", () =>
          Effect.succeed(jsonError(503, "StorageUnavailable", "Could not sign out.")),
        ),
      ),
    )
    yield* router.add(
      "GET",
      "/api/me",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!Origin.isAllowed(request.headers.origin, config.clientUrl))
          return jsonError(403, "OriginNotAllowed", "This client origin is not allowed.")
        const player = yield* sessions.authenticate(request.cookies[config.cookieName])
        return player === undefined
          ? jsonError(401, "NotAuthenticated", "Sign in with GitHub first.")
          : HttpServerResponse.jsonUnsafe(player)
      }).pipe(
        Effect.catchTag("StorageError", () =>
          Effect.succeed(jsonError(503, "StorageUnavailable", "Could not read the session.")),
        ),
      ),
    )
    yield* router.add(
      "PATCH",
      "/api/me",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!Origin.isAllowed(request.headers.origin, config.clientUrl))
          return jsonError(403, "OriginNotAllowed", "This client origin is not allowed.")
        const player = yield* sessions.authenticate(request.cookies[config.cookieName])
        if (player === undefined)
          return jsonError(401, "NotAuthenticated", "Sign in with GitHub first.")
        const decoded = yield* HttpServerRequest.schemaBodyJson(Identity.UpdateProfileRequest).pipe(
          Effect.option,
        )
        if (decoded._tag === "None")
          return jsonError(400, "InvalidProfile", "Profile settings did not match the schema.")
        const displayName = Identity.normalizeDisplayName(decoded.value.displayName)
        if (displayName === undefined)
          return jsonError(
            400,
            "InvalidDisplayName",
            "Display name must be 2-24 characters without control characters.",
          )
        const updated = yield* storage.updateProfile(
          player.id,
          displayName,
          decoded.value.anonymous,
          Date.now(),
        )
        return updated === undefined
          ? jsonError(401, "NotAuthenticated", "The player account is no longer active.")
          : HttpServerResponse.jsonUnsafe(updated)
      }).pipe(
        Effect.catchTag("StorageError", () =>
          Effect.succeed(jsonError(503, "StorageUnavailable", "Could not update the profile.")),
        ),
      ),
    )
    yield* router.add(
      "DELETE",
      "/api/me",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!Origin.isAllowed(request.headers.origin, config.clientUrl))
          return jsonError(403, "OriginNotAllowed", "This client origin is not allowed.")
        const player = yield* sessions.authenticate(request.cookies[config.cookieName])
        if (player === undefined)
          return jsonError(401, "NotAuthenticated", "Sign in with GitHub first.")
        const decoded = yield* HttpServerRequest.schemaBodyJson(Identity.DeleteAccountRequest).pipe(
          Effect.option,
        )
        if (decoded._tag === "None")
          return jsonError(
            400,
            "InvalidConfirmation",
            "Account deletion requires the explicit DELETE confirmation.",
          )
        const registry = yield* Registry.Registry
        const retired = yield* registry.retire(player.id)
        if (retired._tag === "Rejected") return jsonError(409, retired.code, retired.message)
        return HttpServerResponse.setCookieUnsafe(
          HttpServerResponse.jsonUnsafe({ ok: true }),
          config.cookieName,
          "",
          {
            httpOnly: true,
            sameSite: "lax",
            secure: config.secureCookies,
            path: "/",
            expires: new Date(0),
          },
        )
      }).pipe(
        Effect.catchTag("StorageError", () =>
          Effect.succeed(
            jsonError(503, "StorageUnavailable", "Account deletion did not complete. Try again."),
          ),
        ),
      ),
    )
    yield* router.add(
      "GET",
      "/api/leaderboard",
      storage.leaderboard.pipe(
        Effect.map((rows) =>
          HttpServerResponse.jsonUnsafe({
            title: "Top Contributors",
            subtitle: "to production incidents",
            rows,
          }),
        ),
        Effect.catchTag("StorageError", () =>
          Effect.succeed(jsonError(503, "StorageUnavailable", "Could not read the leaderboard.")),
        ),
      ),
    )
  }),
)

const placeholder = HttpServerResponse.html(
  "<!doctype html><meta charset=utf-8><title>Bugs &amp; Patches</title>" +
    "<main><h1>Bugs &amp; Patches</h1><p>Build the client before starting the server.</p></main>",
)

const staticRoutes = (uiRoot: string | undefined) =>
  uiRoot === undefined
    ? HttpRouter.add("GET", "/", placeholder)
    : HttpRouter.use((router) =>
        Effect.gen(function* () {
          const staticApp = yield* HttpStaticServer.make({ root: uiRoot, spa: true })
          yield* router.add("GET", "/", staticApp)
          yield* router.add("GET", "/*", staticApp)
        }),
      )

const healthRoute = HttpRouter.add("GET", "/health", HttpServerResponse.jsonUnsafe({ ok: true }))

export const layer = (configuration: ServerConfiguration, options?: Options) => {
  const config = Layer.succeed(Config, configuration)
  const storage = storageLayer(configuration.databaseUrl, configuration.migrationsPath)
  const githubApi = apiLive.pipe(Layer.provide(config))
  const github = githubAuthLayer.pipe(Layer.provide(Layer.merge(config, githubApi)))
  const sessions = sessionLayer.pipe(Layer.provide(Layer.merge(config, storage)))
  const registry = Registry.layer({
    challengeOrigin: configuration.challengeOrigin,
    challengeLifetimeMs: configuration.challengeLifetimeMs,
    agentPresenceMs: configuration.agentPresenceMs,
  }).pipe(Layer.provide(storage))
  const services = Layer.mergeAll(config, storage, githubApi, github, sessions, registry)

  const browserCors = HttpRouter.cors({
    allowedOrigins: [configuration.clientUrl],
    allowedMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
  const agentCors = HttpRouter.cors({
    allowedOrigins: [],
    allowedMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "accept", "mcp-protocol-version", "mcp-session-id"],
    exposedHeaders: ["mcp-protocol-version", "mcp-session-id"],
    credentials: false,
  })

  const routes = Layer.mergeAll(
    gameRoute.pipe(Layer.provide(browserCors)),
    authRoutes.pipe(Layer.provide(browserCors)),
    challengeRoutes.pipe(Layer.provide(agentCors)),
    healthRoute,
    staticRoutes(options?.uiRoot),
  )

  return HttpRouter.serve(routes, { disableLogger: true }).pipe(
    Layer.provide(services),
    Layer.provideMerge(
      NodeHttpServer.layer(createServer, {
        host: options?.host ?? "127.0.0.1",
        port: options?.port ?? 4788,
      }),
    ),
  )
}
