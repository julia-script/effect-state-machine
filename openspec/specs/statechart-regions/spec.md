# statechart-regions Specification

## Purpose

Defines compound and parallel statechart regions represented directly in tagged state data, including selection, atomic commits, completion, and lifecycle behavior.

## Requirements

### Requirement: Tagged-union fields opt into live regions

A region-bearing state SHALL declare one or more of its tagged-union fields as live region slots. Each declared slot SHALL provide exactly one node for every tag in that field's union. One declared slot SHALL behave as a compound region and multiple declared slots SHALL behave as parallel regions.

#### Scenario: One region is declared

- **WHEN** a state declares one tagged-union field as a region slot
- **THEN** the field's current tagged value identifies the one active child state

#### Scenario: Parallel regions are declared

- **WHEN** a state declares two or more tagged-union fields as region slots
- **THEN** each field independently identifies one active child state at the same time

#### Scenario: Region record is incomplete

- **WHEN** a region declaration omits a tag from its slot's tagged union
- **THEN** TypeScript rejects the declaration

#### Scenario: Field is not a valid region slot

- **WHEN** an author declares a field that is not a tagged-union field of the parent state
- **THEN** TypeScript rejects the region key

### Requirement: Region configuration is state data

Every transition entering a region-bearing top-level state SHALL supply the value of each required region slot as part of the destination fields. The runtime SHALL use those values as the initial active region configuration and SHALL NOT apply hidden region defaults.

#### Scenario: Parent state is entered

- **WHEN** a transition enters a state with playback and volume regions
- **THEN** its reducer supplies both tagged slot values and those exact tags become active

#### Scenario: Parent state is re-entered

- **WHEN** a transition explicitly targets the active region-bearing parent state
- **THEN** the reducer-supplied slot values replace the previous region configuration and the new active child nodes are entered

### Requirement: Region reducers are locally typed and bounded

A region event reducer SHALL receive the active slot variant, the narrowed event variant, and a read-only view of the whole parent state. Its target SHALL be restricted to tags in that same slot, and its result SHALL contain only the destination slot variant's fields except `_tag`.

#### Scenario: Region transition reads parent data

- **WHEN** work or a reducer in a playback region needs the parent's track identifier
- **THEN** it can read the narrowed parent state without gaining authority to replace parent or sibling fields

#### Scenario: Region transition crosses a slot boundary

- **WHEN** a region transition targets a tag belonging to another slot or to the top-level machine
- **THEN** TypeScript rejects the target

### Requirement: Event selection is innermost-first

For an event received while a region-bearing state is active, the runtime SHALL first select handlers in all active region child nodes. If at least one active child handles or explicitly ignores the event, the parent handler SHALL NOT run. The parent handler SHALL be considered only when no active child has a response for that event.

#### Scenario: Child and parent both handle an event

- **WHEN** an active region child and its parent declare responses for the same event
- **THEN** the child response is selected and the parent response is not evaluated

#### Scenario: Only parent handles an event

- **WHEN** no active region child declares a response and the parent does
- **THEN** the parent response is selected

#### Scenario: Child ignores an event

- **WHEN** an active child explicitly ignores an event also handled by the parent
- **THEN** the event is accepted without a state change and the parent handler does not run

### Requirement: Parallel region transitions commit as one macrostep

When active children in multiple parallel slots respond to the same event, the runtime SHALL select each response against the same pre-event parent snapshot, run only the selected reducers, and atomically commit all resulting slot values as one parent state update. A response in one slot SHALL NOT observe another slot's result from the same macrostep.

#### Scenario: Two regions handle one event

- **WHEN** active nodes in two parallel slots both declare a transition for the event
- **THEN** both slot transitions occur and observers see one committed parent configuration rather than an intermediate half-updated state

#### Scenario: Sibling reducer reads parent

- **WHEN** a region reducer reads a sibling slot through its parent input
- **THEN** it sees the sibling's value from before the event macrostep

### Requirement: Region node ownership follows active configuration

Entering an active region child SHALL start that child's owned timer or work. Leaving it, re-entering it by an explicit self-target, or exiting its parent SHALL interrupt the owned timer or work before the replacement child is entered. A region stay SHALL preserve the current child's owned timer and work.

#### Scenario: Parent exits

- **WHEN** a parent transition leaves a region-bearing state
- **THEN** owned work in every active region child is interrupted

#### Scenario: Region self-targets

- **WHEN** a region explicitly transitions to its current tag
- **THEN** that child is exited and entered and its owned work restarts

#### Scenario: Region stays

- **WHEN** a region stay updates the active slot
- **THEN** its owned work remains active

### Requirement: Region completion requires every slot to be final

A region-bearing parent SHALL become complete only when the active node in every declared slot is final. If an `onComplete` transition is declared, the runtime SHALL select it once after the macrostep that first establishes complete configuration, using the completed parent state as reducer input.

#### Scenario: One parallel region finishes early

- **WHEN** one slot reaches a final child while another slot remains non-final
- **THEN** the parent does not complete

#### Scenario: Last region reaches final

- **WHEN** the final unfinished slot reaches a final child
- **THEN** the parent becomes complete and its `onComplete` transition runs once if declared

#### Scenario: Completed configuration has no completion transition

- **WHEN** every region is final and the parent declares no `onComplete`
- **THEN** the completed configuration remains stable until a parent-level transition exits it

### Requirement: Undeclared unions remain inert data

A tagged-union field SHALL have region behavior only when the enclosing node explicitly declares it as a region slot. An undeclared field SHALL remain ordinary state data and SHALL NOT activate nodes, receive events, start work, or participate in completion.

#### Scenario: History is carried as data

- **WHEN** a machine stores a former region value in an undeclared tagged-union field
- **THEN** the value can later be restored by a reducer without creating a hidden active region

### Requirement: Region slot names are treated as data keys

The runtime SHALL preserve every valid authored region-slot name as an own data property when projecting or committing region state. Slot names that overlap JavaScript object prototype properties MUST NOT mutate prototypes, disappear, or alias another slot.

#### Scenario: Region slot is named proto

- **WHEN** a machine declares and transitions a region slot named `__proto__`
- **THEN** the committed state contains an own `__proto__` slot with the authored tagged value and its object prototype is unchanged

#### Scenario: Region slots overlap constructor properties

- **WHEN** parallel regions use the names `constructor` and `prototype`
- **THEN** both slots transition independently and are observable under their exact authored names
