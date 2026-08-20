## MODIFIED Requirements

### Requirement: Durable work receives stable execution identity

Every invoked-work function SHALL receive a read-only execution context in addition to its state input. That context SHALL include a stable execution ID, machine instance ID, durable entry identity, owner path, invocation name, optional lane name, and delivery attempt. Restarting or redelivering work for the same active entry and lane MUST preserve its execution ID while incrementing attempts as applicable; explicit re-entry MUST produce a new execution ID. The context SHALL be present under every machine-engine implementation, including memory.

#### Scenario: Durable activity is restarted before outcome persistence

- **WHEN** a process or worker stops after activity delivery and the same active-entry activity is delivered again
- **THEN** the authored Effect receives the same execution ID and a later delivery-attempt value

#### Scenario: Invoked state is re-entered

- **WHEN** the machine exits and later re-enters the same invoked node
- **THEN** the new invocation receives a different entry identity and execution ID

#### Scenario: Work runs in memory

- **WHEN** invoked work executes under the in-memory machine engine
- **THEN** its execution context is present and stable for that layer's lifetime

#### Scenario: Existing Effect ignores metadata

- **WHEN** an author supplies a work function that accepts only the state argument because it does not need idempotency metadata
- **THEN** the declaration remains valid while the engine still invokes work through the required-context contract

## ADDED Requirements

### Requirement: Work execution identity is an external idempotency primitive

The execution context's stable ID SHALL be suitable for namespacing an idempotency key supplied to an external activity system. The library SHALL document that committing an external side effect and committing its encoded machine outcome are not one atomic transaction, and SHALL NOT claim exactly-once external effects without guarantees from that external system or integration.

#### Scenario: External side effect commits before worker loss

- **WHEN** external work commits but the worker stops before its encoded machine outcome commits
- **THEN** redelivery receives the same execution ID so an idempotent external system can return or observe the prior result

#### Scenario: External system ignores the identity

- **WHEN** authored work performs a non-idempotent external effect and does not use the execution ID
- **THEN** the machine engine provides at-least-once execution and does not represent the effect as exactly once
