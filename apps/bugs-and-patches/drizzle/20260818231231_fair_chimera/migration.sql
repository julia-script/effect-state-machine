CREATE TYPE "ranked_result_reason" AS ENUM('Uptime', 'Surrender', 'Forfeit');--> statement-breakpoint
CREATE TABLE "players" (
	"github_id" text PRIMARY KEY,
	"login" text NOT NULL,
	"avatar_url" text NOT NULL,
	"profile_url" text NOT NULL,
	"rating" integer DEFAULT 1000 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranked_results" (
	"match_id" text PRIMARY KEY,
	"winner_id" text NOT NULL,
	"loser_id" text NOT NULL,
	"reason" "ranked_result_reason" NOT NULL,
	"winner_rating_before" integer NOT NULL,
	"loser_rating_before" integer NOT NULL,
	"winner_rating_after" integer NOT NULL,
	"loser_rating_after" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_digest" text PRIMARY KEY,
	"github_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sessions_expiry" ON "sessions" ("expires_at");--> statement-breakpoint
ALTER TABLE "ranked_results" ADD CONSTRAINT "ranked_results_winner_id_players_github_id_fkey" FOREIGN KEY ("winner_id") REFERENCES "players"("github_id");--> statement-breakpoint
ALTER TABLE "ranked_results" ADD CONSTRAINT "ranked_results_loser_id_players_github_id_fkey" FOREIGN KEY ("loser_id") REFERENCES "players"("github_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_github_id_players_github_id_fkey" FOREIGN KEY ("github_id") REFERENCES "players"("github_id") ON DELETE CASCADE;