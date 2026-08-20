## Context

See `proposal.md` for motivation and the delta specs for the behavioral contract. The current interpreter keeps state, generations, fibers, and its queue in process memory. `after` starts a fresh `Effect.sleep`, invocation outputs and failures are inferred TypeScript values, and `Machine.run` always executes the initializer. `encodeState` and `encodeEvent` provide useful boundaries, but observing `changes` cannot make a transition durable because state publication, timer or work startup, and caller acknowledgement are not one atomic operation.

The existing single inbox is also semantically important: external events, timers, and work outcomes are serialized, while invoked Effects and `all` or `race` lanes execute concurrently. Durable execution must preserve both properties. A store that permits one transition worker to monopolize an instance while running an Effect would incorrectly prevent an external event from exiting and cancelling that work.

Effect Workflow and Activity provide the useful precedent adopted here: durable executable boundaries have stable names, success and error Schemas, idempotent execution identities, and persisted encoded outcomes. This change does not depend on the unstable Workflow package or adopt handler replay as its state model; the state machine continues to persist its explicit tagged state and declared entry configuration.

## Goals / Non-Goals

**Goals:**

- Put checkpoint, serialized machine mailbox, concurrent activity queue, delayed timers, and idempotency records behind one deep store interface with substitutable adapters.
- Preserve existing transition, stay, re-entry, region, retry, defect, `all`, and `race` semantics across process loss.
- Make persisted values portable by deriving canonical JSON codecs from authored Schemas.
- Persist completed activity outcomes so resumption can replay them without rerunning their Effects.
- Give every external event, state entry, timer, invocation, and lane a stable identity that is deterministic across redelivery.
- Keep ordinary execution free of durable-store requirements while sharing the same Schema-backed machine definition and transition semantics.

**Non-Goals:**

- Persisting an arbitrary Effect continuation or promising exactly-once external side effects.
- Persisting the internal state of an ordinary Effect `Schedule`; a process loss may restart operational retry under the same activity execution key.
- Bundling production database, broker, or Effect Workflow adapters in the core package; the initial package provides an in-memory adapter and conformance suite.
- Durable child-machine execution in the first release. Parent-child cancellation, cross-instance commits, and orphan prevention need a separate design.
- Retaining one continuous machine-tree inspection journal or actor identity sequence across worker processes. Durable instance, entry, message, and execution identities are separate from in-process inspection actor IDs.

## Decisions

### 1. Add a separate `Durable` module and runner

`effect-state-machine/Durable` will expose the durable model, store service, runner, handle, errors, in-memory adapter, and adapter conformance contract. The root barrel will expose the same module as the `Durable` namespace. `Machine.run` remains the scoped in-memory runner and does not acquire a store.

The intended public shape is conceptually:

```ts
Durable.run(definition, input, {
  instanceId,
  persistenceVersion,
  migrations,
})
```

The operation starts an absent instance or resumes an existing one. Its Effect environment includes the authored machine requirements plus `Durable.Store`; its error channel adds typed store, compatibility, lease, encoding, and idempotency failures. The returned durable handle retains Effect-native `snapshot`, `changes`, `can`, `completion`, and keyed `send` operations.

Alternative considered: add optional persistence fields to `Machine.run`. Rejected because every caller would need to understand two acknowledgement, failure, dispatch, and execution models, making the common interface shallow and ambiguous.

### 2. Make invoked-work outcome Schemas part of every definition

Single work will declare `success` and `error` Schemas beside `effect`, `onSuccess`, and `onFailure`. Every `all` or `race` lane will use an object form with its own `success`, `error`, `effect`, and optional description. `Schema.Never` represents an impossible typed failure. The builder constrains the Effect success and error channels, including retry terminal error, to the Schemas' decoded types and derives reducer types from those Schemas.

Both runners use `Schema.toCodecJson`-derived codecs at the invoked-work boundary. Ordinary execution validates the outcome through the same codec before selecting a reducer; durable execution stores the encoded JSON outcome and decodes it when the machine mailbox consumes it. This deliberately breaks schema-less invoked work so ordinary tests exercise the same data contract on which durable replay depends.

Alternative considered: keep outcomes inferred and rerun an Effect whenever its transition was not checkpointed. Rejected after discussion because it prevents storing a completed activity result, makes partial `all` progress unrecoverable, and creates a different definition model for durable machines.

### 3. Split durable processing into machine messages and activities

The store owns two delivery domains:

```text
serialized machine mailbox             concurrent activity queue
──────────────────────────             ─────────────────────────
external event                          single invocation
timer due                               all lane
activity success/failure/defect         race lane
region activity outcome                 region invocation
internal region completion
```

At most one machine-message delivery may be claimed for an instance. Processing it evaluates one macrostep and atomically acknowledges the message, advances the checkpoint revision, records keyed dispatch completion, cancels stale pending work, and publishes derived timers or activity commands.

Activity commands are independently leased and may run concurrently. Completing an activity atomically acknowledges its command and publishes one Schema-encoded outcome message to the owning machine mailbox. The activity Effect may be rerun only until this outcome commit succeeds. Machine transitions remain serialized because activity workers never mutate the checkpoint directly.

For bounded `all`, the checkpoint records pending, running, and completed lanes and only publishes enough activity commands to fill the authored concurrency limit. Processing an outcome may publish the next lane. `race` publishes its lanes concurrently, records failures while a success remains possible, and lets the first machine-mailbox success commit exit the entry. Late activity outcomes remain safe because they carry the old durable entry identity.

Alternative considered: hold the machine delivery lease while running the Effect and commit its transition directly. Rejected because long Effects would block external events and timers, violating the current cancellation and concurrency semantics.

### 4. Use one Effect service for checkpoint and queue atomicity

`Durable.Store` is an Effect service with a stable service identifier. Its interface will expose semantic operations equivalent to:

- load or create an instance and its first derived messages atomically;
- offer an encoded external event idempotently;
- claim, renew, release, and watch one serialized machine delivery;
- claim, renew, release, and complete concurrent activity deliveries;
- atomically commit a machine delivery against its checkpoint revision and claim fence;
- read the adapter's authoritative epoch time;
- observe a keyed dispatch's pending or terminal result.

Exact names and currying will be fixed in the public API prototype, but the atomic operations themselves will not be decomposed. In particular, adapters cannot expose `saveCheckpoint`, `ack`, and `publish` as independent calls because callers could create unrecoverable dual-write windows.

The in-memory adapter uses Effect `Ref`, `Deferred`, `Clock`, and deterministic ordering. A reusable conformance suite exercises the public store interface, not adapter internals. A Postgres, SQLite, Redis, external-queue, or Effect Workflow adapter may use any mechanism—including an internal transactional outbox—provided it satisfies the same contract.

Alternative considered: independent `CheckpointStore` and `DurableQueue` services. Rejected because no interpreter-level operation could atomically advance state and publish the owned timer or activity commands.

### 5. Persist canonical envelopes and deterministic identities

Store payloads use a module-owned JSON-compatible value type and versioned Schemas. Application state, events, activity successes, and allowed errors pass through `Schema.toCodecJson`; values that cannot encode are definition or durable-encoding defects rather than adapter-specific surprises.

A checkpoint contains at least:

```text
format version
machine definition id + persistence version
durable instance id + monotonic revision
running | completed | defected status
encoded machine state
root entry id and region-slot entry ids
resolved timers: owner, name, duration, deadline, message key
aggregate work progress and encoded completed lane outcomes
next deterministic identity counters
```

Identity derivation uses the durable instance ID, target checkpoint revision, owner path, authored stable name, and optional lane name. Retrying the same proposed commit therefore produces the same entry, timer, activity, and outcome keys, while explicit re-entry advances the revision and produces new identities. External-event idempotency keys remain caller supplied and are namespaced by instance.

Activity commands persist the Schema-encoded state snapshot captured on entry. Region activity commands persist both the region snapshot and the narrowed parent entry snapshot. This preserves the existing rule that work starts from entry data even if later stay updates modify the active state before a redelivery.

Stable authored names become persistence identities. Renaming an invocation or lane while instances are active is a compatibility change and must be handled by the definition migration.

### 6. Store activity outcomes before machine transitions

An activity terminal value is encoded into the module-owned outcome union:

```text
Success { executionKey, entryId, ownerPath, lane?, encodedValue }
Failure { executionKey, entryId, ownerPath, lane?, encodedError }
Defect  { executionKey, entryId, ownerPath, lane?, sanitizedCause }
```

Success and failure use the declaration's codecs. A codec failure becomes a definition defect and does not masquerade as an allowed failure. Defects remain outside the authored error Schema and use a library-owned persisted summary; the live process may retain the original `Cause`, while a resumed completion reports a durable defect reconstructed from the stored summary.

The activity-completion commit publishes a uniquely keyed outcome message and acknowledges the activity together. If it fails, the activity lease eventually permits redelivery with the same execution key. If it succeeds, the Effect is never scheduled again even if the outcome message or the later state-transition commit is redelivered.

Alternative considered: atomically persist the activity outcome and next machine state in one worker commit. Rejected because reducers and state ownership belong to the serialized machine mailbox, and aggregate work may need several independently completed lanes.

### 7. Model timers as delayed machine messages

Entering a node resolves a dynamic duration once against the entry state. The same checkpoint commit stores `durationMillis` and `dueAtEpochMillis` and publishes a timer message keyed by instance, entry, owner path, and timer name. The store's clock is the time authority used for eligibility, avoiding disagreements between a worker clock and a database clock.

Timer messages are ordered by availability time and then durable insertion sequence. Consequently, a timer overdue at resume is eligible before a newly offered external event. A stay preserves the entry ID, deadline, and timer key; explicit re-entry creates all three anew. Exit atomically marks pending timer and activity keys cancelled where practical, while entry checks remain the correctness backstop for already claimed or late messages.

Alternative considered: store remaining duration and restart `Effect.sleep` after resume. Rejected because downtime would either pause time unexpectedly or require another non-atomic elapsed-time calculation, and overdue timers could be skipped.

### 8. Make keyed dispatch reattachable

Durable `send` requires a caller idempotency key. The store retains a canonical payload fingerprint and pending or terminal dispatch result for the lifetime of the machine instance. Repeating the same key and payload reattaches to that result; a different payload under the key fails with `IdempotencyConflict`. The Effect waits for the machine-message commit just as ordinary `send` waits for queue processing, but caller cancellation does not remove the durable message.

`can` remains an advisory query against the latest decoded checkpoint. Acceptance can change before a later `send` commit, so only processing the durable event establishes the authoritative result.

Alternative considered: generate every event key inside `send`. Retained as a possible convenience only; generated keys cannot deduplicate a retry made after the caller loses its response.

### 9. Use explicit definition versions and migrations

Checkpoint format migrations are library-owned. Application persistence versions are declared with the durable definition and are independent of package versions. Schema-compatible evolution can often be handled by Schema defaults and transformations, but a version mismatch still requires an explicit migration so stable state tags, owner paths, invocation names, lane names, entry metadata, and pending messages are considered together.

Migration runs while the store holds an exclusive fenced instance claim. It receives a versioned persisted-instance document containing the checkpoint plus its unconsumed owned messages and returns the current document. The store validates and atomically replaces that document before normal claims resume. A migration may preserve entry IDs and deadlines, deliberately re-enter owned behavior with new identities, or reject unsafe evolution.

Alternative considered: infer compatibility solely by attempting to decode state. Rejected because an unchanged state shape does not detect renamed activity or timer identities referenced by durable messages.

### 10. Share a transition-planning kernel without routing ordinary execution through the store

Transition selection, reducer application, entry/exit planning, region macrosteps, completion detection, and stale-entry checks will be extracted from the current monolithic interpreter into private pure planning functions. The ordinary interpreter applies plans to `SubscriptionRef`, `Queue`, and fibers. The durable runner converts the same plans into checkpoint and message commits.

This keeps semantic tests reusable while preserving the lightweight ordinary runtime. The private planning representation is not a public extension protocol and may evolve with the interpreter.

Alternative considered: implement a second independent durable interpreter. Rejected because timer, guard, region, and `all` or `race` semantics would inevitably drift.

### 11. Reject child nodes before touching durable state

The durable runner validates the complete definition before create or resume. Any invoked child node produces a typed unsupported-definition error before a checkpoint or claim is created. Ordinary `Machine.run` retains its current child behavior.

This is preferable to a partial implementation that starts child work but cannot atomically cancel it, fence a remote child, or prevent an orphan after parent exit. A later change can extend the store protocol with cross-instance lifecycle commits.

## Risks / Trade-offs

- **[At-least-once activity gap]** An Effect can perform an external side effect and the worker can die before persisting its encoded outcome. → Supply the stable execution key before running work, document the gap, and make integrations pass that key to Effect Workflow, a durable task system, or their own idempotency record.
- **[Store interface is demanding]** Atomic checkpoint/message commits, delayed ordering, two delivery domains, leases, and fencing exclude simplistic queue adapters. → Publish an in-memory reference adapter and executable conformance suite; keep transaction mechanisms inside adapters.
- **[Schema authoring is breaking and more verbose]** Every work channel and lane now needs Schemas. → Make the fields parallel Effect Workflow's success/error model, derive all reducer types from them, provide `Schema.Never` examples, and update every fixture and reference application in one release.
- **[Long-running activity leases]** Slow Effects require renewal and may run concurrently after lease loss. → Renew claims in a scoped heartbeat fiber, interrupt local work on renewal failure, fence completion, and rely on execution keys for external idempotency.
- **[Idempotency retention can grow]** Correct retries require message keys and dispatch results to remain recognizable. → Retain them for instance lifetime initially; define instance deletion and safe compaction separately rather than permit silent adapter-specific expiry.
- **[Clock skew]** Worker and database clocks can disagree about overdue timers. → Make store time authoritative for deadline construction and eligibility, and cover clock jumps with adapter conformance tests.
- **[Definition evolution is operationally significant]** Renamed states, timers, invocations, or lanes can strand persisted messages. → Require explicit persistence versions and fenced migrations; reject mismatches before work starts.
- **[Refactoring the interpreter can regress ordinary execution]** Extracting a shared planner touches the current highest-complexity module. → Land behavior-preserving characterization tests first and run ordinary and durable semantic suites against the same fixtures.
- **[Serialized mailbox limits per-instance throughput]** Only one machine macrostep commits at a time. → Preserve this intentionally because it is the existing consistency model; activity lanes remain concurrent across and within instances.
- **[Persisted payloads may be sensitive]** Checkpoints and activity outcomes contain application data. → Keep inspection payload projection opt-in, avoid raw error objects in defects, and document encryption and retention as adapter responsibilities.

## Migration Plan

1. Introduce success and error Schemas for invoked work, remove direct lane functions, and migrate core tests, prototypes, reference applications, graph tooling, documentation, and domain terminology. This is the intentional breaking authoring change.
2. Extract and characterize the private transition-planning kernel while retaining the current `Machine.run` implementation and behavior.
3. Add the versioned persisted models, `Durable.Store` interface, in-memory adapter, conformance suite, and public API prototype.
4. Add durable instance creation, keyed dispatch, serialized machine-message processing, delayed timers, completion, and compatibility checks.
5. Add concurrent activity workers, outcome encoding and replay, aggregate lane progress, region-owned activities, lease heartbeat, fencing, and crash-window tests.
6. Add the `Durable` root namespace and package subpath, package verification, examples, and user-facing guidance for integrating stable keys with external durable task systems.

No existing persistent data requires migration because durable execution is new. Rollback before release removes the new durable module while leaving migrated Schema-backed definitions usable by the ordinary runner. After durable instances are created, rollback requires retaining their store data and restoring code compatible with the same format and persistence versions; the runner must never silently downgrade or discard them.
