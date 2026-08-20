## ADDED Requirements

### Requirement: Definitions own logical instance identity

Every executable machine definition SHALL declare an idempotency-key function from its decoded input. Running or addressing the definition SHALL derive the same logical instance ID from the definition identity and returned key, without accepting a separate instance ID at the run call.

#### Scenario: Same input identity runs twice

- **WHEN** two runs use inputs whose idempotency-key function returns the same value for the same definition
- **THEN** both runs address the same logical machine instance

#### Scenario: Distinct definitions return the same key

- **WHEN** two different definition identities return the same input idempotency key
- **THEN** their derived instance IDs remain distinct

#### Scenario: Caller addresses an existing instance

- **WHEN** a caller asks a definition for the instance ID of an input
- **THEN** it receives exactly the identity that a run with that input uses

### Requirement: Definitions own persistence evolution

An executable definition SHALL expose its persistence version and ordered migrations as inspectable definition metadata. The version SHALL default to the documented initial version, and run calls SHALL NOT accept persistence version or migration options that can disagree with the definition.

#### Scenario: Definition uses default persistence version

- **WHEN** an author omits persistence evolution metadata
- **THEN** the definition carries the documented initial version

#### Scenario: Definition evolves persisted state

- **WHEN** an author changes the persistence version and declares migrations
- **THEN** graph and engine consumers can inspect the version chain without executing the machine

#### Scenario: Run call is authored

- **WHEN** a caller runs a definition
- **THEN** TypeScript does not require or accept a separate persistence version for that run

### Requirement: Definitions expose engine-backed operations

An executable definition SHALL expose typed operations to run its input and derive or open its instance handle. Those Effects SHALL retain exact input, state, event, completion, error, machine requirement, and machine-engine service types.

#### Scenario: Definition is run

- **WHEN** a caller invokes the definition's run operation with valid input
- **THEN** the returned Effect requires the machine engine and authored services and yields a handle typed to that definition

#### Scenario: Run input is invalid

- **WHEN** TypeScript checks a run call with input outside the definition's input type
- **THEN** the call is rejected without widening the definition
