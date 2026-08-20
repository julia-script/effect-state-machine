## ADDED Requirements

### Requirement: Every durable envelope is validated at the persistence boundary

Every checkpoint, machine message, activity command, activity outcome, dispatch record, and migration document passed to a Store SHALL conform to its published Schema and the canonical JSON-compatible persisted-value representation. A decoded application value MUST NOT be substituted for its encoded representation by assertion or fallback. Validation failure SHALL produce a typed durable encoding error before any delivery is acknowledged or checkpoint revision advances.

#### Scenario: Transformed state encodes a region differently

- **WHEN** a state Schema decodes a rich runtime value but encodes its region slot into a different persisted representation
- **THEN** the activity command contains only the encoded slot derived from the persisted parent state

#### Scenario: Encoded parent omits an active region slot

- **WHEN** entry planning cannot locate a required region slot in the Schema-encoded parent state
- **THEN** planning fails with a typed durable encoding error and no command or checkpoint is committed

#### Scenario: Activity outcome envelope is not canonical JSON

- **WHEN** a constructed activity outcome fails its published Schema or canonical JSON validation
- **THEN** the activity delivery remains unacknowledged and no invalid outcome message is offered

### Requirement: Compatibility failures identify the mismatched dimension

A checkpoint compatibility failure SHALL expose a machine-readable reason that distinguishes checkpoint-format mismatch, definition-identity mismatch, persistence-version mismatch, and missing migration path. Each reason SHALL carry fields specific to that dimension. Boundary errors MAY retain an opaque live cause for diagnostics, but persisted defect summaries MUST remain sanitized and restart-safe.

#### Scenario: Checkpoint format is unsupported

- **WHEN** resume loads a checkpoint with an unsupported format version
- **THEN** it fails with a format-mismatch reason containing the supported and stored format versions

#### Scenario: Definition identity differs

- **WHEN** resume loads a checkpoint written for another machine definition
- **THEN** it fails with a definition-mismatch reason containing both definition identities

#### Scenario: Migration path is incomplete

- **WHEN** the stored persistence version differs and no migration continues the path to the requested version
- **THEN** it fails with a missing-migration reason containing the current and target persistence versions

#### Scenario: Adapter wraps an external failure

- **WHEN** a Store adapter translates a database or queue failure into the durable error channel
- **THEN** the semantic operation fields remain branchable and the live error may retain the original failure as an opaque cause
