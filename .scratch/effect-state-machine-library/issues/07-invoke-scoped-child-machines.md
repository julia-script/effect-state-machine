# 07 — Invoke scoped child machines

**What to build:** Let a visible parent state own a statically declared child machine with typed input, communication, dependencies, completion, lifecycle, and graph identity.

**Blocked by:** 05 — Invoke typed Effects with scoped cancellation

**Status:** completed

- [x] A parent node can invoke one statically declared child definition under a stable authored invocation name.
- [x] The parent derives Schema-described child input and may explicitly forward only declared child events.
- [x] Reaching the child machine's final state returns its inferred final-state value to the parent's serialized event queue.
- [x] Entering the parent state starts the child in a child Scope; leaving it interrupts and closes that child before stale output can affect the parent.
- [x] Services required by the child are inferred transitively as requirements of running the parent, while the composition root still chooses their Layer implementations.
- [x] Each runtime child instance receives an instance ID distinct from the stable invocation name.
- [x] The static graph links the parent invocation to the child definition and exposes metadata suitable for a future collapsed or partial graph view.
- [x] Inspection correlates child start, forwarded events, completion, cancellation, and defects by invocation name and runtime instance ID.
- [x] The v0 API introduces no global actor registry, peer addressing, dynamic spawning, or arbitrary intermediate child emissions.
- [x] Tests cover typed communication, output routing, transitive requirements, repeated entries, scoped interruption, graph links, and inspection identity.

## Implementation

- `builder.child` binds a stable invocation name, a child definition, pure input derivation,
  explicitly mapped forwarded events, ordinary parent transitions, and completion routing.
- Every entry creates a fresh child Scope and runtime instance ID. Child completion and defects are
  serialized through the parent's existing mailbox; state exit closes the child before committing
  the parent's next state.
- Child requirements flow through the node phantom type into `MachineRequirements` and are still
  provided only at `Machine.run`.
- Renderer-independent graph nodes contain the child invocation, forwarding protocol, and a linked
  child graph. Mermaid renders the link as a collapsed child label.
- The implementation deliberately has no registry, arbitrary addressing, dynamic spawn, or
  intermediate child emission API.
