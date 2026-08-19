# Bugs & Patches demo

This private workspace is a server-authoritative multiplayer demo for `effect-state-machine`. Card balance is deliberately provisional. The React client implements the supplied Bugs & Patches visual handoff while keeping every match transition and legal action authoritative on the server.

## Game and match modes

- Two players begin with 100 Uptime, separately shuffled 30-card Stacks, and five-card hands. A randomly chosen first player draws once more.
- A turn offers one Bug, one optional Patch response from the opponent, and one optional Side Effect. The relevant player may pass each phase.
- Bugs deal `max(attack - defense, 0)` base damage. Secondary abilities then resolve in printed order unless the Patch cancels them.
- Card costs reduce the owner's Uptime, but a card cannot be played if its cost would leave the owner below 1 Uptime.
- Victory is checked after base damage and after each side's secondary abilities. A player loses at 0 Uptime or by surrendering.

Every player signs in with GitHub. **Friendly** matches use an invite code and never affect rankings. **Ranked** matches pair distinct accounts from the random process-local queue. A Ranked player who disconnects while their opponent remains connected has 60 seconds to reconnect before forfeiting.

Signed-in players can also choose **Challenge your agent** inside Friendly play. The server creates a ten-minute capability link for one ephemeral AI-agent opponent. The first agent to claim it receives only its own authoritative player projection and server-issued opaque legal actions through remote MCP. Agent matches use the same Stack and match machine, never create an account, and never affect ratings or Top Contributors.

The public leaderboard is titled **Top Contributors**, with the subtitle **to production incidents**. A player appears after completing one Ranked match. A non-anonymous player exposes their GitHub login, avatar, and profile URL there and in match views; an anonymous player exposes only their in-game display name and a neutral avatar. GitHub access tokens, application sessions, immutable numeric IDs, seat tokens, and private card state are never public.

## Local PostgreSQL 17

Start the development database once from any directory:

```sh
docker run --name bugs-and-patches-postgres \
  --detach \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_DB=bugs_and_patches \
  --env POSTGRES_USER=bugs_and_patches \
  --env POSTGRES_PASSWORD=bugs_and_patches_dev \
  --volume bugs-and-patches-postgres-data:/var/lib/postgresql/data \
  postgres:17
```

On later runs use `docker start bugs-and-patches-postgres`. The local connection URL is:

```sh
export DATABASE_URL="postgresql://bugs_and_patches:bugs_and_patches_dev@127.0.0.1:55432/bugs_and_patches"
```

The server applies checked-in Drizzle migrations before it starts listening. After changing `src/server/DatabaseSchema.ts`, generate the next migration from the repository root with:

```sh
pnpm --filter @effect-state-machine/bugs-and-patches db:generate
```

Review and commit the generated `drizzle/` files. Runtime storage operations use Drizzle; application code does not maintain a second handwritten SQL schema.

## Local development

Keep the local server variables in the ignored `apps/bugs-and-patches/.env.local` file. The `dev:server` command builds the server and asks Node to load that file automatically. During local development Vite proxies `/auth`, `/api`, and `/game` to the authoritative server, so same-origin browser URLs such as `http://localhost:5173/auth/github` are expected.

Run the client and authoritative server in separate terminals from the repository root:

```sh
pnpm --filter @effect-state-machine/bugs-and-patches dev
```

```sh
pnpm --filter @effect-state-machine/bugs-and-patches dev:server
```

The first command serves the Vite client at `http://127.0.0.1:5173`; the second serves the API and WebSocket endpoint at `http://127.0.0.1:4788`. Use that exact client URL rather than `localhost`: the OAuth session cookie is issued by `127.0.0.1` and browser cookies do not cross between those two hostnames.

The client provides the public How to Play, Stack, and Top Contributors pages plus authenticated lobby, battle, and settings routes. Its battle view renders only the latest decoded server projection and enables only the legal actions supplied with that projection. It does not implement chat, emotes, rematches, or deck editing.

## Card artwork

The 16 current card illustrations come from the supplied Bugs & Patches design handoff. The handoff archive is treated as visual reference material: its HTML and JavaScript are not executed or bundled. Only the required SVG files were copied after a scan for scripts, event handlers, remote references, `foreignObject`, executable URLs, and CSS imports. See [ASSET-AUDIT.md](./ASSET-AUDIT.md) for the findings, filename aliases, and fallback-art policy.

## Profile privacy and account deletion

Settings let a signed-in player change their 2–24 character in-game display name and independently hide or reveal their linked GitHub identity. Anonymity applies to every public projection, including live matches and Top Contributors; the player can still see their own linked account in settings.

Account deletion requires a second explicit confirmation. The server serializes deletion with queue and live-match state, removes waiting invitations, treats retirement from an active match as a canonical surrender, revokes every session and seat, unlinks GitHub, and removes the player from Top Contributors. Completed match rows remain only as anonymous historical records attached to an internal retired-player tombstone. Signing in with that GitHub account later creates a fresh player at the initial rating.

## GitHub OAuth App setup

Create an OAuth App under GitHub **Settings → Developer settings → OAuth Apps**. For local development use:

- Homepage URL: `http://127.0.0.1:5173`
- Authorization callback URL: `http://127.0.0.1:4788/auth/github/callback`

For production, the homepage is `https://bugsandpatches.jlort.com` and the authorization callback is `https://bugsandpatches-api.jlort.com/auth/github/callback`.

The app requests no OAuth scopes and reads only GitHub's public `/user` response. Authorization uses CSRF state and PKCE. The GitHub access token is discarded immediately after that profile fetch; only an opaque, digested application session remains. Sessions use a fixed lifetime rather than sliding renewal.

Required server-only variables:

```sh
export BUGS_PATCHES_GITHUB_CLIENT_ID="your OAuth App client ID"
export BUGS_PATCHES_GITHUB_CLIENT_SECRET="your OAuth App client secret"
export BUGS_PATCHES_CLIENT_URL="http://127.0.0.1:5173"
export BUGS_PATCHES_SERVER_URL="http://127.0.0.1:4788"
export DATABASE_URL="postgresql://bugs_and_patches:bugs_and_patches_dev@127.0.0.1:55432/bugs_and_patches"
```

Optional server configuration:

- `BUGS_PATCHES_GITHUB_CALLBACK_URL` defaults to `$BUGS_PATCHES_SERVER_URL/auth/github/callback` and must remain on the server origin.
- `BUGS_PATCHES_MIGRATIONS_PATH` defaults to `dist/server/drizzle`.
- `BUGS_PATCHES_SESSION_DURATION_MS` defaults to seven days.
- `BUGS_PATCHES_OAUTH_ATTEMPT_DURATION_MS` defaults to ten minutes.
- `BUGS_PATCHES_COOKIE_NAME` defaults to `bugs_patches_session`.
- `BUGS_PATCHES_HOST`, `BUGS_PATCHES_PORT`, and `BUGS_PATCHES_UI_ROOT` configure serving.
- `BUGS_PATCHES_STUDIO=1` explicitly enables Studio attachment; `BUGS_PATCHES_STUDIO_URL` changes its URL.
- `BUGS_PATCHES_AGENT_CHALLENGES_ENABLED=1` enables challenge creation and the public MCP route. It is disabled by default.
- `BUGS_PATCHES_CHALLENGE_ORIGIN` is the externally reachable HTTPS origin used in shared links and defaults to `BUGS_PATCHES_SERVER_URL`.
- `BUGS_PATCHES_CHALLENGE_LIFETIME_MS` defaults to ten minutes; unclaimed links expire after this duration.
- `BUGS_PATCHES_AGENT_PRESENCE_MS` defaults to 45 seconds without an MCP call before the agent appears disconnected.
- `BUGS_PATCHES_AGENT_WAIT_MAX_MS` caps `wait_for_turn` at 25 seconds.
- `BUGS_PATCHES_MCP_MAX_BODY_BYTES` defaults to 64 KiB and `BUGS_PATCHES_MCP_REQUESTS_PER_MINUTE` defaults to 120 requests per remote address and capability.

The client has one public build-time variable:

```sh
export VITE_BUGS_PATCHES_SERVER_URL="http://127.0.0.1:4788"
```

Both client and server validate configured origins. Non-loopback production origins must use HTTPS. Credentialed HTTP uses `credentials: include`; CORS and WebSocket upgrades accept only `BUGS_PATCHES_CLIENT_URL`. Cookies are HttpOnly, Secure in production, SameSite=Lax, and scoped to the game-server host. Production client and server hosts should therefore remain under `jlort.com` so they are same-site.

## Run locally

In one terminal, build and start the authoritative server:

```sh
pnpm --filter @effect-state-machine/bugs-and-patches build:server
pnpm --filter @effect-state-machine/bugs-and-patches start
```

In a second terminal, start the Vite client:

```sh
VITE_BUGS_PATCHES_SERVER_URL=http://127.0.0.1:4788 \
  pnpm --filter @effect-state-machine/bugs-and-patches dev
```

Open `http://127.0.0.1:5173`, sign in, then use a second GitHub account in another browser profile to play. One account cannot occupy both Friendly seats or be paired with itself in Ranked play. Vite's local proxy remains available, while `VITE_BUGS_PATCHES_SERVER_URL` exercises the same split-origin shape used in production.

## Vercel client

Create a Vercel project with `apps/bugs-and-patches` as its Root Directory. The checked-in `vercel.json` builds only the browser client and publishes `dist/client`.

Set only this public build-time value in Vercel:

- `VITE_BUGS_PATCHES_SERVER_URL=https://bugsandpatches-api.jlort.com`

Do not add `DATABASE_URL` or GitHub OAuth credentials to the client project. After choosing or changing the server hostname, update this variable and redeploy the client.

## Coolify game server and PostgreSQL

Create one PostgreSQL 17 resource and one Dockerfile application in the same Coolify project/environment and destination network. Configure the application to build from the repository root with `apps/bugs-and-patches/Dockerfile`, expose port `4788`, use `/health` as its health check, and run a single replica. Multiple replicas would create independent queues and match registries.

Set these runtime-only application variables:

- `DATABASE_URL` using the PostgreSQL resource's private-network connection URL
- `BUGS_PATCHES_GITHUB_CLIENT_ID`
- `BUGS_PATCHES_GITHUB_CLIENT_SECRET`
- `BUGS_PATCHES_CLIENT_URL=https://bugsandpatches.jlort.com`
- `BUGS_PATCHES_SERVER_URL=https://bugsandpatches-api.jlort.com`

The image contains the server bundle and checked-in migrations but no browser client. Startup fails closed if PostgreSQL is unavailable or a migration fails. Coolify's stop/redeploy signal unwinds the scoped server and closes its bounded PostgreSQL pool.

Enable scheduled PostgreSQL backups in Coolify and test a restore before relying on them. For a manual logical backup, use `pg_dump` against the database resource rather than copying container files. Completed Ranked results, ratings, profiles, and sessions survive server restarts; active matches, private seats, OAuth attempts, and the Ranked queue are process-local and are lost.

For a fresh deployment or hostname change:

1. Route it to the Coolify application with HTTPS.
2. Set `BUGS_PATCHES_SERVER_URL` and redeploy the server.
3. Register the server origin plus `/auth/github/callback` in GitHub.
4. Set the same origin in Vercel's `VITE_BUGS_PATCHES_SERVER_URL` and redeploy the client.
5. Run a two-account Friendly and Ranked smoke test.

Treat steps 2–4 as one coordinated cutover: the server must accept the final Vercel origin, GitHub must accept the final server callback, and the Vercel bundle must target that same server origin. Keep the previous deployment available until sign-in, credentialed profile reads, WebSocket upgrade, and one two-account match have all passed on the new pair of origins.

### Challenge your agent deployment

Keep agent challenges disabled for the first production deployment. Challenge links are bearer credentials embedded in `/challenge/<capability>` paths, so the Coolify/Traefik router for that path must have access logging disabled before the feature is enabled. Follow [COOLIFY-AGENT-CHALLENGES.md](./COOLIFY-AGENT-CHALLENGES.md) for the custom-label template, canary log check, activation, and rollback sequence.

Open challenge links and active agent matches are process-local and disappear on restart. A link is Friendly-only, single-seat, non-enumerable, and cannot authenticate browser, GitHub, profile, Ranked, or leaderboard-mutation operations. The server stores only the capability digest; the URL is reconstructed while the process is alive. The creator can revoke an unclaimed link, and a completed capability can read only the final agent projection.

Compatible remote-MCP hosts can connect the shared URL directly. The URL also serves a human landing page, Markdown instructions, or JSON discovery through content negotiation. A host that cannot attach a remote server automatically must add the same URL manually. The tools are:

- `accept_challenge(agent_name)` — atomically claim the ephemeral opponent seat.
- `get_match()` — read the agent’s projected state and current opaque actions.
- `wait_for_turn(after_revision?, timeout_seconds?)` — long-poll for one bounded interval.
- `take_action(action_id)` — execute one action from the current revision.
- `surrender()` — deliberately finish the match with the agent as loser.

The server does not provide model inference or strategy. An external agent chooses only among the canonical legal actions issued for its current revision.

## Client protocol

The authenticated WebSocket endpoint is `/game`. Entry messages are `CreateFriendly`, `JoinFriendly`, `JoinRankedQueue`, `LeaveRankedQueue`, and `Reconnect`. Match actions remain `PlayBug`, `PassBug`, `PlayPatch`, `PassPatch`, `PlaySideEffect`, `PassSideEffect`, and `Surrender`.

Agent challenge creator messages add `CreateAgentChallenge` and `RevokeAgentChallenge`; server responses add `AgentChallengeCreated` and `AgentChallengeUpdated`. The capability itself is never accepted over the browser WebSocket.

`src/protocol/Protocol.ts` is the wire schema and `src/protocol/View.ts` is the privacy boundary. The server derives the durable account from the application-session cookie and requires that account plus the private seat credential for reconnects and commands.
