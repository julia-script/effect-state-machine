# 03 — Complete machines with final states and Schema codecs

**What to build:** Let Effect users model terminating workflows whose final state is their typed completion value, while keeping Schema encoding and decoding explicit at application boundaries.

**Blocked by:** 02 — Run and visualize a minimal Schema-first machine

**Status:** completed

- [x] Definitions can mark state variants as final, and the handle exposes an Effect-native `completion` operation.
- [x] The completion type is inferred as the union of final-state values; a definition without final states has completion type `never`.
- [x] Reaching a final state atomically commits the final snapshot before resolving completion.
- [x] Completion interrupts active machine-owned work, ends the `changes` Stream, and retains the final snapshot for observation.
- [x] Sending an event after completion is treated as a protocol defect.
- [x] Explicit helpers encode and decode machine input, state, and events with their declared Schemas.
- [x] Services required only by a Schema codec remain requirements of the encode/decode Effect and do not leak into machine execution.
- [x] The interpreter trusts decoded values and does not repeatedly validate reducer-produced states during normal execution.
- [x] The renderer-independent graph marks final nodes distinctly.
- [x] Completion, Stream termination, post-completion behavior, and codec requirement isolation are covered by tests.

## Implementation

- Final nodes contribute their state variants directly to `MachineCompletion`; non-terminating definitions infer `never`.
- The scoped interpreter commits the final state, emits completion metadata, resolves `completion`, stops its worker, and terminates `changes` after the final snapshot.
- Input, state, and event codec helpers preserve each Schema's decoding or encoding service requirements, while `Machine.run` continues to accept already-decoded input without codec dependencies.
- The graph model marks final nodes and the compact Mermaid renderer adds final-state exits. Effect-native tests cover atomic completion, post-completion defects, stream termination, graph metadata, and an effectful codec service.
