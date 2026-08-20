## ADDED Requirements

### Requirement: Region slot names are treated as data keys

The runtime SHALL preserve every valid authored region-slot name as an own data property when projecting or committing region state. Slot names that overlap JavaScript object prototype properties MUST NOT mutate prototypes, disappear, or alias another slot.

#### Scenario: Region slot is named proto

- **WHEN** a machine declares and transitions a region slot named `__proto__`
- **THEN** the committed state contains an own `__proto__` slot with the authored tagged value and its object prototype is unchanged

#### Scenario: Region slots overlap constructor properties

- **WHEN** parallel regions use the names `constructor` and `prototype`
- **THEN** both slots transition independently and are observable under their exact authored names
