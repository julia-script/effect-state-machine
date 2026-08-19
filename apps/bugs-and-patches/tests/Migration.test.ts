import { readFile } from "node:fs/promises"
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { Client } from "pg"
import * as Postgres from "./Postgres.js"

const statements = (sql: string) =>
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)

const runSql = (client: Client, path: URL) =>
  Effect.tryPromise({
    try: async () => {
      const sql = await readFile(path, "utf8")
      for (const statement of statements(sql)) await client.query(statement)
    },
    catch: (cause) => cause,
  })

describe("identity-key migration", () => {
  it.effect("preserves players, sessions, ratings, and ranked ledger references", () =>
    Postgres.withDatabase((databaseUrl) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: async () => {
            const client = new Client({ connectionString: databaseUrl })
            await client.connect()
            return client
          },
          catch: (cause) => cause,
        }),
        (client) =>
          Effect.gen(function* () {
            yield* runSql(
              client,
              new URL("../drizzle/20260818231231_fair_chimera/migration.sql", import.meta.url),
            )
            yield* Effect.tryPromise({
              try: () =>
                client.query(`
                  INSERT INTO players
                    (github_id, login, avatar_url, profile_url, rating, wins, losses, games, created_at, updated_at)
                  VALUES
                    ('101', 'octocat', 'avatar-one', 'profile-one', 1100, 3, 1, 4, NOW(), NOW()),
                    ('202', 'hubot', 'avatar-two', 'profile-two', 900, 1, 3, 4, NOW(), NOW());
                  INSERT INTO sessions (token_digest, github_id, expires_at, created_at)
                  VALUES ('digest', '101', NOW() + INTERVAL '1 day', NOW());
                  INSERT INTO ranked_results
                    (match_id, winner_id, loser_id, reason, winner_rating_before, loser_rating_before,
                     winner_rating_after, loser_rating_after, completed_at)
                  VALUES ('match-one', '101', '202', 'Uptime', 1084, 916, 1100, 900, NOW());
                `),
              catch: (cause) => cause,
            })
            yield* runSql(
              client,
              new URL("../drizzle/20260819004858_silly_nomad/migration.sql", import.meta.url),
            )
            const migrated = yield* Effect.tryPromise({
              try: () =>
                client.query(`
                  SELECT
                    p.id,
                    p.display_name,
                    p.rating,
                    p.wins,
                    p.losses,
                    p.games,
                    g.github_id,
                    s.player_id AS session_player_id,
                    r.winner_id,
                    r.loser_id,
                    r.winner_rating_before,
                    r.loser_rating_before,
                    r.winner_rating_after,
                    r.loser_rating_after
                  FROM players p
                  JOIN github_identities g ON g.player_id = p.id
                  LEFT JOIN sessions s ON s.player_id = p.id
                  LEFT JOIN ranked_results r ON r.winner_id = p.id
                  WHERE g.github_id = '101'
                `),
              catch: (cause) => cause,
            })
            const row = migrated.rows[0]
            assert.strictEqual(migrated.rowCount, 1)
            assert.strictEqual(row.display_name, "octocat")
            assert.strictEqual(row.rating, 1100)
            assert.strictEqual(row.wins, 3)
            assert.strictEqual(row.losses, 1)
            assert.strictEqual(row.games, 4)
            assert.strictEqual(row.session_player_id, row.id)
            assert.strictEqual(row.winner_id, row.id)
            assert.strictEqual(row.winner_rating_before, 1084)
            assert.strictEqual(row.loser_rating_before, 916)
            assert.strictEqual(row.winner_rating_after, 1100)
            assert.strictEqual(row.loser_rating_after, 900)

            const loser = yield* Effect.tryPromise({
              try: () =>
                client.query("SELECT player_id FROM github_identities WHERE github_id = '202'"),
              catch: (cause) => cause,
            })
            assert.strictEqual(row.loser_id, loser.rows[0]?.player_id)

            const foreignKeys = yield* Effect.tryPromise({
              try: () =>
                client.query(`
                  SELECT COUNT(*)::int AS count
                  FROM pg_constraint
                  WHERE conname IN (
                    'github_identities_player_id_players_id_fkey',
                    'sessions_player_id_players_id_fkey',
                    'ranked_results_winner_id_players_id_fkey',
                    'ranked_results_loser_id_players_id_fkey'
                  )
                `),
              catch: (cause) => cause,
            })
            assert.strictEqual(foreignKeys.rows[0]?.count, 4)
          }),
        (client) => Effect.promise(() => client.end()),
      ),
    ),
  )
})
