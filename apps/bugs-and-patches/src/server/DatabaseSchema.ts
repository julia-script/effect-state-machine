import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const rankedResultReason = pgEnum("ranked_result_reason", ["Uptime", "Surrender", "Forfeit"])

export const players = pgTable("players", {
  id: uuid("id").defaultRandom().primaryKey(),
  displayName: text("display_name"),
  anonymous: boolean("anonymous").notNull().default(false),
  rating: integer("rating").notNull().default(1000),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  games: integer("games").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
})

export const githubIdentities = pgTable("github_identities", {
  githubId: text("github_id").primaryKey(),
  playerId: uuid("player_id")
    .notNull()
    .unique()
    .references(() => players.id, { onDelete: "cascade" }),
  login: text("login").notNull(),
  avatarUrl: text("avatar_url").notNull(),
  profileUrl: text("profile_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
})

export const sessions = pgTable(
  "sessions",
  {
    tokenDigest: text("token_digest").primaryKey(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [index("sessions_expiry").on(table.expiresAt)],
)

export const rankedResults = pgTable("ranked_results", {
  matchId: text("match_id").primaryKey(),
  winnerId: uuid("winner_id")
    .notNull()
    .references(() => players.id),
  loserId: uuid("loser_id")
    .notNull()
    .references(() => players.id),
  reason: rankedResultReason("reason").notNull(),
  winnerRatingBefore: integer("winner_rating_before").notNull(),
  loserRatingBefore: integer("loser_rating_before").notNull(),
  winnerRatingAfter: integer("winner_rating_after").notNull(),
  loserRatingAfter: integer("loser_rating_after").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }).notNull(),
})
