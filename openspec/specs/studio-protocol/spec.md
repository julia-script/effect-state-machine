# studio-protocol Specification

## Purpose

Defines the versioned message vocabulary exchanged between an application's attached machine and Studio, so any transport and any Studio host can interoperate without sharing code.
## Requirements
### Requirement: Sessions are identified on every message
Every protocol message SHALL carry a session identifier that is unique per attached root-machine execution for the lifetime of the connection. A session announcement SHALL identify the application, runtime kind, root actor, and root machine. Facts and dispatches concerning a particular machine instance SHALL additionally carry its actor identifier so one session can contain the complete descendant tree.

#### Scenario: Two root executions from one application
- **WHEN** an application attaches two root machine executions over one connection
- **THEN** each attachment produces a distinct session identifier and their facts never interleave into one history

#### Scenario: Root starts a child
- **WHEN** an attached root actor starts a child actor
- **THEN** the child's messages retain the root session identifier and identify the child actor rather than announcing a second session

### Requirement: Session announcement is self-describing
The first message of a session SHALL contain everything Studio needs to render the complete machine tree without access to application code: the protocol version, application and root-machine metadata, root actor identity, every statically reachable machine definition, each definition's serialized behavior graph, standard JSON Schema documents for every state and event variant and invocation outcome, and quick-event controls associated with their definition. Serialized graph metadata SHALL retain region parent/slot paths, region slot names, timer duration and target, and invoked-work kind, lanes, concurrency, and retry policy. Definition and graph references SHALL be unambiguous when tags or node identifiers repeat across machines.

#### Scenario: Studio renders an unknown machine tree
- **WHEN** Studio receives a session announcement containing root and nested machine definitions it has never seen
- **THEN** it can render the complete expanded behavior map, detail cards, schemas, quick events, and source links using only the announcement payload

#### Scenario: Incompatible protocol version
- **WHEN** a session announces a protocol version the receiver does not support
- **THEN** the session is rejected with a message naming both versions, and other sessions are unaffected

### Requirement: Facts flow from application to Studio
After announcement, the application side SHALL emit one ordered fact stream for the session. Every fact SHALL carry a strictly increasing session sequence and producing actor identifier. Facts SHALL include actor lifecycle, raw inspection events, state snapshots encoded using the actor's machine definition, and terminal status. Statechart inspection facts SHALL retain transition owner paths and macrostep identity, work kinds and lanes, timer lifecycle, and stale-outcome identity. Facts SHALL be JSON-serializable, delivered in session sequence order, and never attributed to a different actor.

#### Scenario: Child state snapshot is renderable
- **WHEN** a child actor commits state
- **THEN** the fact identifies the child actor and its payload is encoded by that actor's state schema, sufficient to render its state JSON and compute a diff against its previous snapshot

#### Scenario: Child lifecycle is causally ordered
- **WHEN** a child starts, produces facts, and terminates
- **THEN** its start precedes its machine facts, its terminal fact follows them, and the entire sequence is ordered relative to parent and sibling facts

### Requirement: Dispatches flow from Studio to application
Studio SHALL be able to send, per session and actor: a quick-event dispatch referencing a quick event associated with that actor's machine definition, and a custom-event dispatch carrying a JSON value. The application side SHALL answer each dispatch with an outcome of accepted or failed with a reason, including unknown actor, actor no longer running, unknown quick event, factory error, event invalid against the actor's machine schema, or event not accepted in the actor's current state.

#### Scenario: Custom event rejected
- **WHEN** Studio dispatches a custom event whose JSON does not decode against the addressed actor's event schema
- **THEN** the application answers with an "invalid" failure and a human-readable message, and no actor receives the event

#### Scenario: Dispatch targets ended child
- **WHEN** Studio dispatches to a child actor that has completed, cancelled, or defected
- **THEN** the application answers that the actor is no longer running and no other actor receives the event

### Requirement: View state never crosses the wire
Cursor position, selected step, graph depth, zoom, theme, and any other per-viewer presentation state SHALL NOT appear in the protocol. The wire carries facts and dispatches only.

#### Scenario: Time travel is local
- **WHEN** a Studio viewer moves its history cursor to a past step
- **THEN** no protocol message is sent and the application's machine is unaffected

### Requirement: Session announcements carry application instance identity
A session announcement SHALL carry an instance key: a stable string identifying the application instance lineage the session belongs to, such that reruns of the same application produce the same instance key while distinct applications produce distinct keys. The instance key identifies lineage only; it SHALL NOT replace the session identifier on any message.

#### Scenario: Rerun announces the same lineage
- **WHEN** an application is stopped and rerun with an unchanged configuration
- **THEN** the new session announcement carries the same instance key as the previous run's announcement while carrying a different session identifier

#### Scenario: Announcement without an instance key
- **WHEN** a session announcement carries no instance key
- **THEN** the session is accepted and treated as having no lineage, and no lineage-based behavior applies to it

### Requirement: Session removal flows in both directions
The protocol SHALL include a viewer-originated request to remove a session by identifier, and a server-originated notification that a session was removed. The removal notification SHALL apply regardless of the removal cause (viewer request or supersession) and instructs the receiver to discard the session and its history.

#### Scenario: Viewer requests removal
- **WHEN** a viewer sends a removal request for a session identifier
- **THEN** the message carries only the session identifier and no history or view state

#### Scenario: Removal is broadcast
- **WHEN** the server removes a session for any reason
- **THEN** every connected viewer receives one removal notification carrying that session identifier

