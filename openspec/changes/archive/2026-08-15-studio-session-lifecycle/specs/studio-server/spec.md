# studio-server Delta

## MODIFIED Requirements

### Requirement: Sessions survive disconnects as history
The server SHALL track every announced session. When an application disconnects, its sessions SHALL be marked disconnected but remain listed with their retained history until the server stops, the session is superseded by a rerun of the same application instance, or a viewer removes it, so a crash's trail stays inspectable by default.

#### Scenario: Application crashes
- **WHEN** an application's connection drops mid-run
- **THEN** the interface shows the session as disconnected and its full retained history remains navigable

## ADDED Requirements

### Requirement: Reruns supersede their stale predecessor
When a session announcement carries an instance key that an existing session also carries, and that existing session is not connected, the server SHALL remove the existing session and notify viewers of the removal before broadcasting the new announcement. A connected session with the same instance key SHALL NOT be removed; both sessions remain listed.

#### Scenario: Hot reload replaces the dead session
- **WHEN** an application whose session is disconnected or ended reruns and announces with the same instance key
- **THEN** viewers receive a removal for the old session followed by the new announcement, and the picker shows one session for that application

#### Scenario: Two live instances coexist
- **WHEN** a second application instance announces with an instance key already held by a connected session
- **THEN** both sessions remain listed and neither history is disturbed

### Requirement: Viewers can remove non-live sessions
The server SHALL honor a viewer's removal request for a disconnected or ended session by discarding it and notifying all viewers. A removal request for a connected session SHALL be ignored without affecting the session. Removed sessions SHALL NOT be replayed to viewers that connect later.

#### Scenario: Dismissing an ended session
- **WHEN** a viewer requests removal of an ended session
- **THEN** every viewer receives the removal notification and a viewer connecting afterwards does not receive that session's announcement or history

#### Scenario: Removal of a live session is refused
- **WHEN** a viewer requests removal of a connected session
- **THEN** the session remains listed and its facts continue to flow
