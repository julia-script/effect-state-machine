## Why

The state-machine prototype has the right capabilities—typed regions, declared work, timers, and auto-tagged transitions—but its nested representation makes common behavior hard to read and author. We now have compile-checked evidence for a shallower value-oriented interface that preserves exhaustive schemas, precise Effect inference, and static inspection, so the interface and runtime contract should be formalized before implementation.

## What Changes

- Add a schema-first `Machine.builder(...)` authoring API whose `define(metadata, states)` call accepts one exhaustive, immutable record keyed by state tag.
- Add shallow node constructors: `state(events, options?)`, `invoke(work, events?, options?)`, `invoke.all(...)`, `invoke.race(...)`, `regions(regionTrees, parentEvents?, options?)`, `region.invoke(...)`, and `final()`.
- Make transition targets supply the destination `_tag`, so reducers return only destination fields while retaining exact source-state, event, and target-state inference.
- Distinguish `{ stay: reducer }` from an explicit self-target: a stay updates fields without re-entry, while a self-target restarts state-owned timers and work.
- Add tagged-union state fields as opt-in live region slots. Multiple declared slots execute as parallel regions; undeclared tagged-union fields remain inert state data and can represent history explicitly.
- Add inspectable state-owned work declarations for a single Effect, named `all` lanes, and named `race` lanes, including retry metadata, success/failure transitions, exact Effect requirements, lane-keyed joined output, and correlated race output.
- Add inspectable `after` transitions with restart and cancellation semantics tied to state entry and exit.
- Normalize the shallow authoring form synchronously into the canonical immutable machine-definition tree used by the interpreter, graph tooling, and source inspection.
- Define runtime semantics for innermost-first transition selection, parallel region macrosteps, region completion, state re-entry, work/timer interruption, and deterministic state commits.
- **BREAKING**: replace the prototype's wrapper-heavy `states → on/invoke/regions → states` authoring grammar with the shallow constructor interface. This only affects the experimental prototype API; no published stable API is removed.

## Capabilities

### New Capabilities

- `statechart-definition-authoring`: Schema-first machine construction, shallow node syntax, exhaustive records, auto-tagged reducers, stay/re-entry distinction, type inference, normalization, and static inspectability.
- `statechart-regions`: Opt-in compound and parallel region slots, region transition selection and reduction, completion, lifecycle, and explicit history-as-data behavior.
- `statechart-declared-work`: Single/all/race Effect declarations, retry and timer declarations, inferred outcomes and requirements, and owned-work lifecycle semantics.

### Modified Capabilities

None.

## Impact

- Affects the core package's machine-definition types, builder API, interpreter, inspection facts, graph extraction, and source-location capture.
- Adds compile-time fixtures for accepted and rejected authoring forms plus runtime tests for ordering, cancellation, completion, and Effect environment inference.
- Requires examples and public API documentation to use the shallow syntax.
- Does not require a new runtime dependency; the design builds on the existing Effect, Schema, Schedule, Scope, and Stream APIs.
