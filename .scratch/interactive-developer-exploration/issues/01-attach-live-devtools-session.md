# 01 — Attach a live devtools session to a real machine

**What to build:** Let an Effect developer create one scoped devtools session from a real machine
definition and running machine handle, then observe its live state through a minimal embedded viewer
without transferring runtime ownership to devtools.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] A public renderer-independent devtools API creates one session from one root-machine
      definition and its running handle.
- [x] Session creation is a scoped Effect and exposes Effect-native reads, controls, and a Stream of
      immutable session views; it introduces no Promise API or global runtime.
- [x] The session subscribes immediately when created rather than when its viewer becomes visible.
- [x] The machine's current snapshot becomes live-head position zero and later application-driven
      transitions advance the live head.
- [x] The default session view exposes machine and state metadata without full state values.
- [x] An optional state projection can expose explicitly selected local details for the live
      snapshot.
- [x] A minimal embedded development viewer consumes only the public session view and visibly follows
      transitions triggered by ordinary application controls.
- [x] Hiding, opening, or closing the viewer does not start, stop, or interrupt the session or
      machine.
- [x] Closing the session scope releases its subscriptions and retained session state without
      interrupting the externally owned machine.
- [x] Acceptance tests run a real public machine, attach through the public session API, and assert
      observable session behavior without calling session internals.

## Answer

Added an Effect-native, renderer-independent scoped session in `src/DevToolsSession.ts`, exported it
from the devtools entry point, and added a minimal DOM consumer in `src/DevToolsViewer.ts`. The
session waits until its machine-change subscription is active before returning, retains only
metadata plus an explicit projection, and owns no machine runtime. Public-seam tests cover live
attachment, immediate transitions, projected details, and independent scope closure.
