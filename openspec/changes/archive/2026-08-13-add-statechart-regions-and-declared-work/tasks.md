## 1. Canonical Definition and Type Surface

- [x] 1.1 Move the prototype's accepted inference assertions and `@ts-expect-error` rejection cases into permanent core compile fixtures, covering exhaustive states, target fields, Effect channels, lane correlation, regions, completion, and requirements.
- [x] 1.2 Replace tag-repeating node-array definition types with the exhaustive keyed `states` record and structural atomic, invoke, regions, final, and existing child node unions.
- [x] 1.3 Implement `define`, `state`, `invoke`, `invoke.all`, `invoke.race`, `regions`, `region.invoke`, and `final` with contextual current-tag inference and readonly canonical return values.
- [x] 1.4 Implement shallow region and task normalization so downstream consumers see one canonical tree while direct task functions and metadata-bearing tasks preserve exact channels.
- [x] 1.5 Update `MachineInput`, `MachineState`, `MachineEvent`, `MachineCompletion`, and `MachineRequirements` to derive exact types from keyed states, nested region work, retry schedules, and child definitions.
- [x] 1.6 Extract and extend synchronous definition validation for stable names, targets, guard fallback order, final-node restrictions, exhaustive region maps, lane records, and positive concurrency without executing callbacks.

## 2. Core Consumer Migration

- [x] 2.1 Migrate existing core machine fixtures, examples, and tests to `define(metadata, states)` and the tagless shallow node constructors while preserving child-machine coverage.
- [x] 2.2 Update interpreter and definition metadata lookups from node arrays to keyed canonical states, retaining a single documented type-erasure boundary.
- [x] 2.3 Add structural node/work path types and update graph extraction to traverse top-level states, region slots, timers, work lanes, retries, and completion edges.
- [x] 2.4 Update Mermaid rendering, source-location resolution, and metadata serialization for structural paths, with region-property locations falling back to their enclosing constructor source.
- [x] 2.5 Update all dependent packages and exhaustive pattern matches for the expanded graph and definition shapes, preserving existing Studio protocol and child-tree behavior.

## 3. Transition and Entry Runtime Foundation

- [x] 3.1 Add runtime tests proving auto-tagged commits, conflicting reducer `_tag` override, ordered guards, ignore behavior, stay updates, explicit self-target re-entry, and current-state timer/work preservation.
- [x] 3.2 Separate handler selection, reduction planning, and state commit so one inbox item produces at most one atomic top-level state commit.
- [x] 3.3 Implement destination-tag-owned construction for top-level and region results and validate each committed value at the existing schema boundary.
- [x] 3.4 Generalize invocation generation into unique top-level and region entry identities carried by every internal inbox envelope.
- [x] 3.5 Implement inner-before-outer scope exit and outer-before-inner scope entry helpers, with stale internal outcomes rejected by current entry identity.
- [x] 3.6 Run and repair the existing atomic, invoke, child, protocol, inspection, graph, and package-consumer suites before introducing new concurrent behavior.

## 4. Declared Work and Timers

- [x] 4.1 Add deterministic clock tests and implement one entry-owned `after` timer for atomic, invoked-work, and non-final region nodes, including stay, self-target restart, exit cancellation, and stale wake-up behavior.
- [x] 4.2 Adapt single Effect invocation and named retry execution to the entry-owner abstraction, preserving exact typed failure versus defect handling and schedule requirements.
- [x] 4.3 Add concurrency-controlled `all` tests and implementation for keyed success products, first typed failure, and sibling interruption.
- [x] 4.4 Add heterogeneous `race` tests and implementation for first-success winner/value correlation, loser interruption, failed-lane continuation, and final observed failure when every lane fails.
- [x] 4.5 Add work and timer inspection facts with owner path, entry identity, work/lane name, retry metadata, cancellation, stale outcome, and outcome transition details.

## 5. Compound and Parallel Regions

- [x] 5.1 Add runtime fixtures for one compound slot, multiple parallel slots, explicit entry configuration, undeclared history data, local target bounds, and read-only parent snapshots.
- [x] 5.2 Implement active region lookup from parent state fields and innermost-first event selection, including child ignore suppression and parent fallback.
- [x] 5.3 Implement parallel macrostep planning so all selected sibling reducers read one pre-event snapshot and their slot results commit atomically.
- [x] 5.4 Implement region stay, self-target, sibling transition, and parent-exit lifecycle ownership with deterministic slot entry/exit ordering.
- [x] 5.5 Implement `region.invoke` execution and retry through the shared work runner, including parent/slot inputs, local outcome targets, requirements, interruption, and stale outcomes.
- [x] 5.6 Implement all-regions-final detection and one-shot `onComplete` transition selection after the completing macrostep, including stable completed configurations without a completion transition.

## 6. Inspection, Documentation, and Release Verification

- [x] 6.1 Add graph and inspection integration tests that render and record parallel macrosteps, region paths, timers, named lanes, retries, completion, cancellation, and source fallbacks without executing definitions.
- [x] 6.2 Update public API documentation and representative player, editor, and importer examples to explain shallow syntax, explicit region initialization, stay versus self-target, history-as-data, and race failure semantics.
- [x] 6.3 Remove the throwaway `statechart-regions` prototype only after every accepted and rejected proof has equivalent permanent coverage.
- [x] 6.4 Run core formatting, lint, type checking, runtime tests, build, API checks, package-consumer verification, and the full workspace test suite; record any intentionally deferred compatibility work.

Verification note: core and Studio package checks, the packed consumer, workspace build,
workspace typecheck, workspace lint, and all 102 runtime tests pass. The full `pnpm check` reaches
and passes every package check, then reports one pre-existing formatter mismatch in untouched
`packages/studio/src/server/Relay.ts`; changed-file formatting checks pass. The deprecated `make`
adapter remains only for source compatibility and its three construction-defect tests; no feature
work is deferred to it.
