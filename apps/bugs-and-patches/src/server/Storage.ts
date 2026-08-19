import { and, asc, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Pool } from "pg"
import * as DatabaseSchema from "./DatabaseSchema.js"
import * as Elo from "./Elo.js"
import * as Identity from "./Identity.js"
import { StorageError } from "./Identity.js"

export interface RankedCompletion {
  readonly matchId: string
  readonly winnerId: string
  readonly loserId: string
  readonly reason: Identity.RankedResultReason
  readonly completedAt: number
}

export interface CompletionResult {
  readonly applied: boolean
  readonly winner: Identity.Player
  readonly loser: Identity.Player
}

export interface RetirementResult {
  readonly retired: boolean
}

export interface StorageShape {
  readonly upsertProfile: (
    profile: Identity.GitHubProfile,
    now: number,
  ) => Effect.Effect<Identity.Player, StorageError>
  readonly player: (playerId: string) => Effect.Effect<Identity.Player | undefined, StorageError>
  readonly updateProfile: (
    playerId: string,
    displayName: string,
    anonymous: boolean,
    now: number,
  ) => Effect.Effect<Identity.Player | undefined, StorageError>
  readonly createSession: (session: Identity.AppSession) => Effect.Effect<void, StorageError>
  readonly sessionPlayer: (
    digest: string,
    now: number,
  ) => Effect.Effect<Identity.Player | undefined, StorageError>
  readonly deleteSession: (digest: string) => Effect.Effect<void, StorageError>
  readonly cleanupSessions: (now: number) => Effect.Effect<number, StorageError>
  readonly applyRankedResult: (
    completion: RankedCompletion,
  ) => Effect.Effect<CompletionResult, StorageError>
  readonly retirePlayer: (
    playerId: string,
    completion?: RankedCompletion,
  ) => Effect.Effect<RetirementResult, StorageError>
  readonly leaderboard: Effect.Effect<ReadonlyArray<Identity.LeaderboardRow>, StorageError>
  readonly rankedResult: (
    matchId: string,
  ) => Effect.Effect<Identity.RankedResult | undefined, StorageError>
}

export class Storage extends Context.Service<Storage, StorageShape>()(
  "@bugs-and-patches/Storage",
) {}

type PlayerRow = typeof DatabaseSchema.players.$inferSelect
type GitHubIdentityRow = typeof DatabaseSchema.githubIdentities.$inferSelect
type RankedResultRow = typeof DatabaseSchema.rankedResults.$inferSelect

const playerFrom = (row: PlayerRow, github: GitHubIdentityRow): Identity.Player => {
  if (row.displayName === null || row.deletedAt !== null) {
    throw new Error("Retired player cannot be decoded as an active player.")
  }
  return {
    id: row.id,
    displayName: row.displayName,
    anonymous: row.anonymous,
    github: {
      login: github.login,
      avatarUrl: github.avatarUrl,
      profileUrl: github.profileUrl,
    },
    rating: row.rating,
    wins: row.wins,
    losses: row.losses,
    games: row.games,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

const resultFrom = (row: RankedResultRow): Identity.RankedResult => ({
  matchId: row.matchId,
  winnerId: row.winnerId,
  loserId: row.loserId,
  reason: row.reason,
  winnerRatingBefore: row.winnerRatingBefore,
  loserRatingBefore: row.loserRatingBefore,
  winnerRatingAfter: row.winnerRatingAfter,
  loserRatingAfter: row.loserRatingAfter,
  completedAt: row.completedAt.getTime(),
})

const storageError = (operation: string, cause: unknown) =>
  new StorageError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  })

const make = (databaseUrl: string, migrationsPath: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new Pool({ connectionString: databaseUrl, max: 10 })),
    (pool) => Effect.promise(() => pool.end()),
  ).pipe(
    Effect.tap((pool) =>
      Effect.tryPromise({
        try: () => migrate(drizzle({ client: pool }), { migrationsFolder: migrationsPath }),
        catch: (cause) => storageError("migrate", cause),
      }),
    ),
    Effect.map((pool): StorageShape => {
      const database = drizzle({ client: pool })
      const attempt = <A>(operation: string, evaluate: () => Promise<A>) =>
        Effect.tryPromise({
          try: evaluate,
          catch: (cause) => storageError(operation, cause),
        })

      const readPlayer = async (playerId: string) => {
        const rows = await database
          .select({ player: DatabaseSchema.players, github: DatabaseSchema.githubIdentities })
          .from(DatabaseSchema.players)
          .innerJoin(
            DatabaseSchema.githubIdentities,
            eq(DatabaseSchema.githubIdentities.playerId, DatabaseSchema.players.id),
          )
          .where(
            and(eq(DatabaseSchema.players.id, playerId), isNull(DatabaseSchema.players.deletedAt)),
          )
          .limit(1)
        const row = rows[0]
        return row === undefined ? undefined : playerFrom(row.player, row.github)
      }

      return Storage.of({
        upsertProfile: (profile, now) =>
          attempt("upsertProfile", async () => {
            const timestamp = new Date(now)
            return database.transaction(async (transaction) => {
              const existing = await transaction
                .select({ player: DatabaseSchema.players, github: DatabaseSchema.githubIdentities })
                .from(DatabaseSchema.githubIdentities)
                .innerJoin(
                  DatabaseSchema.players,
                  eq(DatabaseSchema.players.id, DatabaseSchema.githubIdentities.playerId),
                )
                .where(eq(DatabaseSchema.githubIdentities.githubId, profile.githubId))
                .limit(1)
              const found = existing[0]
              if (found !== undefined) {
                if (found.player.deletedAt !== null || found.player.displayName === null)
                  throw new Error("A retired player cannot retain a GitHub identity.")
                const githubRows = await transaction
                  .update(DatabaseSchema.githubIdentities)
                  .set({
                    login: profile.login,
                    avatarUrl: profile.avatarUrl,
                    profileUrl: profile.profileUrl,
                    updatedAt: timestamp,
                  })
                  .where(eq(DatabaseSchema.githubIdentities.githubId, profile.githubId))
                  .returning()
                const playerRows = await transaction
                  .update(DatabaseSchema.players)
                  .set({ updatedAt: timestamp })
                  .where(eq(DatabaseSchema.players.id, found.player.id))
                  .returning()
                const github = githubRows[0]
                const player = playerRows[0]
                if (github === undefined || player === undefined)
                  throw new Error("Profile refresh returned no active player.")
                return playerFrom(player, github)
              }

              const playerRows = await transaction
                .insert(DatabaseSchema.players)
                .values({
                  displayName: Identity.defaultDisplayName(profile.login),
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })
                .returning()
              const player = playerRows[0]
              if (player === undefined) throw new Error("Profile upsert returned no player.")
              const githubRows = await transaction
                .insert(DatabaseSchema.githubIdentities)
                .values({
                  githubId: profile.githubId,
                  playerId: player.id,
                  login: profile.login,
                  avatarUrl: profile.avatarUrl,
                  profileUrl: profile.profileUrl,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                })
                .returning()
              const github = githubRows[0]
              if (github === undefined) throw new Error("Profile upsert returned no identity.")
              return playerFrom(player, github)
            })
          }),
        player: (playerId) => attempt("player", () => readPlayer(playerId)),
        updateProfile: (playerId, displayName, anonymous, now) =>
          attempt("updateProfile", async () => {
            const normalized = Identity.normalizeDisplayName(displayName)
            if (normalized === undefined)
              throw new Error("Display name must be 2-24 characters without control characters.")
            const rows = await database
              .update(DatabaseSchema.players)
              .set({ displayName: normalized, anonymous, updatedAt: new Date(now) })
              .where(
                and(eq(DatabaseSchema.players.id, playerId), isNull(DatabaseSchema.players.deletedAt)),
              )
              .returning({ id: DatabaseSchema.players.id })
            return rows[0] === undefined ? undefined : readPlayer(rows[0].id)
          }),
        createSession: (session) =>
          attempt("createSession", async () => {
            await database
              .insert(DatabaseSchema.sessions)
              .values({
                tokenDigest: session.tokenDigest,
                playerId: session.playerId,
                expiresAt: new Date(session.expiresAt),
                createdAt: new Date(session.createdAt),
              })
              .onConflictDoUpdate({
                target: DatabaseSchema.sessions.tokenDigest,
                set: {
                  playerId: session.playerId,
                  expiresAt: new Date(session.expiresAt),
                  createdAt: new Date(session.createdAt),
                },
              })
          }),
        sessionPlayer: (digest, now) =>
          attempt("sessionPlayer", async () => {
            const rows = await database
              .select({ player: DatabaseSchema.players, github: DatabaseSchema.githubIdentities })
              .from(DatabaseSchema.sessions)
              .innerJoin(
                DatabaseSchema.players,
                eq(DatabaseSchema.players.id, DatabaseSchema.sessions.playerId),
              )
              .innerJoin(
                DatabaseSchema.githubIdentities,
                eq(DatabaseSchema.githubIdentities.playerId, DatabaseSchema.players.id),
              )
              .where(
                and(
                  eq(DatabaseSchema.sessions.tokenDigest, digest),
                  gt(DatabaseSchema.sessions.expiresAt, new Date(now)),
                  isNull(DatabaseSchema.players.deletedAt),
                ),
              )
              .limit(1)
            const row = rows[0]
            return row === undefined ? undefined : playerFrom(row.player, row.github)
          }),
        deleteSession: (digest) =>
          attempt("deleteSession", async () => {
            await database
              .delete(DatabaseSchema.sessions)
              .where(eq(DatabaseSchema.sessions.tokenDigest, digest))
          }),
        cleanupSessions: (now) =>
          attempt("cleanupSessions", async () => {
            const deleted = await database
              .delete(DatabaseSchema.sessions)
              .where(lte(DatabaseSchema.sessions.expiresAt, new Date(now)))
              .returning({ tokenDigest: DatabaseSchema.sessions.tokenDigest })
            return deleted.length
          }),
        applyRankedResult: (completion) =>
          attempt("applyRankedResult", async () => {
            if (completion.winnerId === completion.loserId)
              throw new Error("A ranked result requires distinct players.")
            return database.transaction(async (transaction) => {
              const playerIds = [completion.winnerId, completion.loserId].sort()
              const lockedPlayers = await transaction
                .select()
                .from(DatabaseSchema.players)
                .where(
                  and(
                    inArray(DatabaseSchema.players.id, playerIds),
                    isNull(DatabaseSchema.players.deletedAt),
                  ),
                )
                .orderBy(asc(DatabaseSchema.players.id))
                .for("update")
              const byId = new Map(lockedPlayers.map((row) => [row.id, row]))
              const winner = byId.get(completion.winnerId)
              const loser = byId.get(completion.loserId)
              if (winner === undefined || loser === undefined)
                throw new Error("Both ranked players must be active before recording a result.")
              const githubRows = await transaction
                .select()
                .from(DatabaseSchema.githubIdentities)
                .where(inArray(DatabaseSchema.githubIdentities.playerId, playerIds))
              const githubByPlayer = new Map(githubRows.map((row) => [row.playerId, row]))
              const winnerGithub = githubByPlayer.get(completion.winnerId)
              const loserGithub = githubByPlayer.get(completion.loserId)
              if (winnerGithub === undefined || loserGithub === undefined)
                throw new Error("Both ranked identities must exist before recording a result.")
              const priorRows = await transaction
                .select()
                .from(DatabaseSchema.rankedResults)
                .where(eq(DatabaseSchema.rankedResults.matchId, completion.matchId))
                .limit(1)
              if (priorRows[0] !== undefined) {
                return {
                  applied: false,
                  winner: playerFrom(winner, winnerGithub),
                  loser: playerFrom(loser, loserGithub),
                }
              }
              const ratings = Elo.apply(winner.rating, loser.rating)
              const completedAt = new Date(completion.completedAt)
              await transaction.insert(DatabaseSchema.rankedResults).values({
                matchId: completion.matchId,
                winnerId: completion.winnerId,
                loserId: completion.loserId,
                reason: completion.reason,
                winnerRatingBefore: winner.rating,
                loserRatingBefore: loser.rating,
                winnerRatingAfter: ratings.winner,
                loserRatingAfter: ratings.loser,
                completedAt,
              })
              const updatedWinners = await transaction
                .update(DatabaseSchema.players)
                .set({
                  rating: ratings.winner,
                  wins: winner.wins + 1,
                  games: winner.games + 1,
                  updatedAt: completedAt,
                })
                .where(eq(DatabaseSchema.players.id, completion.winnerId))
                .returning()
              const updatedLosers = await transaction
                .update(DatabaseSchema.players)
                .set({
                  rating: ratings.loser,
                  losses: loser.losses + 1,
                  games: loser.games + 1,
                  updatedAt: completedAt,
                })
                .where(eq(DatabaseSchema.players.id, completion.loserId))
                .returning()
              const updatedWinner = updatedWinners[0]
              const updatedLoser = updatedLosers[0]
              if (updatedWinner === undefined || updatedLoser === undefined)
                throw new Error("Ranked player updates returned no rows.")
              return {
                applied: true,
                winner: playerFrom(updatedWinner, winnerGithub),
                loser: playerFrom(updatedLoser, loserGithub),
              }
            })
          }),
        retirePlayer: (playerId, completion) =>
          attempt("retirePlayer", async () =>
            database.transaction(async (transaction) => {
              const targetRows = await transaction
                .select()
                .from(DatabaseSchema.players)
                .where(eq(DatabaseSchema.players.id, playerId))
                .for("update")
              const target = targetRows[0]
              if (target === undefined || target.deletedAt !== null) return { retired: false }

              if (completion !== undefined) {
                if (completion.winnerId === completion.loserId)
                  throw new Error("A ranked result requires distinct players.")
                const playerIds = [completion.winnerId, completion.loserId].sort()
                const lockedPlayers = await transaction
                  .select()
                  .from(DatabaseSchema.players)
                  .where(
                    and(
                      inArray(DatabaseSchema.players.id, playerIds),
                      isNull(DatabaseSchema.players.deletedAt),
                    ),
                  )
                  .orderBy(asc(DatabaseSchema.players.id))
                  .for("update")
                const byId = new Map(lockedPlayers.map((row) => [row.id, row]))
                const winner = byId.get(completion.winnerId)
                const loser = byId.get(completion.loserId)
                if (winner === undefined || loser === undefined)
                  throw new Error("Both ranked players must be active before retirement settlement.")
                const prior = await transaction
                  .select({ matchId: DatabaseSchema.rankedResults.matchId })
                  .from(DatabaseSchema.rankedResults)
                  .where(eq(DatabaseSchema.rankedResults.matchId, completion.matchId))
                  .limit(1)
                if (prior[0] === undefined) {
                  const ratings = Elo.apply(winner.rating, loser.rating)
                  const completedAt = new Date(completion.completedAt)
                  await transaction.insert(DatabaseSchema.rankedResults).values({
                    matchId: completion.matchId,
                    winnerId: completion.winnerId,
                    loserId: completion.loserId,
                    reason: completion.reason,
                    winnerRatingBefore: winner.rating,
                    loserRatingBefore: loser.rating,
                    winnerRatingAfter: ratings.winner,
                    loserRatingAfter: ratings.loser,
                    completedAt,
                  })
                  await transaction
                    .update(DatabaseSchema.players)
                    .set({
                      rating: ratings.winner,
                      wins: winner.wins + 1,
                      games: winner.games + 1,
                      updatedAt: completedAt,
                    })
                    .where(eq(DatabaseSchema.players.id, completion.winnerId))
                  await transaction
                    .update(DatabaseSchema.players)
                    .set({
                      rating: ratings.loser,
                      losses: loser.losses + 1,
                      games: loser.games + 1,
                      updatedAt: completedAt,
                    })
                    .where(eq(DatabaseSchema.players.id, completion.loserId))
                }
              }

              const retiredAt = new Date()
              await transaction
                .delete(DatabaseSchema.sessions)
                .where(eq(DatabaseSchema.sessions.playerId, playerId))
              await transaction
                .delete(DatabaseSchema.githubIdentities)
                .where(eq(DatabaseSchema.githubIdentities.playerId, playerId))
              await transaction
                .update(DatabaseSchema.players)
                .set({
                  displayName: null,
                  anonymous: true,
                  deletedAt: retiredAt,
                  updatedAt: retiredAt,
                })
                .where(eq(DatabaseSchema.players.id, playerId))
              return { retired: true }
            }),
          ),
        leaderboard: attempt("leaderboard", async () => {
          const rows = await database
            .select({ player: DatabaseSchema.players, github: DatabaseSchema.githubIdentities })
            .from(DatabaseSchema.players)
            .innerJoin(
              DatabaseSchema.githubIdentities,
              eq(DatabaseSchema.githubIdentities.playerId, DatabaseSchema.players.id),
            )
            .where(
              and(gt(DatabaseSchema.players.games, 0), isNull(DatabaseSchema.players.deletedAt)),
            )
            .orderBy(
              desc(DatabaseSchema.players.rating),
              desc(DatabaseSchema.players.wins),
              asc(DatabaseSchema.players.displayName),
              asc(DatabaseSchema.players.id),
            )
          return rows.map((row, index) => {
            const player = playerFrom(row.player, row.github)
            return {
              rank: index + 1,
              identity: Identity.publicIdentity(player),
              rating: player.rating,
              wins: player.wins,
              losses: player.losses,
              games: player.games,
            }
          })
        }),
        rankedResult: (matchId) =>
          attempt("rankedResult", async () => {
            const rows = await database
              .select()
              .from(DatabaseSchema.rankedResults)
              .where(eq(DatabaseSchema.rankedResults.matchId, matchId))
              .limit(1)
            const row = rows[0]
            return row === undefined ? undefined : resultFrom(row)
          }),
      })
    }),
  )

export const layer = (databaseUrl: string, migrationsPath = "drizzle") =>
  Layer.effect(Storage, make(databaseUrl, migrationsPath))
