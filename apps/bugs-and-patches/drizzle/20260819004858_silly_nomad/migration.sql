ALTER TABLE "players" ADD COLUMN "id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "players"
SET "display_name" = CASE
	WHEN CHAR_LENGTH(LEFT("login", 24)) >= 2 THEN LEFT("login", 24)
	ELSE LEFT("login" || '_', 24)
END;--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
CREATE TABLE "github_identities" (
	"github_id" text PRIMARY KEY,
	"player_id" uuid NOT NULL UNIQUE,
	"login" text NOT NULL,
	"avatar_url" text NOT NULL,
	"profile_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
INSERT INTO "github_identities" (
	"github_id", "player_id", "login", "avatar_url", "profile_url", "created_at", "updated_at"
)
SELECT "github_id", "id", "login", "avatar_url", "profile_url", "created_at", "updated_at"
FROM "players";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "player_id" uuid;--> statement-breakpoint
UPDATE "sessions" AS "session"
SET "player_id" = "player"."id"
FROM "players" AS "player"
WHERE "session"."github_id" = "player"."github_id";--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "player_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ranked_results" ADD COLUMN "winner_player_id" uuid;--> statement-breakpoint
ALTER TABLE "ranked_results" ADD COLUMN "loser_player_id" uuid;--> statement-breakpoint
UPDATE "ranked_results" AS "result"
SET "winner_player_id" = "winner"."id", "loser_player_id" = "loser"."id"
FROM "players" AS "winner", "players" AS "loser"
WHERE "result"."winner_id" = "winner"."github_id"
	AND "result"."loser_id" = "loser"."github_id";--> statement-breakpoint
ALTER TABLE "ranked_results" ALTER COLUMN "winner_player_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ranked_results" ALTER COLUMN "loser_player_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ranked_results" DROP CONSTRAINT "ranked_results_winner_id_players_github_id_fkey";--> statement-breakpoint
ALTER TABLE "ranked_results" DROP CONSTRAINT "ranked_results_loser_id_players_github_id_fkey";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_github_id_players_github_id_fkey";--> statement-breakpoint
ALTER TABLE "players" DROP CONSTRAINT "players_pkey";--> statement-breakpoint
ALTER TABLE "ranked_results" DROP COLUMN "winner_id";--> statement-breakpoint
ALTER TABLE "ranked_results" DROP COLUMN "loser_id";--> statement-breakpoint
ALTER TABLE "ranked_results" RENAME COLUMN "winner_player_id" TO "winner_id";--> statement-breakpoint
ALTER TABLE "ranked_results" RENAME COLUMN "loser_player_id" TO "loser_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "github_id";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "github_id";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "login";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "avatar_url";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "profile_url";--> statement-breakpoint
ALTER TABLE "players" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "github_identities" ADD CONSTRAINT "github_identities_player_id_players_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ranked_results" ADD CONSTRAINT "ranked_results_winner_id_players_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "players"("id");--> statement-breakpoint
ALTER TABLE "ranked_results" ADD CONSTRAINT "ranked_results_loser_id_players_id_fkey" FOREIGN KEY ("loser_id") REFERENCES "players"("id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE;
