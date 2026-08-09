# 05 — Invoke typed Effects with scoped cancellation

**What to build:** Let a visible machine state own one named Effect operation whose typed outcomes, dependencies, cancellation, and lifecycle remain understandable in code, inspection, and the graph.

**Blocked by:** 03 — Complete machines with final states and Schema codecs; 04 — Choose transitions with ordered named guards

**Status:** completed

- [x] An invoked node owns one stable, named Effect operation and infers its success, typed failure, and service requirement types.
- [x] The definition declares graphable transitions for successful results and expected typed failures, including tagged alternatives and an explicit fallback where needed.
- [x] Application code supplies service implementations through Layers when the machine is run; definitions do not construct a runtime or secretly choose implementations.
- [x] Exiting the invoked state interrupts its Effect, including when exit is caused by an accepted external event.
- [x] A completion from interrupted or superseded work cannot mutate the current machine state.
- [x] An unexpected Effect defect terminates the machine instance, and `completion` preserves its Cause for ordinary Effect supervision or sandboxing.
- [x] Definitions do not convert defects into ordinary application-state transitions by default.
- [x] The graph shows the invocation name, description, and declared outcome routes without attempting to inspect Effect internals.
- [x] Inspection reports invocation start, success, typed failure, cancellation, and defect using metadata rather than payloads by default.
- [x] Compile-time and runtime tests cover inferred requirements, outcome routing, Layer substitution, interruption, stale completion, and defects.

## Implementation

- `builder.invoke` binds one named Effect to a visible state and infers output, typed failure, and environment requirements into `MachineRequirements`.
- Success and failure outcomes support direct transitions or the same ordered named-branch vocabulary used by events. The interpreter routes outcomes through its queue and rejects stale generations.
- Each machine instance owns a scoped invocation fiber. State exit and final completion interrupt that fiber; late callbacks cannot mutate the new state.
- Invocation defects retain their full Cause on `completion` and have no ordinary state route. Inspection replays metadata-only invocation lifecycle events, and graph projection exposes authored invocation/outcome metadata without executing the Effect.
- Tests cover Layer substitution, requirement inference, success, tagged failures with fallback, cancellation, late completion, graph projection, inspection, and defect preservation.
