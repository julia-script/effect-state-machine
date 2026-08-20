## MODIFIED Requirements

### Requirement: Store adapters share one behavioral contract

The durable execution module SHALL publish a store interface, an in-memory adapter suitable for deterministic tests, and one reusable framework-neutral conformance corpus covering every behavior required by the bundled adapter: instance creation and terminal rejection, payload-sensitive idempotency and duplicate observation, delayed visibility and ordering, machine serialization, activity concurrency, claim expiry, renewal and release, fencing, optimistic revision checks, both atomic commit forms, execution tombstones, and migration-document replacement. The bundled in-memory adapter and every adapter advertised as a durable store MUST run the same public corpus without exposing its database, queue, or transaction mechanism to machine definitions.

#### Scenario: Adapter combines independent infrastructure

- **WHEN** an adapter uses separate persistence and queue technologies internally
- **THEN** it hides any transactional-outbox or recovery mechanism behind the durable store interface while satisfying the same atomic commit behavior

#### Scenario: In-memory adapter is tested with virtual time

- **WHEN** a test advances its supplied clock across a delayed message or lease deadline
- **THEN** the public conformance corpus observes the same eligibility, renewal, expiry, and fencing behavior required of production adapters

#### Scenario: Third-party adapter uses the published corpus

- **WHEN** an adapter author supplies a Store factory to every exported conformance case
- **THEN** the adapter is checked against the complete behavior corpus used by the bundled in-memory adapter

#### Scenario: Completed instance receives an offer

- **WHEN** the conformance corpus offers a new keyed event to a completed instance
- **THEN** it verifies rejection without creating a message or replacing the existing dispatch result

#### Scenario: Activity completion is repeated

- **WHEN** the conformance corpus repeats or supersedes an activity completion attempt
- **THEN** it verifies fencing, single outcome publication, and execution tombstone retention
