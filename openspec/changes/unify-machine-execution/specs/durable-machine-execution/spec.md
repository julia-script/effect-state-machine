## MODIFIED Requirements

### Requirement: Durable instances resume from encoded checkpoints

Every machine run SHALL execute through a supplied machine engine and SHALL derive its logical instance ID from the definition identity and the definition's idempotency key for the input. The engine SHALL persist one revisioned aggregate document containing the format version, definition identity and persistence version, Schema-encoded machine and child state, lifecycle status, mailbox, absolute timer deadlines, durable entry identities, activity commands and outcomes, dispatch records, and other runtime metadata required to reconstruct owned behavior. Starting an absent instance SHALL initialize and atomically create the aggregate before work becomes eligible; starting an existing compatible instance SHALL resume it without invoking the initializer again.

#### Scenario: New durable instance starts

- **WHEN** the supplied engine cannot load an aggregate for the definition-derived instance ID
- **THEN** it initializes the machine, atomically stores its first aggregate and derived work, and only then exposes the running handle

#### Scenario: Existing durable instance resumes

- **WHEN** a persistent engine loads a compatible running aggregate for the definition-derived instance ID
- **THEN** it restores the machine, children, mailbox, entries, timers, and work without running the initializer again

#### Scenario: Invalid encoded state is loaded

- **WHEN** stored machine or child state cannot be decoded by the resumed definition's current Schemas
- **THEN** resume fails with a typed checkpoint compatibility error before any timer, event, or invocation is processed

#### Scenario: State encoding is not persistable

- **WHEN** a Schema encodes active state to a value outside the canonical persisted-value representation
- **THEN** the transition fails with a typed encoding error before the aggregate revision advances

### Requirement: Durable dispatch is idempotent by caller key

A machine handle SHALL encode every external event through the machine event Schema and atomically offer it to the instance mailbox. Sending without an idempotency key SHALL generate a fresh dispatch identity for convenience. Sending with a caller-supplied idempotency key SHALL permit retry-safe observation: reusing that key for the same encoded event SHALL refer to the original delivery, while reusing it for different encoded content SHALL fail with a typed idempotency conflict.

#### Scenario: Caller sends without a key

- **WHEN** a caller sends a valid event without dispatch options
- **THEN** the handle generates a new dispatch identity and offers one logical event

#### Scenario: Caller retries an in-flight dispatch

- **WHEN** a caller submits the same encoded event and idempotency key after losing the first response
- **THEN** the caller observes the original dispatch outcome and the machine processes the event at most once logically

#### Scenario: Caller reuses a key for different content

- **WHEN** a caller submits an event whose encoded content differs from the message already stored under that idempotency key
- **THEN** dispatch fails without replacing or duplicating the original message

#### Scenario: Event cannot be encoded

- **WHEN** a caller dispatches a value rejected by the machine event Schema
- **THEN** dispatch fails before the aggregate is changed

### Requirement: One atomic commit advances durable execution

Processing one machine-message delivery SHALL use a compare-and-set replacement of the owning aggregate that conditionally advances its expected revision, acknowledges that delivery, and publishes every timer, child update, activity command, outcome, or other message derived from the transition. Completing one activity delivery SHALL similarly replace the aggregate to acknowledge the command and publish its Schema-encoded outcome. No commit SHALL expose a partial transition.

#### Scenario: Worker stops before commit

- **WHEN** a worker stops after planning a transition but before the store accepts its aggregate replacement
- **THEN** the prior aggregate remains authoritative, no derived work becomes visible, and the delivery remains eligible for a later attempt

#### Scenario: Worker stops after commit

- **WHEN** a worker stops after the store accepts the aggregate replacement but before acknowledging success in process
- **THEN** the next worker observes the committed revision and duplicate processing cannot commit the transition again

#### Scenario: Expected revision is stale

- **WHEN** a worker attempts to replace an aggregate revision that another valid commit already advanced
- **THEN** the store rejects the replacement without changing any part of the aggregate

#### Scenario: Activity succeeds before commit

- **WHEN** invoked work produces a value accepted by its success Schema
- **THEN** acknowledging the activity and publishing its encoded success outcome occur in one aggregate replacement before a machine worker applies the outcome reducer

### Requirement: Machine messages are serialized and activity deliveries are leased

The machine engine SHALL serialize accepted machine transitions per instance by revision and SHALL represent time-bounded, fenced machine and activity claims inside the aggregate. Activity deliveries MAY run concurrently subject to authored lane concurrency. Store-authoritative time and aggregate compare-and-set SHALL prevent expired, superseded, or stale owners from committing. Delivery remains at least once until an encoded outcome commits, while revision checks, entry identities, execution identities, and message keys make accepted machine-state commits effectively once.

#### Scenario: Delivery lease expires

- **WHEN** a worker disappears while holding an aggregate-recorded claim past its lease
- **THEN** another worker can claim the delivery in a later aggregate revision

#### Scenario: Second machine worker polls the same instance

- **WHEN** one worker holds a valid machine-delivery claim for an instance
- **THEN** another worker cannot commit another machine transition until that claim is completed, released, or expired

#### Scenario: Independent activity lanes are available

- **WHEN** an active `all` invocation permits several named lanes to run concurrently
- **THEN** activity workers may hold simultaneous lane claims while machine transitions remain serialized

#### Scenario: Original worker returns after redelivery

- **WHEN** an earlier worker tries to commit using a claim superseded in a later aggregate revision
- **THEN** compare-and-set or fencing rejects that worker even if its work result is otherwise valid

### Requirement: Checkpoint compatibility is explicit

A machine definition SHALL own a persistence version independent of the engine aggregate-format version, defaulting to the initial application version when the author does not specify one. The definition SHALL also own its migrations. Resume SHALL reject a differing definition version unless the definition supplies an applicable migration; migrated state and runtime metadata MUST pass current validation before the replacement aggregate commits.

#### Scenario: Initial version is omitted

- **WHEN** an author defines a machine without an explicit persistence version
- **THEN** the definition uses the documented initial version and runs without per-run version options

#### Scenario: Definition version changed without migration

- **WHEN** resume loads an aggregate written by another persistence version and the definition has no applicable migration
- **THEN** resume fails before claiming messages or starting owned behavior

#### Scenario: Compatible migration succeeds

- **WHEN** a definition-owned migration converts the aggregate to the current persistence version and its state validates
- **THEN** the migrated aggregate commits at a new revision before normal delivery resumes

### Requirement: Store adapters share one behavioral contract

The library SHALL publish a minimal machine-store service whose durable primitives are store-authoritative time, loading an optional revisioned aggregate by instance ID, and atomically creating or compare-and-set replacing that aggregate. Queue eligibility, claims, fencing, message ordering, transition planning, and activity outcome publication SHALL remain engine behavior rather than adapter-specific operations. A reusable conformance corpus SHALL verify the primitive store contract, and an engine semantic corpus SHALL verify the complete machine behavior over every advertised adapter.

#### Scenario: Third-party store uses the primitive corpus

- **WHEN** an adapter author supplies a machine-store layer to the exported store conformance corpus
- **THEN** the corpus verifies time, absent loads, atomic create, successful revision replacement, stale-revision rejection, and persistence-boundary validation

#### Scenario: Adapter combines independent infrastructure

- **WHEN** an adapter uses persistence, locking, or wakeup infrastructure in combination
- **THEN** it hides those mechanisms behind the minimal store interface while preserving atomic compare-and-set behavior

#### Scenario: In-memory adapter is tested with virtual time

- **WHEN** a test advances the clock across a delayed message or lease deadline
- **THEN** the primitive and engine corpora observe the same eligibility, expiry, and fencing behavior required of persistent adapters

#### Scenario: Third-party adapter uses the published corpus

- **WHEN** an adapter author supplies its store layer to the exported conformance entry points
- **THEN** the adapter is checked by the same primitive contract and engine semantic cases as bundled adapters

#### Scenario: Adapter runs the engine corpus

- **WHEN** an adapter is advertised for machine execution
- **THEN** it passes engine scenarios for resumption, dispatch idempotency, deadlines, claims, fencing, activities, migrations, completion, and child machines

#### Scenario: Aggregate grows under repeated execution

- **WHEN** processed mail, execution records, or child tombstones are no longer needed for correctness
- **THEN** the engine compacts them without making a duplicate or stale delivery eligible to commit

#### Scenario: Completed instance receives an offer

- **WHEN** the engine corpus sends a keyed event to a completed instance
- **THEN** it verifies rejection without changing the aggregate or replacing the existing dispatch result

#### Scenario: Activity completion is repeated

- **WHEN** the engine corpus repeats or supersedes an activity completion attempt
- **THEN** it verifies fencing, single outcome publication, and sufficient execution-record retention

### Requirement: In-memory execution remains opt-in and unchanged

All machine execution SHALL require a machine-engine service. The library SHALL provide an explicit zero-dependency in-memory engine layer that implements the same observable execution semantics while its supplied layer instance remains alive, without claiming survival across creation of a new layer or process loss. The library MUST NOT silently install the memory engine when no engine is supplied.

#### Scenario: Existing consumer runs a machine

- **WHEN** a consumer provides the in-memory engine layer and runs a machine
- **THEN** the machine runs with the unified mailbox, timer, work, child, and identity semantics without configuring an external store

#### Scenario: Consumer omits an engine

- **WHEN** a consumer runs a machine without providing any machine-engine service
- **THEN** the Effect requirements expose the missing service rather than silently selecting volatile execution

#### Scenario: One memory layer is reused

- **WHEN** two runs with the same definition and input use the same live in-memory layer instance
- **THEN** the second run resumes the existing in-memory aggregate rather than initializing another instance

#### Scenario: A new memory layer is created

- **WHEN** the same definition and input run against a newly constructed memory layer
- **THEN** the new layer has no prior aggregate and initializes a new volatile instance

## ADDED Requirements

### Requirement: Unified execution supports child machines

An invoked child machine SHALL execute under the same engine as its parent. Its stable child identity, encoded state, lifecycle, entries, timers, work, forwarded events, and completion routing SHALL be owned by the parent aggregate so parent and child lifecycle changes can commit atomically. Resumption SHALL continue active children without reinitializing them or duplicating their completion.

#### Scenario: Parent resumes with an active child

- **WHEN** a persistent engine resumes a parent whose aggregate contains an active invoked child
- **THEN** the child resumes its stored state, deadlines, entry identities, and pending work without running its initializer again

#### Scenario: Parent exits the child owner

- **WHEN** a parent transition exits the entry that owns an invoked child
- **THEN** child cancellation and invalidation of child-owned messages and work commit atomically with the parent transition

#### Scenario: Child completes

- **WHEN** an active child enters a final state
- **THEN** its final state and one parent completion delivery commit together so resumption cannot route completion twice

#### Scenario: Event is forwarded to a child

- **WHEN** an active parent forwards an event to its invoked child
- **THEN** the child delivery is serialized through the same aggregate and observes the parent's committed ordering

### Requirement: Persistent timers retain absolute deadlines

The engine SHALL resolve each entry-owned timer against store-authoritative time and persist its absolute deadline in the same aggregate revision that creates the entry. A resume, claim retry, stay update, or process restart MUST reuse that deadline rather than recomputing or resetting the duration.

#### Scenario: Engine resumes before deadline

- **WHEN** a persistent engine resumes an active timer before its stored deadline
- **THEN** the timer waits only for the remaining interval

#### Scenario: Engine resumes after deadline

- **WHEN** a persistent engine resumes after an active timer's stored deadline
- **THEN** the timer is immediately eligible and its transition is not skipped

#### Scenario: Compare-and-set retries entry creation

- **WHEN** a stale revision forces the engine to retry a transition that creates a timer
- **THEN** the accepted aggregate contains one deadline resolved for the accepted entry and no duplicate timer

### Requirement: Browser-local storage is an explicit adapter

The browser-local adapter SHALL store canonical aggregate documents without importing or accessing browser globals from the core engine or store modules. It SHALL either coordinate compare-and-set across same-origin browser contexts or explicitly reject unsupported multi-context use; it MUST NOT claim safe cross-tab atomicity from an uncoordinated read-modify-write sequence.

#### Scenario: Page reloads before a deadline

- **WHEN** the browser reloads while an aggregate with a future timer deadline exists in local storage
- **THEN** a newly supplied browser-local layer resumes the aggregate with the original remaining time

#### Scenario: Multiple tabs contend

- **WHEN** two same-origin tabs attempt to replace the same aggregate revision
- **THEN** the adapter either serializes them through its documented coordination mechanism or rejects the unsupported topology without allowing both writes to succeed

## REMOVED Requirements

### Requirement: Durable definitions reject unsupported child machines

**Reason**: The unified engine cannot replace process-local execution while removing an existing machine capability; child lifecycle is now part of the durable aggregate contract.
