# statechart-definition-authoring Specification

## Purpose

Defines a schema-first, statically inspectable authoring contract for exhaustive statechart definitions with shallow syntax and precise TypeScript inference.

## Requirements

### Requirement: Definitions are schema-first and exhaustive

A machine definition SHALL be built from input, state, and event schemas whose state and event values are tagged unions. Its authored state record SHALL contain exactly one node for every state tag, and each keyed node SHALL be contextually typed as that state variant.

#### Scenario: Every state is declared

- **WHEN** an author supplies one keyed node for every state variant
- **THEN** the definition type-checks without repeating a state tag inside any node

#### Scenario: A state is missing

- **WHEN** an authored state record omits a state tag from the state schema
- **THEN** TypeScript rejects the definition and identifies the missing key

#### Scenario: A state key is unknown

- **WHEN** an authored state record includes a key that is not a state tag
- **THEN** TypeScript rejects the unknown node

### Requirement: Node constructors expose a shallow value grammar

The authoring surface SHALL provide distinct constructors for an event-handling state, an invoked-work state, a region-bearing state, and a final state. The machine definition SHALL keep metadata separate from the exhaustive state record, and node constructors SHALL remove representational `on`, `regions`, and nested `states` wrappers from the common authored path while returning immutable definition values.

#### Scenario: Event-handling state is authored

- **WHEN** an author passes an event-handler record to the state constructor
- **THEN** event names are direct keys of that record and the resulting definition retains them as inspectable handlers

#### Scenario: Final state is authored

- **WHEN** an author constructs a final node
- **THEN** TypeScript rejects handlers, timers, work, or regions on that same node

#### Scenario: Node kinds conflict

- **WHEN** an author attempts to combine incompatible node kinds in one state
- **THEN** TypeScript rejects the definition rather than resolving the conflict by declaration order

### Requirement: Transition context and destination are exactly inferred

For an event handler, the reducer input SHALL narrow `state` to the enclosing state variant and `event` to the handler's event variant. A transition target SHALL be restricted to a valid state tag, and its reducer result SHALL contain exactly the destination variant's fields except `_tag`.

#### Scenario: Reducer uses narrowed inputs

- **WHEN** a reducer is declared under state `Typing` and event `Edit`
- **THEN** its state and event inputs expose only the fields of the `Typing` and `Edit` variants

#### Scenario: Reducer returns destination fields

- **WHEN** a transition targets a state with required destination fields
- **THEN** TypeScript requires those fields and rejects fields belonging only to another state variant

#### Scenario: Transition target is invalid

- **WHEN** a transition names a tag absent from the state schema
- **THEN** TypeScript rejects the target

### Requirement: The runtime owns the destination tag

Reducers SHALL NOT be required to return `_tag`. When committing a transition, the runtime MUST construct the next value from the declared target tag and the reducer's returned fields; a reducer-returned `_tag`, if present because of a TypeScript return-position limitation, MUST NOT override the declared target.

#### Scenario: Normal auto-tagged transition

- **WHEN** a reducer returns valid destination fields without `_tag`
- **THEN** the committed state contains the declared target as `_tag`

#### Scenario: Reducer leaks a conflicting tag

- **WHEN** a reducer value contains an `_tag` different from its declared target
- **THEN** the runtime commits the declared target and does not transition to the leaked tag

### Requirement: Event responses are explicit

An event handler SHALL declare exactly one response shape: an unconditional target transition, an ordered guarded branch set, an ignored response, or a stay update. Guarded branches SHALL be evaluated in authored order, named guards SHALL be statically inspectable, and an optional `otherwise` branch SHALL run only when no preceding guard matches.

#### Scenario: First guard matches

- **WHEN** more than one guard could accept an event
- **THEN** only the first matching authored branch is selected

#### Scenario: No guard matches

- **WHEN** no guard accepts an event and an `otherwise` branch exists
- **THEN** the `otherwise` transition is selected

#### Scenario: Event is ignored

- **WHEN** the selected handler declares an ignored response
- **THEN** the event is accepted without changing state or re-entering the node

### Requirement: Stay and self-target have distinct lifecycle semantics

A stay update SHALL update fields of the current variant without exiting or re-entering its node. An explicit transition targeting the current state tag SHALL exit and re-enter that node even when its resulting state value is otherwise equal.

#### Scenario: Stay updates fields

- **WHEN** a stay reducer handles an event
- **THEN** its result updates the current state's fields while state-owned timers and work continue

#### Scenario: Self-target handles an event

- **WHEN** a transition explicitly targets its enclosing state tag
- **THEN** the node is exited and entered again, restarting state-owned timers and work

### Requirement: Definition construction is inert and inspectable

Constructing a definition SHALL synchronously normalize shorthand into one canonical immutable definition tree. Construction and inspection SHALL NOT execute Effects, evaluate guards or reducers, require services, start timers, or start machine execution. State tags, event tags, targets, node kinds, work kinds and names, lane names, retry names, durations, descriptions, schemas, and available source locations SHALL be discoverable from the definition.

#### Scenario: Definition is inspected without dependencies

- **WHEN** graph tooling traverses a definition before a machine is run
- **THEN** it can enumerate declared behavior without providing Effect requirements or executing application functions

#### Scenario: Shorthand is normalized

- **WHEN** a shallow region or state declaration is constructed
- **THEN** downstream interpreter and graph consumers receive the canonical definition shape rather than needing syntax-specific branches

### Requirement: Public machine types remain exact

The definition SHALL preserve enough type information to derive its input, full state union, event union, final-state completion union, and transitive Effect requirements without widening them.

#### Scenario: Completion is inferred

- **WHEN** a definition has multiple final top-level states
- **THEN** its completion type is exactly the union of those final state variants

#### Scenario: Requirements are inferred

- **WHEN** work declarations require multiple Effect services
- **THEN** the machine's requirements type is exactly their union, including retry and region-work requirements
