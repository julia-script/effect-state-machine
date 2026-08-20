# machine-tree-inspection Specification

## Purpose

Defines how one running root machine exposes the identities, ownership relationships, facts, states, and addressable lifecycles of every descendant machine as a single inspectable execution tree.

## Requirements

### Requirement: Running machines form an identified actor tree
Every machine instance in a root execution SHALL have an actor identifier that is unique and never reused within that execution. The root actor SHALL be identified as the tree root, and every child actor SHALL identify its parent actor, invocation site, machine definition, and runtime instance.

#### Scenario: Child machine starts
- **WHEN** a parent starts a child machine
- **THEN** the tree reports a new actor with a unique actor identifier and its parent actor, invocation, definition, and instance relationships

#### Scenario: Child invocation is entered again
- **WHEN** a parent later starts another child at an invocation site that was previously active
- **THEN** the new child receives a different actor identifier and the previous identifier is not reused

### Requirement: Tree inspection is globally ordered and replayable
The root machine handle SHALL expose one inspection journal containing facts from the root and every descendant actor. Every record SHALL carry its actor identifier and a strictly increasing tree-wide sequence, and a later observer SHALL be able to consume retained records from the beginning of the root execution.

#### Scenario: Parent and child facts interleave
- **WHEN** a parent forwards an event, the child transitions, and the child completes
- **THEN** those records appear once in their causal tree-wide order with the producing actor identified on each record

#### Scenario: Inspection starts after a child
- **WHEN** an observer subscribes after a child actor has started and transitioned
- **THEN** the retained journal includes the actor start and earlier child facts before newly produced records

### Requirement: Actor lifecycle bounds actor facts
The journal SHALL report when each actor starts and terminates, including whether termination was completion, cancellation, or defect. An actor's start record SHALL precede its machine facts, its terminal record SHALL follow its final fact, and no further facts SHALL be recorded for that actor after termination.

#### Scenario: Parent leaves a child state
- **WHEN** a live child is cancelled because its parent transitions away from the owning state
- **THEN** the journal records the child's cancellation after its preceding facts and records no later facts for that actor

### Requirement: Live actors are addressable through the root handle
The root machine handle SHALL route an event to a specified live actor using that actor's own event type and normal acceptance semantics. Delivery to an unknown or terminated actor SHALL fail without delivering the event to any machine.

#### Scenario: Event targets a child actor
- **WHEN** an event accepted by a live child is dispatched to that child's actor identifier
- **THEN** the child receives the event and the root and sibling actors do not

#### Scenario: Event targets a terminated actor
- **WHEN** dispatch targets an actor that has completed, cancelled, or defected
- **THEN** delivery fails as not running and no actor receives the event

### Requirement: Tree inspection does not alter execution ownership
Creating, consuming, or releasing a tree inspection view SHALL NOT start, stop, retain, or otherwise change the execution semantics of the root or descendant machines.

#### Scenario: Observer is released
- **WHEN** the scope consuming tree inspection is released while the machine tree is running
- **THEN** all machine actors continue according to their existing ownership and lifecycle rules

### Requirement: Definition paths are total for authored names

Definition-path construction SHALL deterministically encode every state tag and invocation name accepted by a machine definition without synchronously throwing for malformed UTF-16. The resulting path SHALL preserve parent/child ownership and remain unambiguous for well-formed authored names.

#### Scenario: Child invocation contains an unpaired surrogate

- **WHEN** a child definition path is constructed from a state tag or invocation name containing an unpaired surrogate
- **THEN** tree execution and inspection receive a deterministic child path without a URI encoding defect
