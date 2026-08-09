# 05 — Invoke typed Effects with scoped cancellation

**What to build:** Let a visible machine state own one named Effect operation whose typed outcomes, dependencies, cancellation, and lifecycle remain understandable in code, inspection, and the graph.

**Blocked by:** 03 — Complete machines with final states and Schema codecs; 04 — Choose transitions with ordered named guards

**Status:** ready-for-agent

- [ ] An invoked node owns one stable, named Effect operation and infers its success, typed failure, and service requirement types.
- [ ] The definition declares graphable transitions for successful results and expected typed failures, including tagged alternatives and an explicit fallback where needed.
- [ ] Application code supplies service implementations through Layers when the machine is run; definitions do not construct a runtime or secretly choose implementations.
- [ ] Exiting the invoked state interrupts its Effect, including when exit is caused by an accepted external event.
- [ ] A completion from interrupted or superseded work cannot mutate the current machine state.
- [ ] An unexpected Effect defect terminates the machine instance, and `completion` preserves its Cause for ordinary Effect supervision or sandboxing.
- [ ] Definitions do not convert defects into ordinary application-state transitions by default.
- [ ] The graph shows the invocation name, description, and declared outcome routes without attempting to inspect Effect internals.
- [ ] Inspection reports invocation start, success, typed failure, cancellation, and defect using metadata rather than payloads by default.
- [ ] Compile-time and runtime tests cover inferred requirements, outcome routing, Layer substitution, interruption, stale completion, and defects.
