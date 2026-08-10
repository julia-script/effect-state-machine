## Purpose

The application-facing API that connects a running machine to Studio: attaching a machine, serializing facts, executing dispatches, and staying inert when Studio is not there.

## ADDED Requirements

### Requirement: Attach connects a machine to Studio
The client SHALL expose an attach operation taking a machine definition's metadata, a running machine handle, and optionally quick events (predefined event values, or factories evaluated per dispatch). Attaching SHALL observe the machine without interrupting it, and releasing the attachment's scope SHALL end the session without affecting the machine.

#### Scenario: Attach observes without owning
- **WHEN** an attachment's scope closes while the machine is still running
- **THEN** the session ends, the machine continues running, and no further facts are emitted

#### Scenario: Quick event factories stay application-side
- **WHEN** a quick event is defined with a factory function
- **THEN** only its identifier, label, description, and grouping are announced to Studio, and the factory executes in the application when dispatched

### Requirement: Attach is inert without Studio
When no Studio is reachable, attach SHALL succeed immediately, never block or slow the machine, never surface an error to the application, and retry the connection in the background for the attachment's lifetime.

#### Scenario: Studio never started
- **WHEN** an application runs with attach in place and Studio is never launched
- **THEN** the application behaves identically to running without attach, with no errors or warnings escalated to the application

#### Scenario: Studio starts late
- **WHEN** Studio becomes reachable after the machine has been running
- **THEN** the client connects, announces the session, and delivers buffered facts so Studio shows the history from machine start

### Requirement: Facts are buffered across disconnects
The client SHALL retain a session's facts while disconnected and replay unsent facts upon (re)connection, preserving order. The buffer MAY be bounded; when facts are dropped, the client SHALL report the dropped count so Studio can indicate truncated history.

#### Scenario: Reconnect resumes without duplication
- **WHEN** the connection drops and is later re-established
- **THEN** Studio ends up with each fact exactly once, in order, possibly preceded by a truncation notice

### Requirement: Dispatches execute against the live machine
On a quick-event dispatch the client SHALL resolve the identifier, evaluate the factory when present, verify the machine currently accepts the event, and send it. On a custom-event dispatch it SHALL decode the JSON against the machine's event schema before the same acceptance check. Every failure (unknown id, factory error, invalid JSON, unaccepted event, machine not running) SHALL be answered with its reason instead of being thrown into the application.

#### Scenario: Unaccepted quick event
- **WHEN** Studio dispatches a quick event whose event the current state does not accept
- **THEN** the machine receives nothing and Studio is answered with an "unavailable" outcome

### Requirement: Transport is swappable
The connection mechanism SHALL be an injectable service behind the attach API. The default implementation connects to the local Studio server; an in-memory implementation SHALL exist for tests. Client behavior (announcement, buffering, dispatch handling) SHALL be identical across transports.

#### Scenario: Tests run without a server
- **WHEN** the client is exercised with the in-memory transport
- **THEN** the full announce/facts/dispatch behavior is observable without any network listener
