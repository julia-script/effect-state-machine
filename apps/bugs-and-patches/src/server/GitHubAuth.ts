import { createHash, randomBytes } from "node:crypto"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Config } from "./Config.js"
import { AuthenticationError, type GitHubProfile } from "./Identity.js"

const GitHubUser = Schema.Struct({
  id: Schema.Union([Schema.Number, Schema.String]),
  login: Schema.String,
  avatar_url: Schema.String,
  html_url: Schema.String,
})

const TokenResponse = Schema.Struct({ access_token: Schema.String })

export interface GitHubApiShape {
  readonly exchange: (code: string, verifier: string) => Effect.Effect<string, AuthenticationError>
  readonly profile: (accessToken: string) => Effect.Effect<GitHubProfile, AuthenticationError>
}

export class GitHubApi extends Context.Service<GitHubApi, GitHubApiShape>()(
  "@bugs-and-patches/GitHubApi",
) {}

const authFailure = (code: string, cause: unknown) =>
  new AuthenticationError({ code, message: cause instanceof Error ? cause.message : String(cause) })

export const apiLive = Layer.effect(
  GitHubApi,
  Effect.gen(function* () {
    const config = yield* Config
    return GitHubApi.of({
      exchange: (code, verifier) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch("https://github.com/login/oauth/access_token", {
              method: "POST",
              headers: { accept: "application/json", "content-type": "application/json" },
              body: JSON.stringify({
                client_id: config.githubClientId,
                client_secret: config.githubClientSecret,
                code,
                redirect_uri: config.callbackUrl,
                code_verifier: verifier,
              }),
            })
            if (!response.ok) throw new Error(`GitHub token exchange returned ${response.status}.`)
            return Schema.decodeUnknownSync(TokenResponse)(await response.json()).access_token
          },
          catch: (cause) => authFailure("GitHubExchangeFailed", cause),
        }),
      profile: (accessToken) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch("https://api.github.com/user", {
              headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${accessToken}`,
                "x-github-api-version": "2022-11-28",
              },
            })
            if (!response.ok) throw new Error(`GitHub profile returned ${response.status}.`)
            const profile = Schema.decodeUnknownSync(GitHubUser)(await response.json())
            return {
              githubId: String(profile.id),
              login: profile.login,
              avatarUrl: profile.avatar_url,
              profileUrl: profile.html_url,
            }
          },
          catch: (cause) => authFailure("GitHubProfileFailed", cause),
        }),
    })
  }),
)

interface Attempt {
  readonly verifier: string
  readonly expiresAt: number
}

export interface AuthorizationAttempt {
  readonly url: string
  readonly state: string
}

export interface GitHubAuthShape {
  readonly authorize: (now?: number) => Effect.Effect<AuthorizationAttempt>
  readonly complete: (
    code: string,
    state: string,
    now?: number,
  ) => Effect.Effect<GitHubProfile, AuthenticationError>
}

export class GitHubAuth extends Context.Service<GitHubAuth, GitHubAuthShape>()(
  "@bugs-and-patches/GitHubAuth",
) {}

const base64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")

const make = Effect.gen(function* () {
  const config = yield* Config
  const api = yield* GitHubApi
  const attempts = new Map<string, Attempt>()
  const prune = (now: number) => {
    for (const [state, attempt] of attempts) if (attempt.expiresAt <= now) attempts.delete(state)
  }
  return GitHubAuth.of({
    authorize: (now = Date.now()) =>
      Effect.sync(() => {
        prune(now)
        const state = base64Url(randomBytes(32))
        const verifier = base64Url(randomBytes(48))
        const challenge = createHash("sha256").update(verifier).digest("base64url")
        attempts.set(state, { verifier, expiresAt: now + config.oauthAttemptDurationMs })
        const url = new URL("https://github.com/login/oauth/authorize")
        url.searchParams.set("client_id", config.githubClientId)
        url.searchParams.set("redirect_uri", config.callbackUrl)
        url.searchParams.set("state", state)
        url.searchParams.set("code_challenge", challenge)
        url.searchParams.set("code_challenge_method", "S256")
        return { url: url.toString(), state }
      }),
    complete: (code, state, now = Date.now()) =>
      Effect.gen(function* () {
        prune(now)
        const attempt = attempts.get(state)
        attempts.delete(state)
        if (attempt === undefined || attempt.expiresAt <= now) {
          return yield* Effect.fail(
            new AuthenticationError({
              code: "InvalidOAuthState",
              message: "The GitHub sign-in attempt is missing or expired.",
            }),
          )
        }
        const accessToken = yield* api.exchange(code, attempt.verifier)
        return yield* api.profile(accessToken)
      }),
  })
})

export const layer = Layer.effect(GitHubAuth, make)
