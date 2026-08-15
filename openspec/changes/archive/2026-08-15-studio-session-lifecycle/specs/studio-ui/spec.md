# studio-ui Delta

## ADDED Requirements

### Requirement: Non-live sessions can be dismissed
The interface SHALL offer a dismiss control on sessions whose connection status is disconnected or ended, and SHALL NOT offer it on connected sessions. Dismissing sends the removal request; the session leaves the picker only when the removal notification arrives. When the removed session was the one being viewed, the interface SHALL fall back to another session or the empty state without an error.

#### Scenario: Dismissing a stale session
- **WHEN** the viewer activates the dismiss control on a disconnected session
- **THEN** the session disappears from the picker for every connected viewer

#### Scenario: Viewed session is removed
- **WHEN** the session currently being viewed is removed (by this viewer, another viewer, or supersession)
- **THEN** the interface switches to another available session or its empty state, without stale panels for the removed session
