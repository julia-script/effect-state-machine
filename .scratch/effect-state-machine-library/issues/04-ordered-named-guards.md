# 04 — Choose transitions with ordered named guards

**What to build:** Let authors express graphable, Match-inspired guarded alternatives while preserving synchronous, deterministic routing and useful TypeScript narrowing.

**Blocked by:** 02 — Run and visualize a minimal Schema-first machine

**Status:** completed

- [x] One event may declare an ordered list of named guarded branches, evaluated with first-match-wins semantics.
- [x] Guard predicates synchronously inspect only the current state and event, require no Effect services, and narrow their values for the selected reducer.
- [x] Guards require stable names and may include descriptions adjacent to their declarations.
- [x] An optional unguarded fallback handles the event when no predicate matches.
- [x] If no guard matches and no fallback exists, the machine terminates with a protocol defect.
- [x] Authors can explicitly declare an event ignored in a state, making intentional no-op behavior visible in code and tooling.
- [x] The graph preserves branch order, guard names, descriptions, fallback behavior, and explicit ignores.
- [x] Inspection identifies the selected branch without exposing full state or event payloads by default.
- [x] Tests prove evaluation order, narrowing, fallback, no-match defects, explicit ignores, and graph fidelity.

## Implementation

- Event handlers now accept direct transitions, ordered guarded alternatives, or an explicit ignore declaration. Guard functions are synchronous and receive the already-narrowed state/event pair.
- The interpreter selects the first matching branch, supports a final `otherwise` branch, defects on no match, and emits selected-branch or ignored-event metadata.
- Definition construction validates authored guard names, fallback position, and every branch target before execution.
- The graph model retains guard order, names, descriptions, fallbacks, and ignores; Mermaid renders concise guard and ignore labels. Public tests cover all routing and graph cases.
