# 04 — Choose transitions with ordered named guards

**What to build:** Let authors express graphable, Match-inspired guarded alternatives while preserving synchronous, deterministic routing and useful TypeScript narrowing.

**Blocked by:** 02 — Run and visualize a minimal Schema-first machine

**Status:** ready-for-agent

- [ ] One event may declare an ordered list of named guarded branches, evaluated with first-match-wins semantics.
- [ ] Guard predicates synchronously inspect only the current state and event, require no Effect services, and narrow their values for the selected reducer.
- [ ] Guards require stable names and may include descriptions adjacent to their declarations.
- [ ] An optional unguarded fallback handles the event when no predicate matches.
- [ ] If no guard matches and no fallback exists, the machine terminates with a protocol defect.
- [ ] Authors can explicitly declare an event ignored in a state, making intentional no-op behavior visible in code and tooling.
- [ ] The graph preserves branch order, guard names, descriptions, fallback behavior, and explicit ignores.
- [ ] Inspection identifies the selected branch without exposing full state or event payloads by default.
- [ ] Tests prove evaluation order, narrowing, fallback, no-match defects, explicit ignores, and graph fidelity.
