import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Config from "../src/server/Config.js"
import * as GitHubAuth from "../src/server/GitHubAuth.js"
import { AuthenticationError } from "../src/server/Identity.js"
import * as Registry from "../src/server/Registry.js"
import * as Session from "../src/server/Session.js"
import * as Storage from "../src/server/Storage.js"
import * as Postgres from "./Postgres.js"

const layer = (databaseUrl: string) => {
  const configuration: Config.ServerConfiguration = {
    githubClientId: "fake-client",
    githubClientSecret: "fake-secret",
    clientUrl: "http://127.0.0.1:5173",
    serverUrl: "http://127.0.0.1:4788",
    callbackUrl: "http://127.0.0.1:4788/auth/github/callback",
    cookieName: "session",
    sessionDurationMs: 10_000,
    oauthAttemptDurationMs: 1_000,
    databaseUrl,
    migrationsPath: "drizzle",
    secureCookies: false,
    agentChallengesEnabled: true,
    challengeOrigin: "http://127.0.0.1:4788",
    challengeLifetimeMs: 600_000,
    agentPresenceMs: 45_000,
    agentWaitMaxMs: 25_000,
    mcpMaxBodyBytes: 65_536,
    mcpRequestsPerMinute: 120,
  }
  const config = Config.layer(configuration)
  const storage = Postgres.storageLayer(databaseUrl)
  const api = Layer.succeed(
    GitHubAuth.GitHubApi,
    GitHubAuth.GitHubApi.of({
      exchange: (code) =>
        code === "one" || code === "two"
          ? Effect.succeed(code)
          : Effect.fail(
              new AuthenticationError({ code: "BadCode", message: "Unknown fake code." }),
            ),
      profile: (token) =>
        Effect.succeed({
          githubId: token === "one" ? "101" : "202",
          login: token === "one" ? "octocat" : "hubot",
          avatarUrl: `https://avatars.test/${token}`,
          profileUrl: `https://github.com/${token}`,
        }),
    }),
  )
  const github = GitHubAuth.layer.pipe(Layer.provide(Layer.merge(config, api)))
  const sessions = Session.layer.pipe(Layer.provide(Layer.merge(config, storage)))
  const registry = Registry.layer().pipe(Layer.provide(storage))
  return Layer.mergeAll(config, storage, api, github, sessions, registry)
}

describe("credential-free production-shaped flow", () => {
  it.effect("authenticates, matches, completes, restarts, and reads the public leaderboard", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.gen(function* () {
        let persistedSessionToken: string | undefined
        yield* Effect.scoped(
          Effect.gen(function* () {
            const github = yield* GitHubAuth.GitHubAuth
            const sessions = yield* Session.Session
            const registry = yield* Registry.Registry
            const oneAttempt = yield* github.authorize(1)
            const twoAttempt = yield* github.authorize(1)
            const oneSession = yield* sessions.issue(
              yield* github.complete("one", oneAttempt.state, 2),
              2,
            )
            persistedSessionToken = oneSession.token
            const twoSession = yield* sessions.issue(
              yield* github.complete("two", twoAttempt.state, 2),
              2,
            )
            const one = yield* sessions.authenticate(oneSession.token, 3)
            const two = yield* sessions.authenticate(twoSession.token, 3)
            if (one === undefined || two === undefined)
              return yield* Effect.die("Fake authentication failed")

            let firstSeat: Registry.Seat | undefined
            yield* registry.joinRanked(one, (seat) =>
              Effect.sync(() => {
                firstSeat = seat
              }),
            )
            const paired = yield* registry.joinRanked(two, () => Effect.void)
            if (
              paired._tag === "Rejected" ||
              paired.value._tag === "Waiting" ||
              firstSeat === undefined
            ) {
              return yield* Effect.die("Fake matchmaking failed")
            }
            const finished = yield* registry.command(paired.value.seat, {
              _tag: "Surrender",
              playerId: paired.value.seat.playerId,
            })
            assert.strictEqual(finished._tag === "Accepted" && finished.value.phase, "Finished")
          }).pipe(Effect.provide(layer(databaseUrl))),
        )

        yield* Effect.scoped(
          Effect.gen(function* () {
            const sessions = yield* Session.Session
            const storage = yield* Storage.Storage
            if (persistedSessionToken === undefined)
              return yield* Effect.die("No application session survived the first server scope")
            assert.strictEqual(
              (yield* sessions.authenticate(persistedSessionToken, 4))?.github.login,
              "octocat",
            )
            const rows = yield* storage.leaderboard
            assert.deepStrictEqual(
              rows.map(({ identity, rating }) => [identity.displayName, rating]),
              [
                ["octocat", 1016],
                ["hubot", 984],
              ],
            )
            assert.strictEqual(rows[0]?.identity.github?.profileUrl, "https://github.com/one")
          }).pipe(Effect.provide(layer(databaseUrl))),
        )
      }),
    ),
  )
})
