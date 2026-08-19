# Coolify route for agent challenges

Agent challenge URLs contain a short-lived bearer capability in their path. The application logger is disabled, but a reverse proxy with access logging enabled can still retain that path. Production must route `/challenge/` through a dedicated higher-priority Traefik router whose access logs are disabled.

## Before enabling the feature

1. Choose the public HTTPS game-server origin and set both `BUGS_PATCHES_SERVER_URL` and `BUGS_PATCHES_CHALLENGE_ORIGIN` to it.
2. Leave `BUGS_PATCHES_AGENT_CHALLENGES_ENABLED=0` during the first deployment.
3. In Coolify, inspect the application’s generated labels to learn its real HTTPS entrypoint, service name, certificate resolver, and generated router name. Do not guess them.
4. Add a separate challenge router through the application’s **Custom Labels**, adapting the placeholders below to those generated values:

   ```text
   traefik.http.routers.<challenge-router>.rule=Host(`<game-server-host>`) && PathPrefix(`/challenge/`)
   traefik.http.routers.<challenge-router>.entrypoints=<https-entrypoint>
   traefik.http.routers.<challenge-router>.service=<generated-service>
   traefik.http.routers.<challenge-router>.tls=true
   traefik.http.routers.<challenge-router>.tls.certresolver=<generated-resolver>
   traefik.http.routers.<challenge-router>.priority=100
   traefik.http.routers.<challenge-router>.observability.accesslogs=false
   ```

   The access-log label is the security-critical line. Keep the ordinary application router for `/auth`, `/api`, `/game`, and `/health` unchanged.

5. Redeploy, request a nonexistent `/challenge/<canary>` URL, and confirm the request path appears in neither Traefik access logs nor application logs.
6. Enable `BUGS_PATCHES_AGENT_CHALLENGES_ENABLED=1`, restart the application, create one challenge, and repeat the log check with a real capability before sharing it with an external agent.

The Coolify API represents these labels in the application’s `custom_labels` field. Updating it and redeploying are external writes and must be performed against the resolved application UUID only after explicit confirmation.

## Rollback

Set `BUGS_PATCHES_AGENT_CHALLENGES_ENABLED=0` and restart the application. New challenge creation and every public challenge route fail closed. Existing process-local links and matches are invalidated by a server restart; no database rollback is needed.
