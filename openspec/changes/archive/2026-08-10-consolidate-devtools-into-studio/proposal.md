# Consolidate devtools into Studio

## Why

The devtools currently aim at two divergent deliverables — an in-page dock viewer (`DevToolsViewer`, vanilla DOM) and a future external host — sharing one in-process session. Maintaining two hosts doubles UI work while the in-process design blocks the more valuable cases (Node processes, multiple apps, a future Chrome extension). A single standalone **Studio** app, connected over an abstracted transport, replaces both.

## What Changes

- **BREAKING**: Remove the in-page viewer (`DevToolsViewer.ts`, the `/devtools/viewer` export) and the in-process session's viewer-facing surface. The in-page dock use case is discontinued.
- **BREAKING**: Remove `projectState` / `projectEvent` from the attach API. Studio renders schema-encoded state and event JSON; arbitrary in-process projections have no remote consumer.
- Convert the repository to a pnpm monorepo: `packages/core` (existing library, devtools UI removed), `packages/studio-client` (app-facing attach + protocol + transports), `packages/studio` (CLI, local server, React UI).
- Define a versioned wire protocol: facts out (hello with serialized graph + JSON schemas, inspection events, committed states, completion), dispatches in (quick event by id, custom event as JSON). Every message carries a `sessionId`. View state (cursor, focus depth, zoom) never crosses the wire.
- Abstract the connection as an Effect service (`StudioTransport`) with WebSocket as the first implementation and in-memory for tests; a Chrome-extension transport can be added later without touching client or UI logic.
- Ship the Studio app: a CLI command starts a local server that accepts app WebSocket connections, buffers session history for replay, serves the built UI, and relays dispatches. UI is Effect + Vite + React + `@effect/atom-react` + Tailwind v4, following the design handoff (`Interactive devtools redesign` — layout, tokens, dark theme, interactions; Tailwind-native sizing, not pixel-perfect).
- Keep the user-facing attach shape: connect a machine handle + definition, optionally provide quick events; the client handles connecting to Studio and must be inert (non-blocking, silently retrying) when Studio is not running.
- Multi-machine support is designed into the protocol (`sessionId`, hello identity) from day one; child-machine navigation UX is deferred.

## Capabilities

### New Capabilities

- `studio-protocol`: the versioned message vocabulary between apps and Studio — session identity, hello payload (machine metadata, serialized graph, JSON schemas), inspection facts, state commits, completion, and inbound dispatches.
- `studio-client`: the app-facing attach API, serialization of facts, dispatch handling (quick-event factories, custom-event decoding), the `StudioTransport` service seam, and no-studio resilience guarantees.
- `studio-server`: the CLI-launched local server — app connection registry, per-session history buffering and replay, UI relay, static UI serving, and editor-open source actions.
- `studio-ui`: the Studio interface — session/machine picker, behavior map with depth control and detail cards, state panel with diff, quick/custom event dispatch, semantic history with time travel, theming.

### Modified Capabilities

None — no prior specs exist; core machine behavior is unchanged.

## Impact

- **Removed**: `src/DevToolsViewer.ts`, `src/devtools-viewer.ts`, the `./devtools/viewer` package export, `projectState`/`projectEvent` options, session-owned view state (`setFocusDepth`, cursor APIs move into the Studio UI).
- **Moved/refactored**: `DevToolsSession`'s fact ingestion and semantic-step folding split across studio-client (emit) and studio-ui (fold + view model); `Graph`, `SourceLocation` serialization reused by the protocol.
- **New dependencies**: studio packages only — Vite, React, `@effect/atom-react`, Tailwind v4, Effect `unstable/http`/`socket` (and possibly `unstable/rpc`). Core keeps its single `effect` peer dependency.
- **Tooling**: root becomes a pnpm workspace; build/check scripts split per package; examples update to the new attach import.
- Effect remains pinned to the 4.0 beta across packages; studio additionally depends on unstable modules, accepted while v4 stabilizes.
