# 01 — Attach a live devtools session to a real machine

**What to build:** Let an Effect developer create one scoped devtools session from a real machine
definition and running machine handle, then observe its live state through a minimal embedded viewer
without transferring runtime ownership to devtools.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A public renderer-independent devtools API creates one session from one root-machine
      definition and its running handle.
- [ ] Session creation is a scoped Effect and exposes Effect-native reads, controls, and a Stream of
      immutable session views; it introduces no Promise API or global runtime.
- [ ] The session subscribes immediately when created rather than when its viewer becomes visible.
- [ ] The machine's current snapshot becomes live-head position zero and later application-driven
      transitions advance the live head.
- [ ] The default session view exposes machine and state metadata without full state values.
- [ ] An optional state projection can expose explicitly selected local details for the live
      snapshot.
- [ ] A minimal embedded development viewer consumes only the public session view and visibly follows
      transitions triggered by ordinary application controls.
- [ ] Hiding, opening, or closing the viewer does not start, stop, or interrupt the session or
      machine.
- [ ] Closing the session scope releases its subscriptions and retained session state without
      interrupting the externally owned machine.
- [ ] Acceptance tests run a real public machine, attach through the public session API, and assert
      observable session behavior without calling session internals.

