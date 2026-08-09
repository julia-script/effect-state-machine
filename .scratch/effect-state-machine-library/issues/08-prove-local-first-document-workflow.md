# 08 — Prove the library with a local-first document workflow

**What to build:** Build one headless, application-scale reference workflow that proves the library can keep meaningful Effect application behavior readable in both code and a read-only graph.

**Blocked by:** 06 — Retry invoked Effects with native Schedules; 07 — Invoke scoped child machines

**Status:** completed

- [x] A single-document workflow models opening, editing, saving, going offline, retrying synchronization, cancelling work, resolving a conflict, and completing or closing the session.
- [x] File or network behavior is provided by swappable Effect services and Layers rather than embedded implementations.
- [x] Offline synchronization uses a named native Schedule and is deterministic under TestClock.
- [x] Conflict resolution is a statically invoked child machine with typed input, forwarded events, and final output.
- [x] Expected operational failures follow typed, declared transitions; cancellation interrupts owned work; unexpected defects terminate the machine.
- [x] The workflow's input, state snapshots, and events can be explicitly encoded and decoded, without claiming durable replay or interrupted-Effect resumption.
- [x] The same definition drives runtime tests, semantic inspection traces, the renderer-independent graph model, and Mermaid output.
- [x] A capability matrix maps every v0 semantic promise to either this workflow or a focused executable fixture.
- [x] The example is headless and introduces no framework binding or Promise-based machine API.
- [x] The evidence records whether hierarchy, parallel regions, or dynamic children proved necessary, without adding them speculatively.

## Implementation

- `examples/LocalFirstDocument.ts` defines the services, parent workflow, conflict child, and named
  offline retry policy without selecting any Layer implementation.
- `tests/LocalFirstDocument.test.ts` runs seven integrated scenarios using injected Layers and
  `TestClock`, and projects the executed definition through both graph surfaces.
- `docs/capability-matrix.md` maps v0 semantics to executable evidence.
- `docs/reference-workflow.md` records the bounded composition result: the example justified one
  static child, but not hierarchy, parallel regions, or dynamic spawning.
