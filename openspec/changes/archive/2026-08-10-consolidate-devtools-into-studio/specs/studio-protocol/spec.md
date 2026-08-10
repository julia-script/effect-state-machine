## Purpose

Defines the versioned message vocabulary exchanged between an application's attached machine and Studio, so any transport and any Studio host can interoperate without sharing code.

## ADDED Requirements

### Requirement: Sessions are identified on every message
Every protocol message SHALL carry a session identifier that is unique per attached machine instance for the lifetime of the connection. A session announcement SHALL identify the application (name, runtime kind) and the machine (id, description) so multiple applications and multiple machines can share one Studio.

#### Scenario: Two machines from one application
- **WHEN** an application attaches two machine instances over one connection
- **THEN** each attach produces a distinct session identifier and their facts never interleave into one history

### Requirement: Session announcement is self-describing
The first message of a session SHALL contain everything Studio needs to render the machine without access to application code: the protocol version, machine metadata, the serialized behavior graph (nodes with kind, title, description, and source location; edges with event and target), and standard JSON Schema documents for each state variant, event variant, and invocation outcome.

#### Scenario: Studio renders an unknown machine
- **WHEN** Studio receives a session announcement for a machine it has never seen
- **THEN** it can render the full behavior map, detail cards with descriptions and JSON Schemas, and source links using only the announcement payload

#### Scenario: Incompatible protocol version
- **WHEN** a session announces a protocol version the receiver does not support
- **THEN** the session is rejected with a message naming both versions, and other sessions are unaffected

### Requirement: Facts flow from application to Studio
After announcement, the application side SHALL emit ordered facts per session: raw inspection events, committed state snapshots encoded via the machine's schema, and terminal status (completed or defected). Facts SHALL be JSON-serializable and delivered in emission order within a session.

#### Scenario: State snapshot is renderable
- **WHEN** a state commit fact arrives
- **THEN** its payload is the schema-encoded state value, sufficient to render the state JSON and compute a diff against the previous snapshot

### Requirement: Dispatches flow from Studio to application
Studio SHALL be able to send, per session: a quick-event dispatch referencing a quick event by identifier, and a custom-event dispatch carrying a JSON value. The application side SHALL answer each dispatch with an outcome — accepted, or failed with a reason (unknown quick event, factory error, event invalid against the machine schema, event not accepted in the current state, or machine no longer running).

#### Scenario: Custom event rejected
- **WHEN** Studio dispatches a custom event whose JSON does not decode against the machine's event schema
- **THEN** the application answers with a failure carrying the "invalid" reason and a human-readable message, and the machine receives nothing

### Requirement: View state never crosses the wire
Cursor position, selected step, graph depth, zoom, theme, and any other per-viewer presentation state SHALL NOT appear in the protocol. The wire carries facts and dispatches only.

#### Scenario: Time travel is local
- **WHEN** a Studio viewer moves its history cursor to a past step
- **THEN** no protocol message is sent and the application's machine is unaffected
