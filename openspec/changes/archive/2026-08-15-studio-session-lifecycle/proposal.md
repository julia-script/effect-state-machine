# Studio Session Lifecycle

## Why

Every `attach` call announces a brand-new random session, and the Studio relay never removes sessions — so hot reloads and reruns of the same application pile up dead "disconnected" sessions in the picker with no way to clear them. The relay already resumes transient socket drops correctly; what's missing is application identity across reruns and any eviction path.

## What Changes

- Applications announce a stable **instance key** (defaulting to app name + definition id) so the relay can recognize "this is a rerun of that app".
- When a new session announces an instance key that an existing non-connected session also carries, the relay **supersedes** the old session: it is removed from the registry and viewers are told to drop it. A still-connected predecessor is left alone (two live instances are legitimately two sessions).
- Viewers can explicitly **remove** a disconnected or ended session; the UI grows a dismiss affordance on non-live sessions. Removal of a live session is rejected.
- Viewer world state supports session removal (today the session list only grows within a connection).

Not in scope: resuming history across process restarts (sequence epochs), TTL-based expiry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `studio-protocol`: Hello carries an instance key; new messages for session removal (viewer→server request, server→viewer notification covering both supersede and explicit removal).
- `studio-server`: relay supersedes stale sessions on re-announcement of the same instance key, honors viewer removal requests for non-live sessions, and stops replaying removed sessions to late viewers.
- `studio-client`: attach announces an instance key (derived by default, overridable); viewer client folds removal notifications by deleting the session from world state.
- `studio-ui`: non-live sessions expose a dismiss control; a removed session disappears from the picker and its detail view.

## Impact

- `packages/studio-client`: `Protocol.ts` (messages), `Announcement.ts`, `Attach.ts` (instance key), viewer-side fold in `packages/studio-react/src/state/ViewerClient.ts`.
- `packages/studio`: `server/Relay.ts` (supersede + removal), no server route changes.
- `packages/studio-react`: session picker / TopBar dismiss control, atoms.
- Protocol gains fields/messages; existing message shapes are unchanged, so old apps keep working against a new server (no instance key → no supersede, current behavior).
