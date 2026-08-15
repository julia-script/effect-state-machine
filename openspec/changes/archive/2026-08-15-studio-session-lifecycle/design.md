# Design: Studio Session Lifecycle

## Context

See proposal.md — Why. The relay ([Relay.ts](../../../packages/studio/src/server/Relay.ts)) already resumes transient socket drops: a re-`Hello` with a known `sessionId` keeps facts and `lastSequence`, and facts dedupe by sequence. Sessions live in a `Map` guarded by one semaphore permit; nothing ever deletes an entry. `attach` ([Attach.ts](../../../packages/studio-client/src/Attach.ts)) mints `crypto.randomUUID()` per call. The viewer world state ([ViewerClient.ts](../../../packages/studio-react/src/state/ViewerClient.ts)) folds `Hello`/`Fact`/`SessionDisconnected`/`SessionEnded` and its session array only grows.

## Goals / Non-Goals

Goals
- One picker entry per application lineage across reruns, without touching the working drop/reconnect resume path.
- A manual escape hatch (dismiss) for whatever supersede doesn't cover.

Non-Goals
- Resuming *history* across process restarts. A rerun's fresh sequence numbers would collide with the relay's `sequence <= lastSequence` dedup; solving that needs epochs and is not worth it — a rerun is a new execution, its predecessor's history describes a dead instance.
- TTL/expiry. Supersede plus dismiss covers the accumulation problem; time-based cleanup is speculative.
- Persisted identity (sessionStorage etc.). Derivation from static inputs is enough; nothing needs storage.

## Decisions

**D1 — Supersede, not resume, on rerun.** New `instanceKey` field on `Hello` (optional for wire compatibility). Relay on `Hello`: if another session holds the same key and is *not* `connected`, delete it and broadcast `SessionRemoved` before broadcasting the new `Hello`. Connected predecessors are never touched — two deliberate live instances stay two sessions, and the same-process double-attach case (same derived key, both connected) is safe by construction.
- Alternative considered: stable `sessionId` + resume (relay already supports it). Rejected: sequence-dedup landmine across restarts, and semantically wrong — the old history belongs to a dead run.

**D2 — Default `instanceKey = appName ":" definition.id`**, overridable via `AttachOptions.instanceKey`. No randomness, no storage; same inputs → same key across reruns. Callers running deliberate fleets of the same machine pass explicit keys (or accept coexistence, since live sessions never supersede).
- Alternative: hash of the full definition metadata. Rejected: hot reload often *changes* the definition — the common rerun case would defeat supersession.

**D3 — One removal notification, two triggers.** Single server→viewer `SessionRemoved { sessionId }` message for both supersession and viewer-requested removal; single viewer→server `RemoveSession { sessionId }` request. The relay handles `RemoveSession` on the viewer receive path (today it only handles `Dispatch`), guarded to non-connected sessions; ignores otherwise. Viewer fold on `SessionRemoved`: filter the session out of world state. Late viewers never see removed sessions because replay iterates the registry, which no longer holds them.

**D4 — UI dismiss is confirmation-driven.** The dismiss control (session picker, non-live sessions only) sends `RemoveSession` and does nothing locally; the session leaves when `SessionRemoved` folds. Keeps all viewers consistent and makes the live-session-refusal case naturally inert. Selection fallback: when the selected session disappears, select the first remaining session, else empty state — same path for supersession, another viewer's dismissal, and your own.

**D5 — Protocol version unchanged.** `instanceKey` is optional on `Hello`; old apps omit it and get today's behavior. The new messages are additive; the relay's `default:` arm and the attach client's `default:` arm already ignore unknown tags, so mixed old/new pairs degrade gracefully rather than reject.

## Risks / Trade-offs

- [Supersede deletes crash history a user still wanted] → Only non-connected sessions with the *same* lineage are evicted, and only when the app actually reruns — the trail survives until you restart the app, which is the moment you've moved on. Explicit keys opt out entirely.
- [Two distinct apps collide on `appName:definitionId`] → Keys only matter within one Studio server (localhost, one developer); collision requires same name *and* same machine id, which de facto is the same app. Override exists.
- [Race: rerun announces while old socket not yet dropped] → Old session still `connected` → no supersession; it flips to `disconnected` moments later when its socket dies and is cleaned up on the *next* rerun, or dismissed manually. Acceptable: transient duplicate, never data loss.
- [Embedded (MemoryTransport) Studio gets a dismiss control it doesn't need] → `singleSession` mode already hides the picker; the control simply never renders there.

## Migration Plan

Additive protocol fields/messages, one package set released together (workspace). No data to migrate; rollback is reverting the release.
