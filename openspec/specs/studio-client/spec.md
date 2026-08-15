# studio-client Specification

## Purpose

The application-facing API that connects a running machine to Studio: attaching a machine, serializing facts, executing dispatches, and staying inert when Studio is not there.
## Requirements
### Requirement: Attach connects a machine to Studio
The client SHALL expose an attach operation taking a root machine definition's metadata, its running root handle, and optionally quick events associated with addressable machine definitions. One attachment SHALL announce and observe the root actor and every descendant actor as one session without interrupting execution. Releasing the attachment's scope SHALL end the session without affecting any machine in the tree.

#### Scenario: Attach observes without owning
- **WHEN** an attachment's scope closes while the machine is still running
- **THEN** the session ends, every machine continues according to normal ownership, and no further facts are emitted to Studio

#### Scenario: Child starts after attachment
- **WHEN** an attached root machine starts a child or deeper descendant
- **THEN** the client emits that actor's lifecycle and facts within the existing root session without creating another session

#### Scenario: Quick event factories stay application-side
- **WHEN** a quick event is defined with a factory function for an addressable machine definition
- **THEN** only its identifier, label, description, grouping, and definition association are announced to Studio, and the factory executes in the application when dispatched

### Requirement: Attach is inert without Studio
When no Studio is reachable, attach SHALL succeed immediately, never block or slow any machine in the tree, never surface an error to the application, and retry the connection in the background for the attachment's lifetime.

#### Scenario: Studio never started
- **WHEN** an application runs with attach in place and Studio is never launched
- **THEN** the application behaves identically to running without attach, with no errors or warnings escalated to the application

#### Scenario: Studio starts late
- **WHEN** Studio becomes reachable after root and descendant actors have produced facts
- **THEN** the client connects, announces the root session, and delivers buffered tree facts so Studio shows the history from root-machine start

### Requirement: Facts are buffered across disconnects
The client SHALL retain a session's globally sequenced root and descendant facts while disconnected and replay unsent facts upon reconnection without changing their tree-wide order. The buffer MAY be bounded; when facts are dropped, the client SHALL report the dropped sequence range and count so Studio can indicate truncated history.

#### Scenario: Reconnect resumes without duplication
- **WHEN** the connection drops while multiple actors are active and is later re-established
- **THEN** Studio ends up with each retained fact exactly once in tree-wide sequence order, possibly preceded by a truncation notice

### Requirement: Dispatches execute against the addressed live actor
Every dispatch SHALL identify an actor in the root session. On a quick-event dispatch the client SHALL resolve the control for that actor's machine definition, evaluate the factory when present, verify the actor currently accepts the event, and send it. On a custom-event dispatch it SHALL decode the JSON against the addressed actor's event schema before the same acceptance check. Every failure, including unknown actor, terminated actor, unknown quick event, factory error, invalid JSON, or unaccepted event, SHALL be answered with its reason instead of being thrown into the application.

#### Scenario: Unaccepted quick event
- **WHEN** Studio dispatches a quick event whose event the current state does not accept
- **THEN** no actor receives the event and Studio is answered with an "unavailable" outcome

#### Scenario: Child receives a custom event
- **WHEN** Studio sends valid custom-event JSON to a live child actor that accepts the decoded event
- **THEN** the client sends the event to that child actor only and answers with an accepted outcome

### Requirement: Transport is swappable
The connection mechanism SHALL be an injectable service behind the attach API. The default implementation connects to the local Studio server; an in-memory implementation SHALL exist for tests. Client behavior (announcement, buffering, dispatch handling) SHALL be identical across transports.

#### Scenario: Tests run without a server
- **WHEN** the client is exercised with the in-memory transport
- **THEN** the full announce/facts/dispatch behavior is observable without any network listener

### Requirement: Attach announces a stable instance identity
An attachment SHALL announce an instance key that is stable across reruns of the same application: derived from the announced application name and root machine identity by default, and overridable by the caller. The derivation SHALL NOT include per-run randomness.

#### Scenario: Default key is stable across reruns
- **WHEN** the same machine is attached with the same options in two consecutive process runs
- **THEN** both announcements carry the same instance key

#### Scenario: Caller distinguishes deliberate parallel instances
- **WHEN** the caller supplies an explicit instance key per attachment
- **THEN** each announcement carries the supplied key unchanged

### Requirement: Viewer state drops removed sessions
A viewer client receiving a session-removal notification SHALL delete that session and its folded history from its world state. If the removal is immediately followed by an announcement reusing the same instance lineage, the new session SHALL appear as a fresh session with no inherited history.

#### Scenario: Superseded session disappears from world state
- **WHEN** the viewer client receives a removal for a session it holds, followed by a new announcement from the rerun
- **THEN** the old session is absent from world state and the new session starts with an empty history

