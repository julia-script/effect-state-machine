## 1. Schema-Backed Work API

- [x] 1.1 Extend the public API prototype with single-work and lane object forms that require `success` and `error` Schemas, accept optional execution metadata in Effect functions, and reject direct lane functions
- [x] 1.2 Add compile-time prototype assertions for exact success/error reducer inference, retry terminal errors, `Schema.Never`, `all` result records, `race` winner correlation, and Schema encoding requirements
- [x] 1.3 Update `Machine` work, task, node, and builder types to retain the outcome Schemas and constrain Effect channels to their decoded types
- [x] 1.4 Derive canonical JSON codecs for invoked-work outcomes and terminate with `MachineDefinitionDefect` when a runtime success or typed failure cannot encode
- [x] 1.5 Update ordinary single, `all`, `race`, retry, and region execution to validate outcomes through the declared codecs without changing transition or interruption semantics
- [x] 1.6 Update graph projection and inspection metadata to expose safe success/error Schema metadata without serializing executable Schema internals
- [x] 1.7 Migrate every core test fixture, prototype, app definition, example, and documentation snippet from schema-less work and direct lanes to the new authoring contract

## 2. Shared Transition Planning

- [x] 2.1 Add characterization tests for ordinary event, stay, re-entry, timer, retry, defect, region macrostep, `all`, and `race` behavior before refactoring the interpreter
- [x] 2.2 Define private transition-plan, entry-plan, owned-command, aggregate-progress, and stale-entry models that contain no store or fiber implementation details
- [x] 2.3 Extract guard selection, reducer application, entry and exit planning, completion detection, and stale-entry validation from `runActor` into private pure planning functions
- [x] 2.4 Extract parallel-region transition and completion planning so one region macrostep can be applied by either runtime
- [x] 2.5 Make the existing in-memory interpreter apply the shared plans to its `SubscriptionRef`, queue, timers, fibers, and child lifecycle
- [x] 2.6 Verify all ordinary characterization, type, inspection, and package tests remain unchanged apart from the intentional Schema-backed authoring migration

## 3. Durable Public Models and Store Interface

- [x] 3.1 Create `Durable.ts` with branded instance, entry, message, execution, delivery, revision, and persistence-version identities plus constructors and deterministic derivation helpers
- [x] 3.2 Define the canonical JSON-compatible persisted-value model and versioned Schemas for checkpoints, machine messages, activity commands, activity outcomes, dispatch records, claims, and durable defect summaries
- [x] 3.3 Define typed durable encoding, store, compatibility, migration, lease-lost, revision-conflict, idempotency-conflict, completed-instance, and unsupported-definition errors
- [x] 3.4 Prototype the Effect-native `Durable.Store` service interface for atomic create, keyed offer, machine claims, activity claims, renew/release, machine commit, activity completion, store time, and dispatch-result observation
- [x] 3.5 Define the durable runner options and handle types, including start-or-resume behavior, persistence versions, migrations, Schema-derived requirements, keyed `send`, `snapshot`, `changes`, `can`, and `completion`
- [x] 3.6 Add static validation that rejects child-machine definitions before any durable store operation while accepting state, invoke, region, and final nodes

## 4. In-Memory Durable Store and Conformance Suite

- [x] 4.1 Implement the in-memory adapter's checkpoint, machine-message, activity, claim, cancellation, dispatch-result, idempotency, and deterministic sequence state
- [x] 4.2 Implement atomic absent-instance creation with its initial checkpoint, timer messages, and activity commands
- [x] 4.3 Implement canonical-payload keyed event offer, duplicate reattachment, conflicting-payload rejection, and completed-instance rejection
- [x] 4.4 Implement delayed machine-message ordering by authoritative store time and insertion sequence, with at most one active machine claim per instance
- [x] 4.5 Implement concurrent activity claims, authored concurrency eligibility, claim attempts, lease renewal, release, expiry, and fencing
- [x] 4.6 Implement atomic machine commit with expected revision and claim fence, dispatch-result completion, message acknowledgement, cancellations, checkpoint replacement, and derived-message publication
- [x] 4.7 Implement atomic activity completion that acknowledges the activity and publishes exactly one keyed encoded outcome message
- [x] 4.8 Implement instance-lifetime idempotency tombstones and pending/terminal dispatch observation without leaking cancelled waiters
- [x] 4.9 Publish a reusable adapter conformance suite covering creation, idempotency, ordering, delays, machine serialization, activity concurrency, leases, fencing, revisions, both commit forms, and virtual time
- [x] 4.10 Run the conformance suite against the in-memory adapter using `TestClock` and deliberate crash-window fixtures

## 5. Durable Instance Lifecycle and Dispatch

- [x] 5.1 Implement absent-instance initialization that validates the definition, validates and encodes initial state, allocates deterministic entry identities, plans owned messages, and commits before returning a handle
- [x] 5.2 Implement compatible checkpoint loading, state decoding, active-entry reconstruction, aggregate-progress reconstruction, and resume without calling the initializer
- [x] 5.3 Implement the serialized machine-worker loop with scoped claim renewal, lease-loss interruption, plan evaluation, atomic commit, and safe redelivery
- [x] 5.4 Implement durable keyed `send` so caller interruption leaves the message intact and a same-key retry reattaches to the stored transition result
- [x] 5.5 Implement durable `snapshot`, `changes`, advisory `can`, running/completed/defected status, and completion behavior from committed checkpoints
- [x] 5.6 Persist final state and completed status in the causal machine commit and return the same completion after restart without accepting further events
- [x] 5.7 Persist library-owned durable defect summaries for protocol, definition, codec, and activity defects while preserving the live `Cause` when available

## 6. Durable Timers and Entry Ownership

- [x] 6.1 Resolve each dynamic duration once on entry using store-authoritative time and atomically persist its duration, absolute deadline, entry identity, and delayed timer message
- [x] 6.2 Preserve timer identity and deadline across stay updates, and allocate a new entry, deadline, and key for explicit self-target or later re-entry
- [x] 6.3 Process due timer messages through the serialized machine mailbox and prioritize already-overdue timers ahead of events offered after resume
- [x] 6.4 Atomically cancel pending timers on exit while treating durable entry-identity validation as the correctness backstop for claimed or late timer messages
- [x] 6.5 Add deterministic tests for restart before deadline, restart after deadline, dynamic-duration stay updates, self-re-entry, lease loss at fire time, and duplicate timer delivery

## 7. Durable Activities and Outcome Replay

- [x] 7.1 Publish single-invocation activity commands atomically with entry commits, including the encoded entry snapshot and deterministic execution key
- [x] 7.2 Implement scoped activity workers with concurrent claims, heartbeat renewal, interruption on lease loss, Effect requirement provisioning, and execution metadata delivery
- [x] 7.3 Encode activity success and allowed failure through their declared JSON codecs and atomically publish the matching durable outcome message
- [x] 7.4 Convert Effect defects and outcome codec failures into library-owned durable defect outcomes without misrouting them through `onFailure`
- [x] 7.5 Decode activity outcomes in the machine worker, apply the shared success or failure transition plan, and reject duplicate or exited-entry outcomes as stale
- [x] 7.6 Add recovery tests proving an Effect may rerun before outcome commit, never reruns after outcome commit, keeps the same execution key, and cannot commit from a superseded activity claim
- [x] 7.7 Add tests and documentation showing operational Effect Schedule progress may restart after process loss while the stable activity execution key is preserved

## 8. Durable Aggregate and Region Work

- [x] 8.1 Implement durable `all` lane commands with distinct stable keys, encoded entry snapshots, persisted partial results, and authored concurrency limits
- [x] 8.2 Implement `all` success aggregation, immediate failure transition, pending-lane cancellation, and restart without rerunning committed lanes
- [x] 8.3 Implement durable `race` lane commands, persisted failures, first-success selection, loser cancellation, and last-failure semantics
- [x] 8.4 Preserve `race` winner/value type correlation after decoding persisted lane outcomes and ignore late loser outcomes after entry exit
- [x] 8.5 Implement region entry identities, region timers, region activity commands carrying encoded local and parent entry snapshots, and atomic region macrosteps
- [x] 8.6 Add crash, concurrency, stale-outcome, parent-exit, and partial-progress recovery tests for `all`, `race`, and region-owned work

## 9. Compatibility and Migration

- [x] 9.1 Separate library checkpoint format versioning from caller-declared machine persistence versions and reject incompatible checkpoints before claims or activity startup
- [x] 9.2 Define the persisted-instance migration document containing checkpoint and unconsumed owned messages, with Schema validation before and after migration
- [x] 9.3 Implement exclusive fenced migration commits that can preserve entries and deadlines, deliberately re-enter behavior with new identities, or reject unsafe evolution
- [x] 9.4 Add migration tests for Schema-compatible field evolution, renamed state or activity identities, preserved timers, invalid migrated state, stale migration fences, and missing migration paths

## 10. Public Exports, Documentation, and Release Verification

- [x] 10.1 Export `Durable` from the root barrel and add `./Durable` to workspace and published export maps, build outputs, source maps, declarations, and package verification
- [x] 10.2 Add a quick-start durable example covering an in-memory store Layer, keyed dispatch, process restart, a continued timer, and a Schema-backed activity
- [x] 10.3 Add integration guidance showing how an activity passes its execution key to Effect Workflow, an external task queue, or an application idempotency table without promising exactly-once side effects
- [x] 10.4 Update `CONTEXT.md`, Effect conventions, package README, capability evidence, and terminology to replace the claim that invoked outputs and failures remain transient inferred-only values
- [x] 10.5 Document adapter atomicity, clock, lease, fencing, idempotency-retention, payload-sensitivity, migration, and conformance requirements
- [x] 10.6 Run formatting, type checking, unit and integration tests, API-prototype verification, strict OpenSpec validation, build, and package checks for the complete change
