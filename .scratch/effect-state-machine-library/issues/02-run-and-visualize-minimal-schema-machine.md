# 02 — Run and visualize a minimal Schema-first machine

**What to build:** Deliver the first production tracer bullet: an Effect user can define a small Schema-first machine, run it as a scoped Effect, interact with it, inspect why it transitioned, and visualize the same definition without executing application logic.

**Blocked by:** 01 — Prototype the public machine-definition API

**Status:** ready-for-agent

- [ ] A small machine is defined from Schema-described input, states, and events using the approved public builder and ordinary states.
- [ ] A pure initializer derives the initial state from already-decoded input.
- [ ] Running the definition returns a scoped, Effect-only handle exposing `snapshot`, `changes`, `send`, and `can`; it creates neither Promise methods nor a `ManagedRuntime`.
- [ ] Each instance processes external events through one serialized queue, producing deterministic transition order.
- [ ] Sending a globally valid event that the live state does not accept terminates the machine as a protocol defect; globally unknown events are rejected by the type or Schema boundary.
- [ ] Duplicate state tags, missing targets, and an invalid initial state are rejected before a machine begins execution.
- [ ] Inspection reports machine lifecycle, received event tag, selected transition, and previous/next state tags without including application payloads by default.
- [ ] Tooling can derive a renderer-independent graph model and Mermaid text from the definition without running it or providing dependencies.
- [ ] Runtime, protocol-defect, inspection, and graph behavior are covered by public-behavior tests.
