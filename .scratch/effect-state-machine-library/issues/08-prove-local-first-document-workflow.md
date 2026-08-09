# 08 — Prove the library with a local-first document workflow

**What to build:** Build one headless, application-scale reference workflow that proves the library can keep meaningful Effect application behavior readable in both code and a read-only graph.

**Blocked by:** 06 — Retry invoked Effects with native Schedules; 07 — Invoke scoped child machines

**Status:** ready-for-agent

- [ ] A single-document workflow models opening, editing, saving, going offline, retrying synchronization, cancelling work, resolving a conflict, and completing or closing the session.
- [ ] File or network behavior is provided by swappable Effect services and Layers rather than embedded implementations.
- [ ] Offline synchronization uses a named native Schedule and is deterministic under TestClock.
- [ ] Conflict resolution is a statically invoked child machine with typed input, forwarded events, and final output.
- [ ] Expected operational failures follow typed, declared transitions; cancellation interrupts owned work; unexpected defects terminate the machine.
- [ ] The workflow's input, state snapshots, and events can be explicitly encoded and decoded, without claiming durable replay or interrupted-Effect resumption.
- [ ] The same definition drives runtime tests, semantic inspection traces, the renderer-independent graph model, and Mermaid output.
- [ ] A capability matrix maps every v0 semantic promise to either this workflow or a focused executable fixture.
- [ ] The example is headless and introduces no framework binding or Promise-based machine API.
- [ ] The evidence records whether hierarchy, parallel regions, or dynamic children proved necessary, without adding them speculatively.
