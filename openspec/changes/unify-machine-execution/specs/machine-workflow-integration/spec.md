## Purpose

Defines an optional bridge that executes declared machine work through Effect Workflow while preserving machine-owned state, mailbox, timer, and transition semantics.

## ADDED Requirements

### Requirement: Workflow work derives deterministic execution identity

The integration SHALL derive one Workflow execution ID from the Workflow identity and the machine work execution ID. Redelivery of the same active entry and lane SHALL address the same Workflow execution, while a different machine entry, lane, machine instance, or Workflow SHALL address a different execution.

#### Scenario: Machine work is redelivered

- **WHEN** the same active-entry work command is delivered more than once
- **THEN** every attempt executes or observes the same Workflow execution ID

#### Scenario: Machine state is re-entered

- **WHEN** the machine exits and re-enters the Workflow-backed work state
- **THEN** the new machine work execution maps to a different Workflow execution ID

### Requirement: Workflow declarations infer outcomes and requirements

A Workflow-backed work declaration SHALL use the Workflow's input, success, and allowed-error contracts to type its payload mapping and machine outcome reducers. Its Effect requirements SHALL include the public Workflow engine service and any requirements of payload mapping or reducers without requiring callers to manually copy Workflow Schemas into the machine declaration.

#### Scenario: Workflow succeeds

- **WHEN** the addressed Workflow execution completes with its declared success value
- **THEN** the machine success reducer receives that exact decoded type

#### Scenario: Workflow fails with an allowed error

- **WHEN** the addressed Workflow execution completes with one of its declared allowed errors
- **THEN** the machine failure reducer receives the inferred allowed-error union

#### Scenario: Payload mapper returns wrong input

- **WHEN** an author maps machine state to a value outside the Workflow input type
- **THEN** TypeScript rejects the declaration

### Requirement: Workflow integration preserves the machine store boundary

The integration SHALL use the public Workflow engine to execute or observe Workflow-backed work and SHALL keep the machine aggregate in the supplied machine store. It MUST NOT present Workflow queue or message storage as a machine store unless that implementation independently satisfies the complete machine-store and engine contracts.

#### Scenario: Machine and Workflow share infrastructure

- **WHEN** an application provides machine-store and Workflow-engine layers backed by the same database client or deployment
- **THEN** each service retains its own persistence protocol while the integration coordinates them through the stable machine work execution ID

#### Scenario: Only a Workflow engine is provided

- **WHEN** an application provides a Workflow engine but no machine engine
- **THEN** running the machine still reports the missing machine-engine requirement

### Requirement: Workflow interruption does not become an authored failure

Interruption of a worker awaiting a Workflow execution SHALL leave the machine work outcome uncommitted so it can be redelivered against the same Workflow execution ID. Only a declared Workflow success or allowed error SHALL select an authored machine outcome transition; defects SHALL follow machine defect semantics.

#### Scenario: Machine worker stops while Workflow continues

- **WHEN** a machine activity worker is interrupted before recording the Workflow outcome
- **THEN** no authored failure transition is selected and redelivery observes the same Workflow execution

#### Scenario: Workflow defects

- **WHEN** the Workflow terminates with a defect rather than an allowed error
- **THEN** the machine records defect semantics rather than reducing it as an authored failure

### Requirement: Core execution remains Workflow-independent

Importing or running machines without the optional integration SHALL NOT load unstable Workflow modules or require a Workflow engine. The integration SHALL NOT require the entire machine to execute as a Workflow and SHALL preserve external event dispatch through the machine handle.

#### Scenario: Ordinary machine uses persistent storage

- **WHEN** a machine uses a persistent machine engine and no Workflow-backed work
- **THEN** it runs and resumes without providing any Workflow service

#### Scenario: Workflow-backed machine receives an external event

- **WHEN** a machine with Workflow-backed work also accepts a caller event
- **THEN** the event is dispatched through the machine mailbox rather than through a Workflow-only runner API
