# studio-protocol Delta

## ADDED Requirements

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
