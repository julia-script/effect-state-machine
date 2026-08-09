# 03 — Complete machines with final states and Schema codecs

**What to build:** Let Effect users model terminating workflows whose final state is their typed completion value, while keeping Schema encoding and decoding explicit at application boundaries.

**Blocked by:** 02 — Run and visualize a minimal Schema-first machine

**Status:** ready-for-agent

- [ ] Definitions can mark state variants as final, and the handle exposes an Effect-native `completion` operation.
- [ ] The completion type is inferred as the union of final-state values; a definition without final states has completion type `never`.
- [ ] Reaching a final state atomically commits the final snapshot before resolving completion.
- [ ] Completion interrupts active machine-owned work, ends the `changes` Stream, and retains the final snapshot for observation.
- [ ] Sending an event after completion is treated as a protocol defect.
- [ ] Explicit helpers encode and decode machine input, state, and events with their declared Schemas.
- [ ] Services required only by a Schema codec remain requirements of the encode/decode Effect and do not leak into machine execution.
- [ ] The interpreter trusts decoded values and does not repeatedly validate reducer-produced states during normal execution.
- [ ] The renderer-independent graph marks final nodes distinctly.
- [ ] Completion, Stream termination, post-completion behavior, and codec requirement isolation are covered by tests.
