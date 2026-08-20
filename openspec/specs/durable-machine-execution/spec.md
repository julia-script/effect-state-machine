# durable-machine-execution Specification

## Purpose

Defines store-agnostic durable machine execution whose state, mailbox, timers, and execution identities survive process loss while preserving the state machine's serialized transition semantics.

## Requirements

### Requirement: Durable instances resume from encoded checkpoints

A durable runner SHALL identify each logical machine instance with a caller-supplied stable instance ID and SHALL persist a checkpoint containing a format version, machine definition identity and version, monotonic revision, Schema-encoded state, lifecycle status, durable state-entry identities, and the runtime metadata required to reconstruct active owned behavior. Values crossing the store interface MUST use the module's canonical JSON-compatible persisted-value representation. Starting an absent instance SHALL initialize and persist it before owned behavior becomes eligible to run; starting an existing compatible instance SHALL resume it without invoking the machine initializer again.

#### Scenario: New durable instance starts

- **WHEN** the store has no checkpoint for the supplied instance ID
- **THEN** the runner initializes the machine, atomically persists its first checkpoint and derived messages, and only then exposes the running instance

#### Scenario: Existing durable instance resumes

- **WHEN** the store contains a compatible running checkpoint for the supplied instance ID
- **THEN** the runner decodes and validates the stored state, restores its durable entry identities, and continues without running the initializer again

#### Scenario: Invalid encoded state is loaded

- **WHEN** a stored state cannot be decoded by the resumed definition's state Schema
- **THEN** resume fails with a typed checkpoint compatibility error before any timer, event, or invocation is processed

#### Scenario: State encoding is not persistable

- **WHEN** the state Schema encodes an active state to a value outside the canonical persisted-value representation
- **THEN** the transition fails with a typed durable encoding error before the checkpoint revision advances

### Requirement: Durable dispatch is idempotent by caller key

A durable handle SHALL accept an external machine event together with a caller-supplied idempotency key, encode the event through the machine event Schema, and durably offer it to that instance's mailbox. Reusing a key for the same logical message SHALL refer to the original delivery and MUST NOT create another transition; reusing it for different encoded content SHALL fail with a typed idempotency conflict.

#### Scenario: Caller retries an in-flight dispatch

- **WHEN** a caller submits the same encoded event and idempotency key after losing the first response
- **THEN** the caller observes the original dispatch outcome and the machine processes the event at most once logically

#### Scenario: Caller reuses a key for different content

- **WHEN** a caller submits an event whose encoded content differs from the message already stored under that idempotency key
- **THEN** dispatch fails without replacing or duplicating the original message

#### Scenario: Event cannot be encoded

- **WHEN** a caller dispatches a value rejected by the machine event Schema
- **THEN** dispatch fails before any durable message is offered

### Requirement: One atomic commit advances durable execution

Processing one durable machine-message delivery SHALL produce one store commit that conditionally advances the expected checkpoint revision, acknowledges that delivery, and publishes every timer, activity command, or other message derived from the transition. Completing one durable activity delivery SHALL produce one store commit that acknowledges the activity and publishes its Schema-encoded outcome to the owning machine mailbox. Neither commit form SHALL expose any partial result.

#### Scenario: Worker stops before commit

- **WHEN** a worker stops after claiming a message but before the store accepts its commit
- **THEN** the prior checkpoint remains authoritative, no derived message becomes visible, and the claimed message becomes eligible for redelivery

#### Scenario: Worker stops after commit

- **WHEN** a worker stops after the store accepts the commit but before acknowledging success to an in-process caller
- **THEN** the next worker observes the committed checkpoint and duplicate delivery cannot commit the transition again

#### Scenario: Expected revision is stale

- **WHEN** a worker attempts to commit against a checkpoint revision that another valid commit has already advanced
- **THEN** the store rejects the commit without partially acknowledging or publishing anything

#### Scenario: Activity succeeds before commit

- **WHEN** an invoked Effect produces a value accepted by its success Schema
- **THEN** acknowledging the activity delivery and publishing its encoded success outcome occur atomically before a machine worker applies the outcome reducer

### Requirement: Machine messages are serialized and activity deliveries are leased

The store contract SHALL provide at most one active time-bounded machine-message claim per machine instance so transitions remain serialized. Activity deliveries SHALL also be time-bounded and fenced but MAY be claimed concurrently subject to authored lane concurrency. The store SHALL reject commits made with expired or superseded claims. Delivery is at least once, while checkpoint revision checks, entry identities, encoded outcome idempotency, and message keys SHALL make accepted machine-state commits effectively once.

#### Scenario: Delivery lease expires

- **WHEN** a worker disappears while holding a delivery past its lease
- **THEN** another worker can claim the message and continue processing it

#### Scenario: Second machine worker polls the same instance

- **WHEN** one worker already holds a valid delivery claim for a machine instance
- **THEN** another worker cannot claim a different message for that instance until the first claim is committed, released, or expires

#### Scenario: Independent activity lanes are available

- **WHEN** an active `all` invocation permits several named lanes to run concurrently
- **THEN** activity workers may hold simultaneous claims for those lanes while machine-message processing for their owning instance remains serialized

#### Scenario: Original worker returns after redelivery

- **WHEN** an earlier worker tries to commit using a claim superseded by another worker
- **THEN** the store rejects the stale worker's commit even if its expected checkpoint revision has not otherwise changed

### Requirement: Durable activity outcomes are encoded and replayable

Every durable activity SHALL declare success and allowed-failure Schemas. The activity worker SHALL encode its terminal typed outcome before atomically acknowledging the activity command and publishing a uniquely keyed outcome message. A machine worker SHALL decode the outcome with the same declaration before selecting its success or failure transition. Once the encoded outcome commit succeeds, process loss MUST NOT cause that activity execution to run again.

#### Scenario: Worker stops before outcome persistence

- **WHEN** an activity Effect finishes but its delivery claim expires before the encoded outcome commit succeeds
- **THEN** the activity command becomes eligible for at-least-once redelivery with the same execution key

#### Scenario: Worker stops after outcome persistence

- **WHEN** an activity worker stops after atomically publishing its encoded outcome
- **THEN** a machine worker consumes the durable outcome without executing the activity Effect again

#### Scenario: Effect returns an undeclared success value

- **WHEN** an activity succeeds with a value its declared success Schema cannot encode
- **THEN** the durable instance records a definition defect without publishing an invalid outcome message

#### Scenario: Effect fails with an undeclared allowed error

- **WHEN** an activity fails in its typed channel with a value its allowed-failure Schema cannot encode
- **THEN** the durable instance records a definition defect rather than treating the value as a declared failure transition

### Requirement: Durable aggregate work checkpoints lane progress

Durable `all` and `race` work SHALL publish separately keyed activity commands for their named lanes and SHALL persist encoded lane outcomes as entry-owned progress. `all` SHALL transition only after every lane succeeds or one lane fails; `race` SHALL transition on the first committed success or after every lane has failed. Resumption SHALL reuse committed lane outcomes and MUST NOT rerun their Effects.

#### Scenario: Process stops after one all lane completes

- **WHEN** one `all` lane outcome is committed and the process stops while other lanes remain pending
- **THEN** resume retains the completed lane outcome and executes only lanes without a committed result

#### Scenario: Race success is followed by a late outcome

- **WHEN** one `race` lane success commits the state transition and another lane later publishes an outcome for the exited entry
- **THEN** the late outcome is rejected as stale and cannot replace the winning transition

### Requirement: Delayed messages preserve timer deadlines

The durable mailbox SHALL support messages that become eligible at an absolute deadline. A durable `after` timer SHALL be offered in the same atomic commit that creates its owning entry, using an idempotency key derived from the machine instance, durable entry identity, owner path, and timer identity.

#### Scenario: Process resumes before deadline

- **WHEN** an active timer's process stops and the instance resumes before its stored deadline
- **THEN** the timer remains unavailable until that original deadline rather than receiving a full new delay

#### Scenario: Process resumes after deadline

- **WHEN** an active timer's process stops and the instance resumes after its stored deadline
- **THEN** the timer is immediately eligible and is processed before newly accepted external events

#### Scenario: Timer message is redelivered

- **WHEN** a due timer delivery is retried after a failed processing attempt
- **THEN** its stable key and owning entry identity prevent more than one timer transition from being committed

### Requirement: Checkpoint compatibility is explicit

A durable definition SHALL declare a persistence version independent of the checkpoint format version. Resume SHALL reject a differing definition version unless the caller supplies a migration from the stored version to the current version; migrated state and runtime metadata MUST pass current validation before the migrated checkpoint can be committed.

#### Scenario: Definition version changed without migration

- **WHEN** resume loads a checkpoint written by a different persistence version and no applicable migration is supplied
- **THEN** resume fails before claiming mailbox messages or starting owned behavior

#### Scenario: Compatible migration succeeds

- **WHEN** a supplied migration converts the checkpoint to the current persistence version and its state validates
- **THEN** the migrated checkpoint is committed at a new revision before normal delivery resumes

### Requirement: Completion is durable

Entering a final state SHALL atomically persist the final encoded state and completed status while acknowledging the delivery that caused completion. Resuming a completed instance SHALL expose its final snapshot and completion value without restarting owned behavior or accepting new events.

#### Scenario: Process stops after final commit

- **WHEN** the process stops after final-state persistence but before the awaiting caller observes completion
- **THEN** resuming the instance yields the same completion without reprocessing the causal message

#### Scenario: Event targets completed instance

- **WHEN** a caller dispatches to a durably completed instance
- **THEN** dispatch fails according to completed-machine protocol semantics and no mailbox message is added

### Requirement: Store adapters share one behavioral contract

The durable execution module SHALL publish a store interface, an in-memory adapter suitable for deterministic tests, and a reusable conformance suite covering idempotency, delayed visibility, leasing, fencing, optimistic revision checks, and atomic commits. Every adapter advertised as a durable store MUST pass that suite without exposing its database, queue, or transaction mechanism to machine definitions.

#### Scenario: Adapter combines independent infrastructure

- **WHEN** an adapter uses separate persistence and queue technologies internally
- **THEN** it hides any transactional-outbox or recovery mechanism behind the durable store interface while satisfying the same atomic commit behavior

#### Scenario: In-memory adapter is tested with virtual time

- **WHEN** a test advances its supplied clock across a delayed message deadline
- **THEN** the in-memory adapter exposes the same eligibility and claim behavior required of production adapters

### Requirement: Durable definitions reject unsupported child machines

The first durable runner SHALL support ordinary state, invoked-work, region, and final nodes and SHALL reject any definition containing an invoked child machine before creating or resuming a durable instance. Ordinary `Machine.run` child behavior SHALL remain unchanged.

#### Scenario: Durable definition contains a child node

- **WHEN** a caller attempts to start or resume a durable definition containing an invoked child machine
- **THEN** the durable runner fails with a typed unsupported-definition error before writing a checkpoint or claiming a message

#### Scenario: Durable definition contains region work and timers

- **WHEN** a durable definition uses region-owned work or `after` transitions without child machines
- **THEN** the durable runner supports their entry identities, invocation keys, deadlines, and atomic commits

### Requirement: In-memory execution remains opt-in and unchanged

The existing scoped `Machine.run` interface SHALL continue to execute without a durable store, durable instance ID, event idempotency key, or persistence migration. Importing or using ordinary machine execution MUST NOT initialize a durable adapter or require durable execution dependencies.

#### Scenario: Existing consumer runs a machine

- **WHEN** an existing consumer uses `Machine.run` without importing the durable module
- **THEN** its handle and process-local execution semantics remain compatible with the pre-change behavior
