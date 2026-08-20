## ADDED Requirements

### Requirement: Definition paths are total for authored names

Definition-path construction SHALL deterministically encode every state tag and invocation name accepted by a machine definition without synchronously throwing for malformed UTF-16. The resulting path SHALL preserve parent/child ownership and remain unambiguous for well-formed authored names.

#### Scenario: Child invocation contains an unpaired surrogate

- **WHEN** a child definition path is constructed from a state tag or invocation name containing an unpaired surrogate
- **THEN** tree execution and inspection receive a deterministic child path without a URI encoding defect
