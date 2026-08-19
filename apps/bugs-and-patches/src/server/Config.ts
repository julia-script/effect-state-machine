import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ConfigurationError } from "./Identity.js"

export interface ServerConfiguration {
  readonly githubClientId: string
  readonly githubClientSecret: string
  readonly clientUrl: string
  readonly serverUrl: string
  readonly callbackUrl: string
  readonly cookieName: string
  readonly sessionDurationMs: number
  readonly oauthAttemptDurationMs: number
  readonly databaseUrl: string
  readonly migrationsPath: string
  readonly secureCookies: boolean
  readonly agentChallengesEnabled: boolean
  readonly challengeOrigin: string
  readonly challengeLifetimeMs: number
  readonly agentPresenceMs: number
  readonly agentWaitMaxMs: number
  readonly mcpMaxBodyBytes: number
  readonly mcpRequestsPerMinute: number
}

export class Config extends Context.Service<Config, ServerConfiguration>()(
  "@bugs-and-patches/Config",
) {}

const positive = (name: string, value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError({ message: `${name} must be a positive integer.` })
  }
  return parsed
}

const origin = (name: string, value: string) => {
  const parsed = new URL(value)
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.protocol !== "https:" &&
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "localhost")
  ) {
    throw new ConfigurationError({
      message: `${name} must be an HTTPS origin, except for loopback development.`,
    })
  }
  return parsed.origin
}

const isLoopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost"

export const fromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<ServerConfiguration, ConfigurationError> =>
  Effect.try({
    try: () => {
      const githubClientId = env.BUGS_PATCHES_GITHUB_CLIENT_ID
      const githubClientSecret = env.BUGS_PATCHES_GITHUB_CLIENT_SECRET
      if (githubClientId === undefined || githubClientId.length === 0) {
        throw new ConfigurationError({ message: "BUGS_PATCHES_GITHUB_CLIENT_ID is required." })
      }
      if (githubClientSecret === undefined || githubClientSecret.length === 0) {
        throw new ConfigurationError({ message: "BUGS_PATCHES_GITHUB_CLIENT_SECRET is required." })
      }
      const databaseUrl = env.DATABASE_URL
      if (databaseUrl === undefined || databaseUrl.length === 0) {
        throw new ConfigurationError({ message: "DATABASE_URL is required." })
      }
      const parsedDatabaseUrl = new URL(databaseUrl)
      if (
        parsedDatabaseUrl.protocol !== "postgres:" &&
        parsedDatabaseUrl.protocol !== "postgresql:"
      ) {
        throw new ConfigurationError({
          message: "DATABASE_URL must be a PostgreSQL connection URL.",
        })
      }
      const serverUrl = origin(
        "BUGS_PATCHES_SERVER_URL",
        env.BUGS_PATCHES_SERVER_URL ?? "http://127.0.0.1:4788",
      )
      const clientUrl = origin("BUGS_PATCHES_CLIENT_URL", env.BUGS_PATCHES_CLIENT_URL ?? serverUrl)
      const clientOrigin = new URL(clientUrl)
      const serverOrigin = new URL(serverUrl)
      if (
        isLoopback(clientOrigin.hostname) &&
        isLoopback(serverOrigin.hostname) &&
        clientOrigin.hostname !== serverOrigin.hostname
      ) {
        throw new ConfigurationError({
          message:
            "BUGS_PATCHES_CLIENT_URL and BUGS_PATCHES_SERVER_URL must use the same loopback hostname so the OAuth session cookie is returned.",
        })
      }
      const callbackUrl =
        env.BUGS_PATCHES_GITHUB_CALLBACK_URL ?? `${serverUrl}/auth/github/callback`
      const callback = new URL(callbackUrl)
      if (
        callback.origin !== serverUrl ||
        (callback.protocol !== "https:" &&
          callback.hostname !== "127.0.0.1" &&
          callback.hostname !== "localhost")
      ) {
        throw new ConfigurationError({
          message:
            "The GitHub callback must use the configured server origin and HTTPS outside loopback development.",
        })
      }
      return {
        githubClientId,
        githubClientSecret,
        clientUrl,
        serverUrl,
        callbackUrl: callback.toString(),
        cookieName: env.BUGS_PATCHES_COOKIE_NAME ?? "bugs_patches_session",
        sessionDurationMs: positive(
          "BUGS_PATCHES_SESSION_DURATION_MS",
          env.BUGS_PATCHES_SESSION_DURATION_MS,
          7 * 24 * 60 * 60 * 1_000,
        ),
        oauthAttemptDurationMs: positive(
          "BUGS_PATCHES_OAUTH_ATTEMPT_DURATION_MS",
          env.BUGS_PATCHES_OAUTH_ATTEMPT_DURATION_MS,
          10 * 60 * 1_000,
        ),
        databaseUrl,
        migrationsPath: env.BUGS_PATCHES_MIGRATIONS_PATH ?? "dist/server/drizzle",
        secureCookies: new URL(serverUrl).protocol === "https:",
        agentChallengesEnabled: env.BUGS_PATCHES_AGENT_CHALLENGES_ENABLED === "1",
        challengeOrigin: origin(
          "BUGS_PATCHES_CHALLENGE_ORIGIN",
          env.BUGS_PATCHES_CHALLENGE_ORIGIN ?? serverUrl,
        ),
        challengeLifetimeMs: positive(
          "BUGS_PATCHES_CHALLENGE_LIFETIME_MS",
          env.BUGS_PATCHES_CHALLENGE_LIFETIME_MS,
          10 * 60 * 1_000,
        ),
        agentPresenceMs: positive(
          "BUGS_PATCHES_AGENT_PRESENCE_MS",
          env.BUGS_PATCHES_AGENT_PRESENCE_MS,
          45_000,
        ),
        agentWaitMaxMs: positive(
          "BUGS_PATCHES_AGENT_WAIT_MAX_MS",
          env.BUGS_PATCHES_AGENT_WAIT_MAX_MS,
          25_000,
        ),
        mcpMaxBodyBytes: positive(
          "BUGS_PATCHES_MCP_MAX_BODY_BYTES",
          env.BUGS_PATCHES_MCP_MAX_BODY_BYTES,
          64 * 1_024,
        ),
        mcpRequestsPerMinute: positive(
          "BUGS_PATCHES_MCP_REQUESTS_PER_MINUTE",
          env.BUGS_PATCHES_MCP_REQUESTS_PER_MINUTE,
          120,
        ),
      }
    },
    catch: (cause) =>
      cause instanceof ConfigurationError
        ? cause
        : new ConfigurationError({
            message: cause instanceof Error ? cause.message : String(cause),
          }),
  })

export const layer = (configuration: ServerConfiguration) => Layer.succeed(Config, configuration)
