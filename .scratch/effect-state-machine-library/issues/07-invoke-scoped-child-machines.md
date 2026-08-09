# 07 — Invoke scoped child machines

**What to build:** Let a visible parent state own a statically declared child machine with typed input, communication, dependencies, completion, lifecycle, and graph identity.

**Blocked by:** 05 — Invoke typed Effects with scoped cancellation

**Status:** ready-for-agent

- [ ] A parent node can invoke one statically declared child definition under a stable authored invocation name.
- [ ] The parent derives Schema-described child input and may explicitly forward only declared child events.
- [ ] Reaching the child machine's final state returns its inferred final-state value to the parent's serialized event queue.
- [ ] Entering the parent state starts the child in a child Scope; leaving it interrupts and closes that child before stale output can affect the parent.
- [ ] Services required by the child are inferred transitively as requirements of running the parent, while the composition root still chooses their Layer implementations.
- [ ] Each runtime child instance receives an instance ID distinct from the stable invocation name.
- [ ] The static graph links the parent invocation to the child definition and exposes metadata suitable for a future collapsed or partial graph view.
- [ ] Inspection correlates child start, forwarded events, completion, cancellation, and defects by invocation name and runtime instance ID.
- [ ] The v0 API introduces no global actor registry, peer addressing, dynamic spawning, or arbitrary intermediate child emissions.
- [ ] Tests cover typed communication, output routing, transitive requirements, repeated entries, scoped interruption, graph links, and inspection identity.
