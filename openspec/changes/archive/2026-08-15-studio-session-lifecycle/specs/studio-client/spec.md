# studio-client Delta

## ADDED Requirements

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
