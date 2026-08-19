import { createHash, randomBytes } from "node:crypto"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Config } from "./Config.js"
import type * as Identity from "./Identity.js"
import { Storage } from "./Storage.js"

export interface IssuedSession {
  readonly token: string
  readonly expiresAt: number
  readonly player: Identity.Player
}

export interface SessionShape {
  readonly issue: (
    profile: Identity.GitHubProfile,
    now?: number,
  ) => Effect.Effect<IssuedSession, Identity.StorageError>
  readonly authenticate: (
    token: string | undefined,
    now?: number,
  ) => Effect.Effect<Identity.Player | undefined, Identity.StorageError>
  readonly signOut: (token: string | undefined) => Effect.Effect<void, Identity.StorageError>
}

export class Session extends Context.Service<Session, SessionShape>()(
  "@bugs-and-patches/Session",
) {}

export const digest = (token: string) => createHash("sha256").update(token).digest("hex")

const make = Effect.gen(function* () {
  const config = yield* Config
  const storage = yield* Storage
  return Session.of({
    issue: (profile, now = Date.now()) =>
      Effect.gen(function* () {
        const player = yield* storage.upsertProfile(profile, now)
        const token = randomBytes(32).toString("base64url")
        const expiresAt = now + config.sessionDurationMs
        yield* storage.createSession({
          tokenDigest: digest(token),
          playerId: player.id,
          expiresAt,
          createdAt: now,
        })
        return { token, expiresAt, player }
      }),
    authenticate: (token, now = Date.now()) =>
      token === undefined ? Effect.succeed(undefined) : storage.sessionPlayer(digest(token), now),
    signOut: (token) => (token === undefined ? Effect.void : storage.deleteSession(digest(token))),
  })
})

export const layer = Layer.effect(Session, make)
