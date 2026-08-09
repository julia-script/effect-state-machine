# 02 — Run and visualize a minimal Schema-first machine

**What to build:** Deliver the first production tracer bullet: an Effect user can define a small Schema-first machine, run it as a scoped Effect, interact with it, inspect why it transitioned, and visualize the same definition without executing application logic.

**Blocked by:** 01 — Prototype the public machine-definition API

**Status:** completed

- [x] A small machine is defined from Schema-described input, states, and events using the approved public builder and ordinary states.
- [x] A pure initializer derives the initial state from already-decoded input.
- [x] Running the definition returns a scoped, Effect-only handle exposing `snapshot`, `changes`, `send`, and `can`; it creates neither Promise methods nor a `ManagedRuntime`.
- [x] Each instance processes external events through one serialized queue, producing deterministic transition order.
- [x] Sending a globally valid event that the live state does not accept terminates the machine as a protocol defect; globally unknown events are rejected by the type or Schema boundary.
- [x] Duplicate state tags, missing targets, and an invalid initial state are rejected before a machine begins execution.
- [x] Inspection reports machine lifecycle, received event tag, selected transition, and previous/next state tags without including application payloads by default.
- [x] Tooling can derive a renderer-independent graph model and Mermaid text from the definition without running it or providing dependencies.
- [x] Runtime, protocol-defect, inspection, and graph behavior are covered by public-behavior tests.

## Implementation

- `src/Machine.ts` contains the production ordinary-state builder and scoped interpreter. Each handle is backed by one event queue and exposes only Effect and Stream values.
- Live-state protocol violations are defects, definition invariants are checked before execution, and the inspection stream contains tags and transition metadata rather than application values.
- `src/Graph.ts` derives an immutable renderer-independent graph while preserving Schema and transition descriptions. `src/Mermaid.ts` renders a deliberately compact Mermaid view from that graph model.
- Public-behavior coverage lives in `tests/Machine.test.ts` and `tests/Graph.test.ts` using `@effect/vitest`; `pnpm check` runs those tests with the existing type, prototype, and Biome checks.
