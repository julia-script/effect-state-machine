import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Config from "../src/server/Config.js"
import * as GitHubAuth from "../src/server/GitHubAuth.js"
import { AuthenticationError } from "../src/server/Identity.js"
import * as Session from "../src/server/Session.js"
import * as Storage from "../src/server/Storage.js"
import * as Postgres from "./Postgres.js"

const configuration = (databaseUrl: string): Config.ServerConfiguration => ({
  githubClientId: "client-id",
  githubClientSecret: "client-secret",
  clientUrl: "http://127.0.0.1:5173",
  serverUrl: "http://127.0.0.1:4788",
  callbackUrl: "http://127.0.0.1:4788/auth/github/callback",
  cookieName: "test_session",
  sessionDurationMs: 1_000,
  oauthAttemptDurationMs: 100,
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
})

const services = (databaseUrl: string, login: string, verifierRejected = false) => {
  const config = Config.layer(configuration(databaseUrl))
  const storage = Postgres.storageLayer(databaseUrl)
  const api = Layer.succeed(
    GitHubAuth.GitHubApi,
    GitHubAuth.GitHubApi.of({
      exchange: (code, verifier) =>
        verifierRejected || code !== "valid-code" || verifier.length < 43
          ? Effect.fail(
              new AuthenticationError({ code: "VerifierRejected", message: "Rejected verifier." }),
            )
          : Effect.succeed("github-access-token-never-persisted"),
      profile: (token) =>
        token !== "github-access-token-never-persisted"
          ? Effect.fail(new AuthenticationError({ code: "BadToken", message: "Unexpected token." }))
          : Effect.succeed({
              githubId: "42",
              login,
              avatarUrl: `https://avatars.test/${login}`,
              profileUrl: `https://github.com/${login}`,
            }),
    }),
  )
  const github = GitHubAuth.layer.pipe(Layer.provide(Layer.merge(config, api)))
  const sessions = Session.layer.pipe(Layer.provide(Layer.merge(config, storage)))
  return Layer.mergeAll(config, storage, api, github, sessions)
}

describe("GitHub authentication and application sessions", () => {
  it.effect(
    "uses state and PKCE, refreshes the profile by immutable ID, and never exposes the GitHub token",
    () =>
      Postgres.withDatabase((databaseUrl) =>
        Effect.scoped(
          Effect.gen(function* () {
            const github = yield* GitHubAuth.GitHubAuth
            const sessions = yield* Session.Session
            const storage = yield* Storage.Storage
            const attempt = yield* github.authorize(1)
            const url = new URL(attempt.url)
            assert.strictEqual(url.searchParams.get("scope"), null)
            assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256")
            assert.ok((url.searchParams.get("code_challenge")?.length ?? 0) > 20)
            const issued = yield* sessions.issue(
              yield* github.complete("valid-code", attempt.state, 2),
              2,
            )
            assert.strictEqual(
              (yield* sessions.authenticate(issued.token, 3))?.id,
              issued.player.id,
            )
            assert.strictEqual(JSON.stringify(issued.player).includes("github-access-token"), false)
            assert.strictEqual((yield* storage.player(issued.player.id))?.github.login, "octocat")
          }).pipe(Effect.provide(services(databaseUrl, "octocat"))),
        ),
      ),
  )

  it.effect("rejects missing, reused, expired, and provider-rejected attempts", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const github = yield* GitHubAuth.GitHubAuth
          assert.strictEqual(
            (yield* Effect.exit(github.complete("valid-code", "missing", 1)))._tag,
            "Failure",
          )
          const attempt = yield* github.authorize(1)
          yield* github.complete("valid-code", attempt.state, 2)
          assert.strictEqual(
            (yield* Effect.exit(github.complete("valid-code", attempt.state, 3)))._tag,
            "Failure",
          )
          const expired = yield* github.authorize(1)
          assert.strictEqual(
            (yield* Effect.exit(github.complete("valid-code", expired.state, 102)))._tag,
            "Failure",
          )
        }).pipe(Effect.provide(services(databaseUrl, "octocat"))),
      ),
    ),
  )

  it.effect("surfaces a provider rejection of the PKCE verifier", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const github = yield* GitHubAuth.GitHubAuth
          const attempt = yield* github.authorize(1)
          assert.strictEqual(
            (yield* Effect.exit(github.complete("valid-code", attempt.state, 2)))._tag,
            "Failure",
          )
        }).pipe(Effect.provide(services(databaseUrl, "octocat", true))),
      ),
    ),
  )

  it.effect("expires and revokes opaque application sessions", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const github = yield* GitHubAuth.GitHubAuth
          const sessions = yield* Session.Session
          assert.strictEqual(yield* sessions.authenticate(undefined, 1), undefined)
          const attempt = yield* github.authorize(1)
          const issued = yield* sessions.issue(
            yield* github.complete("valid-code", attempt.state, 2),
            2,
          )
          assert.strictEqual(yield* sessions.authenticate(issued.token, 1_003), undefined)
          const nextAttempt = yield* github.authorize(2_000)
          const next = yield* sessions.issue(
            yield* github.complete("valid-code", nextAttempt.state, 2_001),
            2_001,
          )
          yield* sessions.signOut(next.token)
          assert.strictEqual(yield* sessions.authenticate(next.token, 2_002), undefined)
        }).pipe(Effect.provide(services(databaseUrl, "octocat"))),
      ),
    ),
  )

  it.effect("revokes every application session when an account is retired", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const github = yield* GitHubAuth.GitHubAuth
          const sessions = yield* Session.Session
          const storage = yield* Storage.Storage
          const firstAttempt = yield* github.authorize(1)
          const first = yield* sessions.issue(
            yield* github.complete("valid-code", firstAttempt.state, 2),
            2,
          )
          const secondAttempt = yield* github.authorize(3)
          const second = yield* sessions.issue(
            yield* github.complete("valid-code", secondAttempt.state, 4),
            4,
          )
          yield* storage.retirePlayer(first.player.id)
          assert.strictEqual(yield* sessions.authenticate(first.token, 5), undefined)
          assert.strictEqual(yield* sessions.authenticate(second.token, 5), undefined)
        }).pipe(Effect.provide(services(databaseUrl, "octocat"))),
      ),
    ),
  )

  it.effect("refreshes mutable GitHub profile fields without replacing ranking identity", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const original = yield* storage.upsertProfile(
            { githubId: "42", login: "old-name", avatarUrl: "old", profileUrl: "old-url" },
            1,
          )
          yield* storage.updateProfile(original.id, "Release Captain", true, 2)
          const refreshed = yield* storage.upsertProfile(
            { githubId: "42", login: "new-name", avatarUrl: "new", profileUrl: "new-url" },
            3,
          )
          const player = yield* storage.player(original.id)
          assert.strictEqual(refreshed.id, original.id)
          assert.strictEqual(player?.github.login, "new-name")
          assert.strictEqual(player?.displayName, "Release Captain")
          assert.strictEqual(player?.anonymous, true)
          assert.strictEqual(player?.rating, 1000)
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("creates a fresh player when a deleted GitHub identity signs in again", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const profile = {
            githubId: "42",
            login: "octocat",
            avatarUrl: "avatar",
            profileUrl: "profile",
          }
          const original = yield* storage.upsertProfile(profile, 1)
          yield* storage.updateProfile(original.id, "Incident Commander", false, 2)
          assert.strictEqual((yield* storage.retirePlayer(original.id)).retired, true)
          assert.strictEqual(yield* storage.player(original.id), undefined)

          const returned = yield* storage.upsertProfile(profile, 3)
          assert.notStrictEqual(returned.id, original.id)
          assert.strictEqual(returned.displayName, "octocat")
          assert.strictEqual(returned.rating, 1000)
          assert.strictEqual(returned.games, 0)
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("validates secrets, database URLs, origins, and callback ownership", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* Effect.exit(Config.fromEnv({})))._tag, "Failure")
      assert.strictEqual(
        (yield* Effect.exit(
          Config.fromEnv({
            BUGS_PATCHES_GITHUB_CLIENT_ID: "id",
            BUGS_PATCHES_GITHUB_CLIENT_SECRET: "secret",
            DATABASE_URL: "postgresql://localhost/game",
            BUGS_PATCHES_SERVER_URL: "https://api.example.com",
            BUGS_PATCHES_GITHUB_CALLBACK_URL: "https://other.example.com/callback",
          }),
        ))._tag,
        "Failure",
      )
      assert.strictEqual(
        (yield* Effect.exit(
          Config.fromEnv({
            BUGS_PATCHES_GITHUB_CLIENT_ID: "id",
            BUGS_PATCHES_GITHUB_CLIENT_SECRET: "secret",
            DATABASE_URL: "postgresql://localhost/game",
            BUGS_PATCHES_CLIENT_URL: "http://localhost:5173",
            BUGS_PATCHES_SERVER_URL: "http://127.0.0.1:4788",
          }),
        ))._tag,
        "Failure",
      )
      const valid = yield* Config.fromEnv({
        BUGS_PATCHES_GITHUB_CLIENT_ID: "id",
        BUGS_PATCHES_GITHUB_CLIENT_SECRET: "secret",
        DATABASE_URL: "postgresql://localhost/game",
        BUGS_PATCHES_CLIENT_URL: "https://bugs.example.com",
        BUGS_PATCHES_SERVER_URL: "https://game.example.com",
      })
      assert.strictEqual(valid.callbackUrl, "https://game.example.com/auth/github/callback")
      assert.strictEqual(valid.agentChallengesEnabled, false)
      assert.strictEqual(valid.challengeOrigin, "https://game.example.com")
      const challengeConfig = yield* Config.fromEnv({
        BUGS_PATCHES_GITHUB_CLIENT_ID: "id",
        BUGS_PATCHES_GITHUB_CLIENT_SECRET: "secret",
        DATABASE_URL: "postgresql://localhost/game",
        BUGS_PATCHES_CLIENT_URL: "https://bugs.example.com",
        BUGS_PATCHES_SERVER_URL: "https://game.example.com",
        BUGS_PATCHES_CHALLENGE_ORIGIN: "https://agents.example.com",
        BUGS_PATCHES_AGENT_CHALLENGES_ENABLED: "1",
        BUGS_PATCHES_CHALLENGE_LIFETIME_MS: "1000",
        BUGS_PATCHES_MCP_MAX_BODY_BYTES: "2048",
      })
      assert.strictEqual(challengeConfig.agentChallengesEnabled, true)
      assert.strictEqual(challengeConfig.challengeOrigin, "https://agents.example.com")
      assert.strictEqual(challengeConfig.challengeLifetimeMs, 1000)
      assert.strictEqual(challengeConfig.mcpMaxBodyBytes, 2048)
    }),
  )
})
