# Tasks: Studio Session Lifecycle

## 1. Protocol

- [x] 1.1 Add optional `instanceKey` to `HelloMessage` in `packages/studio-client/src/Protocol.ts` and thread it through `Announcement.make`
- [x] 1.2 Add `RemoveSessionMessage` (viewer→server) and `SessionRemovedMessage` (server→viewer) to the protocol schema/union
- [x] 1.3 Protocol round-trip tests for the new field and messages

## 2. Attach

- [x] 2.1 Derive default `instanceKey` as `appName:definition.id` in `Attach.attach`, add `AttachOptions.instanceKey` override, include it in the hello
- [x] 2.2 Test: same options across two attaches yield the same key; explicit override is passed through unchanged

## 3. Relay

- [x] 3.1 On `Hello` with an `instanceKey`: delete any non-connected session with the same key, broadcast `SessionRemoved` for it before broadcasting the new `Hello`
- [x] 3.2 Handle `RemoveSession` on the viewer receive path: delete + broadcast `SessionRemoved` for non-connected sessions, ignore for connected ones
- [x] 3.3 Relay tests: rerun supersedes disconnected/ended predecessor; connected predecessor untouched; late viewer does not receive removed sessions; live-session removal ignored

## 4. Viewer client and UI

- [x] 4.1 Fold `SessionRemoved` in `ViewerClient.ts`: drop the session from world state
- [x] 4.2 Expose a `removeSession(sessionId)` dispatch on the viewer client that sends `RemoveSession`
- [x] 4.3 Dismiss control in the session picker for disconnected/ended sessions (hidden in `singleSession` mode)
- [x] 4.4 Selection fallback when the viewed session is removed: first remaining session, else empty state
- [x] 4.5 UI/state tests: dismiss flow, fallback on removal of the viewed session

## 5. Verify

- [x] 5.1 Rebuild Studio bundle, restart server, manually verify: hot reload of an example app yields a single picker entry; dismiss works from the UI
- [x] 5.2 `openspec validate --change studio-session-lifecycle` and workspace typecheck/tests pass
