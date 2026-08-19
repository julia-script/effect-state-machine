import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Identity from "../src/server/Identity.js"
import * as Storage from "../src/server/Storage.js"
import * as Postgres from "./Postgres.js"

const profile = (githubId: string, login: string): Identity.GitHubProfile => ({
  githubId,
  login,
  avatarUrl: `https://avatars.test/${login}`,
  profileUrl: `https://github.com/${login}`,
})

describe("player profile privacy", () => {
  it("normalizes valid display names and rejects invalid values", () => {
    assert.strictEqual(Identity.normalizeDisplayName("  Release Captain  "), "Release Captain")
    assert.strictEqual(Identity.normalizeDisplayName("x"), undefined)
    assert.strictEqual(Identity.normalizeDisplayName("x".repeat(25)), undefined)
    assert.strictEqual(Identity.normalizeDisplayName("bad\u0000name"), undefined)
  })

  it.effect("keeps GitHub in self data while anonymity removes it from public projections", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const created = yield* storage.upsertProfile(profile("1", "octocat"), 1)
          const anonymous = yield* storage.updateProfile(created.id, "  Release Captain  ", true, 2)
          assert.strictEqual(anonymous?.displayName, "Release Captain")
          assert.strictEqual(anonymous?.github.login, "octocat")
          if (anonymous === undefined) return
          assert.deepStrictEqual(Identity.publicIdentity(anonymous), {
            kind: "Account",
            displayName: "Release Captain",
            github: null,
          })

          const invalid = yield* Effect.exit(storage.updateProfile(created.id, "x", false, 3))
          assert.strictEqual(invalid._tag, "Failure")
          assert.strictEqual((yield* storage.player(created.id))?.anonymous, true)
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("restores refreshed GitHub data when anonymity is disabled", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const created = yield* storage.upsertProfile(profile("1", "old-login"), 1)
          yield* storage.updateProfile(created.id, "Maintainer", true, 2)
          yield* storage.upsertProfile(profile("1", "new-login"), 3)
          const visible = yield* storage.updateProfile(created.id, "Maintainer", false, 4)
          assert.strictEqual(visible?.github.login, "new-login")
          assert.strictEqual(
            visible === undefined ? undefined : Identity.publicIdentity(visible).github?.login,
            "new-login",
          )
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("orders privacy-aware leaderboard rows and excludes retired players", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const one = yield* storage.upsertProfile(profile("1", "zeta"), 1)
          const two = yield* storage.upsertProfile(profile("2", "alpha"), 1)
          yield* storage.updateProfile(one.id, "Anonymous Dev", true, 2)
          yield* storage.applyRankedResult({
            matchId: "ranked",
            winnerId: one.id,
            loserId: two.id,
            reason: "Uptime",
            completedAt: 3,
          })
          const rows = yield* storage.leaderboard
          assert.strictEqual(rows[0]?.identity.displayName, "Anonymous Dev")
          assert.strictEqual(rows[0]?.identity.github, null)
          assert.strictEqual(rows[1]?.identity.github?.login, "alpha")
          yield* storage.retirePlayer(one.id)
          assert.deepStrictEqual(
            (yield* storage.leaderboard).map(({ identity }) => identity.displayName),
            ["alpha"],
          )
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )
})
