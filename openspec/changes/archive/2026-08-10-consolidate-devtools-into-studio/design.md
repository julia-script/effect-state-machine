# Design — consolidate devtools into Studio

## Context

See proposal.md for motivation. Relevant current state:

- `src/DevToolsSession.ts` already separates wire-safe data from closures: quick events split into announceable controls vs app-side values/factories, and custom events arrive as `unknown` and decode via `Machine.decodeEvent`. Its fact ingestion + semantic folding (`appendInspection`) is pure and relocatable; its view state (cursor, focus depth, selected step) is per-viewer and must not survive in a remote protocol.
- `src/DevToolsViewer.ts` (vanilla DOM) is superseded by the design handoff (`Interactive devtools redesign` — README + interactive prototype) and gets deleted.
- Effect is pinned to `4.0.0-beta.106`; v4 folds platform into `effect` (`effect/unstable/http`, `effect/unstable/socket`). The repo already validates with `@effect/vitest`.
- Reference styleguides: the `effect-patterns` skill (services, layers, boundaries, module layout) and `style-effect-atom` (atom lifecycle, registries, runtimes) govern how Effect and atom code is written throughout.

## Goals / Non-Goals

**Goals:**
- One protocol seam (`StudioTransport`) that a future Chrome extension can implement without touching client, folding, or UI code.
- Studio usable with zero configuration: `attach` in the app, one CLI command, open a browser.
- Core package keeps exactly one runtime dependency (`effect`).

**Non-Goals:**
- Pixel-perfect reproduction of the design prototype — structure, tokens, and interactions carry over; sizing is Tailwind-native.
- Chrome extension, history persistence to disk, remote (non-localhost) access, authentication.
- Child-machine navigation UX (protocol reserves room; UI ships root-machine sessions only).

## Decisions

### 1. Monorepo: three packages
pnpm workspace: `packages/core` (the existing library minus viewer/session view-state), `packages/studio-client` (protocol schemas + folding + attach + transports), `packages/studio` (CLI + server + Vite React UI). The protocol lives inside `studio-client` rather than a fourth package — `studio` depends on `studio-client` anyway (schemas + folding), and a package that only holds schemas is premature. Rejected: keeping the client as a `core` subpath (drags protocol code into core's build and blurs its single-dependency guarantee). Whether core later re-exports a convenience subpath stays open.

### 2. Wire format: a tagged message union, not RPC
Messages are one Schema-defined discriminated union (`Hello`, `Fact`, `Dispatch`, `DispatchOutcome`, `SessionEnded`, …), JSON-encoded, sent over any duplex message channel. Rejected: `effect/unstable/rpc` — it buys typed request/response but couples both ends to its protocol layers, while the extension transport (browser port messaging) wants plain messages; dispatch outcomes are the only request/response pair and a correlation id covers them. Every message carries `sessionId`; `Hello` carries `protocolVersion` (integer, checked on receipt), app identity, machine metadata, the serialized graph (reusing `Graph.fromDefinition` output + serialized source locations), and JSON Schemas produced app-side via `effect/JSONSchema` — Studio never holds live Schema objects.

### 3. Transport is a duplex-stream service on both ends
`StudioTransport` (client) and the server's UI-side twin expose the same shape: an outbound sink and an inbound stream of protocol messages, plus connection status. Implementations: WebSocket (default, `effect/unstable/socket`), in-memory (tests — client and a fake studio share a pair of queues). Reconnect/backoff and buffering live above the transport in the client, so every transport gets them for free.

### 4. Topology: server is a relay with a history buffer, session model lives in the UI
Apps and browser viewers both connect via WebSocket to one server (single port; role declared on connect). The server keeps a registry (session → owning app connection) and a bounded per-session ring buffer of facts (default on the order of 10k facts; truncation flag when dropped), replayed to any newly connected viewer. Folding into semantic steps and all view state (cursor, depth, zoom, theme) happen in the UI — two viewers get independent cursors, and cursor movement costs no I/O. The folding reducer moves from `DevToolsSession` into a pure module in `studio-client`, consumed by the UI and unit-tested without any transport.

### 5. Client attach: current shape minus projections, resilience built in
`attach({ definition, handle, quickEvents? })` — scoped, observational, machine never interrupted (same contract as today's `DevToolsSession.attach`). `projectState`/`projectEvent` are dropped; the UI renders schema-encoded state/event JSON. Connection is lazy with a retry schedule; facts buffer (bounded, drop-oldest with count) while disconnected; every failure path terminates inside the client — nothing escalates into the app. Dispatch handling reuses today's logic verbatim: `handle.can` gate, factory evaluation in the app, `Machine.decodeEvent` for custom events; failures become `DispatchOutcome` messages instead of view-state fields.

### 6. Server implementation
`effect/unstable/http` HttpServer on `127.0.0.1` only (localhost binding is the security boundary — no auth needed because nothing is exposed), default port 4747, `--port`/env override. Serves the built UI as static assets; WebSocket upgrade for app and viewer connections. Editor-open executes a configured command (`cursor`/`code` CLI, `--editor` flag or config) with `file:line`, reporting failure so the UI falls back to copy. CLI is a thin Effect program — argument parsing kept minimal.

### 7. UI stack and state
Vite + React + `@effect/atom-react` + Tailwind v4 (first-party Vite plugin, CSS-first `@theme`). The design handoff's token set (OKLCH palette, pear/indigo dark swap, hard shadows, three font families — bundled, not fetched from Google Fonts) becomes one `@theme` block; dark theme is a `data-theme="dark"` variable override, no `dark:` prefixes in components. Connection, sessions, and folded history are atoms fed by the viewer transport; per-session view state (cursor, depth, zoom) are plain atoms keyed by session. Graph layout logic ports from `DevToolsViewer.ts` (the useful ~300 lines: BFS layering, fit-view-box) into React/SVG components.

## Risks / Trade-offs

- [Effect v4 beta churn across `unstable/http|socket`] → all packages pin the same beta; upgrades happen repo-wide in one commit; transports are the only modules touching unstable networking APIs.
- [Unbounded machines could blow the client/server buffers] → both buffers bounded drop-oldest with an explicit truncation signal specced end-to-end.
- [Schema-encoded snapshots may be large or non-encodable for exotic states] → states are already required to be Schema-defined; encoding failures surface as a per-fact error rather than killing the session.
- [Design prototype interactions may hide edge cases the README omits] → the interactive prototype stays in the repo's change folder as reference; UI tasks cite specific README sections.
- [Deleting the in-page dock removes the zero-setup path] → accepted; `attach` + one CLI command is the new minimum, and the extension transport later restores in-browser convenience.

## Open Questions

- Child-machine sessions: sibling sessions with a parent reference vs. nested navigation — `Hello` reserves an optional `parentSessionId`; decision deferred until multimachine UX work.
- Whether `effect-state-machine` re-exports the client from a subpath for one-dependency ergonomics.
- History persistence across server restarts (write buffer to disk) — out of scope; revisit with real usage.
