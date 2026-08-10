## 1. Monorepo restructure

- [x] 1.1 Convert to pnpm workspace: move the existing library to `packages/core` (source, tests, scripts, tsconfig), add root `pnpm-workspace.yaml`, keep root-level biome/vitest config working across packages
- [x] 1.2 Scaffold `packages/studio-client` (Effect-only, depends on core) and `packages/studio` (private, CLI bin entry) with per-package build/typecheck/test scripts wired into root `check`
- [x] 1.3 Delete `src/DevToolsViewer.ts`, `src/devtools-viewer.ts`, the `./devtools/viewer` export, and the interactive-devtools example page assets; verify core builds with only the `.` and `./devtools` entries it still needs

## 2. Protocol and shared session model (studio-client)

- [x] 2.1 Define the protocol message union with Schema: `Hello` (protocolVersion, sessionId, optional parentSessionId, app identity, machine metadata, serialized graph, JSON Schemas per state/event/invocation outcome), `Fact` (inspection event | schema-encoded state commit | terminal status), `Dispatch` (quick by id | custom JSON, correlation id), `DispatchOutcome`, `SessionEnded`, truncation notice
- [x] 2.2 Implement announcement serialization: reuse `Graph.fromDefinition` + source locations, derive JSON Schemas app-side via `effect/JSONSchema`; encoding failure of a state snapshot becomes a per-fact error, not a session kill
- [x] 2.3 Extract the pure semantic-step folding from `DevToolsSession.appendInspection` into a shared module operating on protocol facts; port its behavior with unit tests (event/transition merge, invocation retries, children, completion, defect)
- [x] 2.4 Remove `DevToolsSession` view state (cursor/focus/selectPosition/setFocusDepth) and the `projectState`/`projectEvent` options from core's devtools surface

## 3. Client attach and transports

- [x] 3.1 Define `StudioTransport` service (outbound sink, inbound message stream, connection status) with the in-memory implementation and a transport-level contract test
- [x] 3.2 Implement `attach({ definition, handle, quickEvents? })`: scoped observation of handle changes/inspection/completion, fact emission, quick-event control announcement
- [x] 3.3 Implement resilience: lazy connect with retry schedule, bounded drop-oldest fact buffer with dropped-count reporting, all failures terminated internally (attach inert when Studio absent)
- [x] 3.4 Implement dispatch handling: quick-event lookup + factory + `handle.can` gate, custom-event `Machine.decodeEvent` + gate, every failure answered as `DispatchOutcome` with reason
- [x] 3.5 Implement the WebSocket transport (`effect/unstable/socket`) against the same contract test; end-to-end test attach → in-memory studio double covering announce, replay after late connect, dispatch round-trip

## 4. Studio server

- [x] 4.1 HTTP server on 127.0.0.1:4747 (flag/env override) with WebSocket upgrade for app and viewer roles; CLI bin that starts it and prints the UI URL
- [x] 4.2 Session registry and relay: route facts app→viewers and dispatches viewer→app with correlation, protocol-version check on `Hello`, disconnected sessions retained and marked
- [x] 4.3 Bounded per-session history ring buffer with truncation flag; replay to newly connected/reloaded viewers
- [x] 4.4 Static serving of the built UI; editor-open endpoint executing the configured editor command with failure reported to the viewer
- [x] 4.5 Server integration tests: two apps + late viewer replay, dispatch to disconnected session fails fast, version mismatch rejects only the offending session

## 5. Studio UI — foundation

- [x] 5.1 Vite + React + Tailwind v4 scaffold in `packages/studio`; port `tokens.css` palette into one `@theme` block with the handoff's dark-theme variable override on `data-theme="dark"`; bundle the three font families
- [x] 5.2 Viewer-side transport + connection atoms (`@effect/atom-react`): message stream → session registry atom, per-session fact log, folded semantic steps via the shared folding module; theme atom persisted to localStorage
- [x] 5.3 Top bar: session picker (app × machine), connection/status indicator, current-state pill, theme toggle, source-action select

## 6. Studio UI — panels

- [x] 6.1 Behavior map: SVG graph from announced data (port BFS layout + fit-view from the old viewer), active-state emphasis, traversed-edge animation honoring reduced motion, initial marker, depth stepper + All toggle, zoom cluster with Fit, graph JSON view
- [x] 6.2 Node/event detail cards: anchored popover with description, relations, source link, JSON Schema `<details>`, counter-scaled against zoom, one at a time
- [x] 6.3 State panel: schema-encoded state JSON with line diff toggle, event payload details, source link with editor/copy action via server
- [x] 6.4 Events panel: grouped quick-event chips with availability + time-travel disabling, custom-event editor (type select syncing JSON draft, validation, inline dispatch failure reasons)
- [x] 6.5 History panel: semantic step list with auto-scroll while live, local cursor time travel (incoming steps never move an inspecting cursor), Live/behind control, raw inspection records per step, truncation notice when history was dropped

## 7. Integration and cleanup

- [x] 7.1 Update `examples/` to the new attach import and add a runnable end-to-end walkthrough: example app + `studio` CLI + browser
- [x] 7.2 Update README/docs for the studio workflow and the monorepo layout; note the removed in-page viewer and dropped projection options
- [x] 7.3 Full `pnpm check` across the workspace green; manual pass of the UI against the design handoff README's interaction list
