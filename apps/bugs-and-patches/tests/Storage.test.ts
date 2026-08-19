import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Elo from "../src/server/Elo.js"
import type * as Identity from "../src/server/Identity.js"
import * as Storage from "../src/server/Storage.js"
import * as Postgres from "./Postgres.js"

const profile = (githubId: string, login: string): Identity.GitHubProfile => ({
  githubId,
  login,
  avatarUrl: `https://avatars.test/${login}`,
  profileUrl: `https://github.com/${login}`,
})

describe("durable PostgreSQL rankings", () => {
  it("uses K=32 integer Elo for equal and unequal ratings", () => {
    assert.deepStrictEqual(Elo.apply(1000, 1000), { winner: 1016, loser: 984 })
    assert.deepStrictEqual(Elo.apply(1200, 1000), { winner: 1208, loser: 992 })
    assert.deepStrictEqual(Elo.apply(1000, 1200), { winner: 1024, loser: 1176 })
  })

  it.effect("applies migrations repeatedly and survives pool restart", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.gen(function* () {
        let playerId: string | undefined
        yield* Effect.scoped(
          Effect.gen(function* () {
            const storage = yield* Storage.Storage
            playerId = (yield* storage.upsertProfile(profile("1", "octocat"), 1)).id
          }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const storage = yield* Storage.Storage
            assert.strictEqual(
              playerId === undefined ? undefined : (yield* storage.player(playerId))?.github.login,
              "octocat",
            )
          }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
        )
      }),
    ),
  )

  it.effect("applies each match once, rolls back failures, and orders rows", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const one = yield* storage.upsertProfile(profile("1", "zeta"), 1)
          const two = yield* storage.upsertProfile(profile("2", "alpha"), 1)
          yield* storage.upsertProfile(profile("3", "middle"), 1)
          assert.strictEqual(
            (yield* storage.applyRankedResult({
              matchId: "m1",
              winnerId: one.id,
              loserId: two.id,
              reason: "Uptime",
              completedAt: 2,
            })).applied,
            true,
          )
          assert.strictEqual(
            (yield* storage.applyRankedResult({
              matchId: "m1",
              winnerId: two.id,
              loserId: one.id,
              reason: "Surrender",
              completedAt: 3,
            })).applied,
            false,
          )
          assert.strictEqual(
            (yield* Effect.exit(
              storage.applyRankedResult({
                matchId: "bad",
                winnerId: one.id,
                loserId: crypto.randomUUID(),
                reason: "Uptime",
                completedAt: 4,
              }),
            ))._tag,
            "Failure",
          )
          assert.strictEqual((yield* storage.player(one.id))?.games, 1)
          assert.strictEqual(yield* storage.rankedResult("bad"), undefined)
          assert.deepStrictEqual(
            (yield* storage.leaderboard).map(({ identity }) => identity.displayName),
            ["zeta", "alpha"],
          )
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )

  it.effect("serializes concurrent results that share players", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage
          const one = yield* storage.upsertProfile(profile("1", "one"), 1)
          const two = yield* storage.upsertProfile(profile("2", "two"), 1)
          const outcomes = yield* Effect.all(
            [
              storage.applyRankedResult({
                matchId: "concurrent-one",
                winnerId: one.id,
                loserId: two.id,
                reason: "Uptime",
                completedAt: 2,
              }),
              storage.applyRankedResult({
                matchId: "concurrent-two",
                winnerId: two.id,
                loserId: one.id,
                reason: "Uptime",
                completedAt: 3,
              }),
            ],
            { concurrency: "unbounded" },
          )
          assert.strictEqual(
            outcomes.every(({ applied }) => applied),
            true,
          )
          assert.strictEqual((yield* storage.player(one.id))?.games, 2)
          assert.strictEqual((yield* storage.player(two.id))?.games, 2)
        }).pipe(Effect.provide(Postgres.storageLayer(databaseUrl))),
      ),
    ),
  )
})
