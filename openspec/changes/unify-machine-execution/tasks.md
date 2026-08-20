## 1. Public Contracts and Type Safety

- [x] 1.1 Add failing compile-time tests for definition-owned `idempotencyKey`, default/explicit persistence versions, migrations, `instanceId`, `run`, and `open`; verify the focused type-test command fails for the expected missing APIs before implementation.
- [x] 1.2 Add failing compile-time tests proving referenced work execution context is non-optional under every work kind while callbacks that intentionally ignore it remain valid; verify the focused type-test command captures both cases.
- [x] 1.3 Define the branded machine-instance, dispatch, entry, execution, revision, and fence identities with versioned total encoders; verify unit tests cover definition/key separation, malformed Unicode, re-entry, lane separation, and deterministic reconstruction.
- [x] 1.4 Extend immutable machine definition types and metadata with input-derived identity, persistence version defaulting to `"1"`, and definition-owned migrations; verify definition inspection and exact-inference tests pass.
- [x] 1.5 Add typed definition-level `instanceId`, `run`, and `open` operations plus the unified handle surface; verify the public API type tests require `MachineEngine` and reject obsolete per-run instance/version options.

## 2. Aggregate Document and Minimal Store

- [x] 2.1 Define the canonical persisted-value, root aggregate, nested runtime tree, mailbox, timer, activity, claim, dispatch, execution, migration, and terminal-status Schemas; verify round-trip and malformed-boundary tests cover every envelope.
- [x] 2.2 Define `MachineStore` as an Effect service with store time, optional load, and atomic create/compare-and-set replacement including the store-time `notAfter` precondition; verify service/error type tests expose committed, conflict, and expired results without defects escaping typed boundaries.
- [x] 2.3 Implement pure safe-key aggregate operations for lookup, replacement, keyed delivery deduplication, claims, fences, terminal cleanup, and tombstone compaction; verify unit tests cover `__proto__`, `constructor`, duplicates, stale entries, and compaction safety.
- [x] 2.4 Replace the high-level durable-store conformance API with a framework-neutral primitive-store corpus; verify the corpus covers absent load, atomic create, replacement, conflicts, expiry, time, isolation, and Schema rejection.
- [x] 2.5 Implement `MachineStore.layerMemory` using the supplied Effect clock and atomic in-memory revision updates; verify it passes the complete primitive-store corpus with virtual time.

## 3. Unified Machine Engine Foundations

- [x] 3.1 Define the `MachineEngine` Effect service, engine configuration, scoped runtime ownership, `layer`, and `layerMemory`; verify service construction tests prove memory is explicit and one supplied layer is shared across runs.
- [x] 3.2 Adapt transition planning to consume one decoded runtime-tree node and produce one deterministic aggregate replacement plan without executing persistence operations; verify focused planner tests cover stay, self-target, guards, ignored events, regions, and final states.
- [x] 3.3 Implement absent-instance initialization and existing-instance resume through aggregate compare-and-set; verify tests prove the initializer runs once, encoded state is validated, and concurrent starts converge on one instance.
- [x] 3.4 Implement engine-backed external dispatch with generated keys and caller-supplied retry-safe keys; verify tests cover repeated identical events, legitimate duplicate payloads with distinct keys, payload conflicts, lost-response retry, and completed-instance rejection.
- [x] 3.5 Implement the per-instance worker loop, machine-message claims, renew/release behavior, CAS retry classification, and stale/expired fencing; verify virtual-time contention tests cover worker loss before and after commit and return of a superseded owner.
- [x] 3.6 Build the reusable engine semantic corpus over a supplied store layer; verify the memory composition passes initialization, resume, dispatch, ordering, claims, fencing, completion, compatibility, and terminal-cleanup cases.

## 4. Timers, Work, and Recovery Semantics

- [x] 4.1 Persist timer duration resolution and absolute store-time deadlines in accepted entry commits; verify virtual-time tests cover restart before and after the deadline, stays, self-targets, dynamic durations, CAS retries, and stale timer delivery.
- [x] 4.2 Implement stable required work execution context for single, `all`, `race`, retry, and region work; verify runtime tests observe non-optional context, stable IDs across redelivery, incremented attempts, and new IDs after re-entry.
- [x] 4.3 Implement activity command claim, renewal, interruption, Schema encoding, atomic outcome publication, and replay; verify tests cover worker loss on both sides of outcome commit and prove committed work does not execute again.
- [x] 4.4 Preserve Cause classification so pure typed failures use the allowed-error Schema, interruption remains redeliverable, and defects or compound defect Causes terminate correctly; verify the pure fail/die/interrupt and compound Cause matrix passes.
- [x] 4.5 Persist `all` and `race` lane claims and outcomes with authored concurrency; verify restart tests reuse completed lanes, race winners remain correlated, late outcomes are stale, and losing lanes are invalidated.
- [x] 4.6 Implement definition-owned persistence migrations over validated aggregate migration documents; verify default version, missing migration, successful chain, invalid output, format mismatch, and CAS contention tests pass.

## 5. Durable Child Machines

- [x] 5.1 Add nested child runtime records keyed by owner path and parent entry identity to planning and aggregate validation; verify round-trip tests cover active, completed, cancelled, and nested children.
- [x] 5.2 Implement child initialization, event forwarding, timers, work, and restart using the parent aggregate; verify the existing child behavior suite passes through `MachineEngine.layerMemory` without a second interpreter.
- [x] 5.3 Commit parent exit and child cancellation atomically, including invalidation of child-owned mail, timers, claims, and outcomes; verify interruption and late-delivery tests cannot revive an exited child.
- [x] 5.4 Commit child completion and exactly one parent completion delivery together; verify process-loss and redelivery tests cannot initialize the child again or route completion twice.
- [x] 5.5 Add persistent child scenarios to the engine semantic corpus and verify memory plus a restart-capable test store pass forwarding order, active-child resume, cancellation, nested work, timers, and completion.

## 6. Browser-Local Store

- [x] 6.1 Implement `LocalStorageMachineStore` behind injected browser capability types with canonical JSON keys and no browser-global imports from core modules; verify internal-boundary and server-import tests pass.
- [x] 6.2 Implement per-instance Web Lock coordination around load/check/write and the atomic deadline precondition; verify simulated cross-tab tests allow only one create or replacement for an expected revision.
- [x] 6.3 Add typed unsupported-platform behavior and an explicitly named/configured single-context mode; verify missing-Web-Locks tests fail safely while opt-in same-page tests pass.
- [x] 6.4 Run the primitive-store and engine semantic corpora against the browser-local adapter with reload simulation and virtualized store time; verify original timer deadlines, dispatch records, completion, and child state survive layer reconstruction.

## 7. Effect Workflow Integration

- [x] 7.1 Add the isolated `MachineWorkflow` module using only the public Effect Workflow engine API and infer Workflow payload, success, allowed-error, and environment types; verify focused compile-time tests reject invalid payloads and narrow reducers exactly.
- [x] 7.2 Implement versioned Workflow execution-ID derivation from Workflow identity and machine work execution ID; verify tests preserve identity on redelivery and separate workflows, lanes, entries, and machine instances.
- [x] 7.3 Execute or observe Workflow-backed work through the public Workflow engine and persist its result through the ordinary activity-outcome path; verify success, allowed error, defect, interruption, and worker-restart tests pass.
- [x] 7.4 Add integration-layer examples that share infrastructure dependencies while retaining separate machine and Workflow persistence protocols; verify the example compiles and a Workflow engine alone does not satisfy the machine-engine requirement.
- [x] 7.5 Verify importing core `Machine`, `MachineEngine`, and `MachineStore` subpaths neither loads unstable Workflow modules nor adds a Workflow service requirement.

## 8. Breaking Cutover and Verification

- [x] 8.1 Migrate all core tests and fixtures to definition-level operations and explicitly scoped engine layers; verify the full core test suite passes through the one engine before deleting the alternative interpreter.
- [x] 8.2 Migrate repository applications, demos, and examples to definition-derived identity, definition-owned version/migrations, required work context, generated or caller dispatch keys, and explicit memory/persistent layers; verify workspace type checking passes.
- [x] 8.3 Remove the alternative interpreter, compatibility aliases, and obsolete private implementation/conformance surface after semantic parity is established; verify no source, test, generated reference, or documentation mentions an earlier public API.
- [x] 8.4 Add `MachineEngine`, `MachineStore`, `LocalStorageMachineStore`, and `MachineWorkflow` root namespaces and public subpaths, expose only the documented module set, and update build entry points; verify workspace and packed-package subpath checks resolve JavaScript and declarations correctly while unlisted subpaths fail.
- [x] 8.5 Finalize the clean engine aggregate format and package version, delete pre-cutover fixtures and compatibility branches, and remove migration material for earlier repository states; verify current-format fixtures pass and no compatibility entry point or guide ships.
- [x] 8.6 Rewrite the tutorial, persistence explanation, adapter how-to, Effect Workflow guide, and generated API reference examples for the unified model; verify every documentation snippet is compiled and the docs production build succeeds.
- [x] 8.7 Review TSDoc for every added or changed public API and regenerate reference output; verify API generation and documentation-link checks complete without warnings.
- [ ] 8.8 Run formatting, type checking, unit/type tests, quality checks, internal-boundary checks, package build/verification, and docs production build; verify the repository's complete validation suite succeeds with no ignored failures.
