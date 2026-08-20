## ADDED Requirements

### Requirement: Durable identities are total for caller and author strings

Durable identity derivation SHALL return a deterministic identity for every JavaScript string accepted by the public identity and definition APIs, including strings containing malformed UTF-16. It MUST NOT synchronously throw from URI encoding, and distinct well-formed identity components MUST remain distinguishable.

#### Scenario: Instance identity contains an unpaired surrogate

- **WHEN** a caller derives durable entry, message, or execution keys from an instance ID containing an unpaired surrogate
- **THEN** each helper returns a deterministic branded identity without throwing

#### Scenario: Durable region key overlaps the object prototype

- **WHEN** a durable machine enters a region slot named `__proto__`
- **THEN** its checkpoint records the exact slot as own data without changing any record prototype
