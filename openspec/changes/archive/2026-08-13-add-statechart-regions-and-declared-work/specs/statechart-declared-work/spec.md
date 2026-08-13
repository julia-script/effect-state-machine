## Purpose

Defines statically inspectable, state-owned Effect work and timer declarations with precise outcomes, requirements, concurrency, retry, and interruption semantics.

## ADDED Requirements

### Requirement: Work declarations are named, typed, and inspectable

An invoked-work node SHALL declare a stable name, a work kind, its Effect-producing function or named lane record, and success and failure transitions. Definitions SHALL retain descriptions, lane names, concurrency settings, retry metadata, targets, and inferred Effect requirements without executing the work.

#### Scenario: Graph tooling inspects work

- **WHEN** tooling traverses an invoked-work definition
- **THEN** it can render the work kind, name, lanes, retry policy name, and outcome targets without running an Effect

#### Scenario: Requirements are inferred

- **WHEN** work and its retry schedule require Effect services
- **THEN** those requirements are included exactly in the machine's transitive requirements type

### Requirement: Single Effect work has exact outcome channels

On node entry, a single-work declaration SHALL start one Effect from the entered state snapshot. Its success reducer SHALL receive the exact Effect output and its failure reducer SHALL receive the exact typed failure, extended by any retry-schedule failure. Completion of either channel SHALL select its declared transition at most once while that entry remains active.

#### Scenario: Work succeeds

- **WHEN** the active Effect succeeds with a value
- **THEN** the success reducer receives that value and its transition is committed

#### Scenario: Work fails

- **WHEN** the active Effect exhausts any retry policy and fails in its typed error channel
- **THEN** the failure reducer receives that error and its transition is committed

#### Scenario: Work defects

- **WHEN** the Effect terminates with a defect rather than a typed failure
- **THEN** the machine terminates according to its defect semantics rather than selecting the typed failure transition

### Requirement: Retry is explicit state-owned behavior

A retry policy SHALL have an inspectable stable name and a Schedule compatible with the work's typed failure. Retries SHALL remain owned by the current node entry, and schedule requirements and schedule terminal errors SHALL be reflected in the machine requirements and failure transition types.

#### Scenario: Retry eventually succeeds

- **WHEN** work fails, the schedule permits another attempt, and a later attempt succeeds
- **THEN** only the success transition is selected

#### Scenario: Node exits during backoff

- **WHEN** the owning node exits while retry delay is pending
- **THEN** the retry schedule and future attempts are interrupted

### Requirement: All work joins named lanes

An `all` declaration SHALL start its named task lanes with the declared concurrency limit and succeed only after every lane succeeds. Its success value SHALL be a read-only record keyed by every lane name with that lane's exact output type. If any lane fails, the remaining active lanes SHALL be interrupted and the failure transition SHALL receive that lane's typed failure.

#### Scenario: All lanes succeed

- **WHEN** every lane succeeds
- **THEN** the success reducer receives one keyed result containing every lane output under its authored name

#### Scenario: One lane fails

- **WHEN** a lane fails before all lanes succeed
- **THEN** unfinished lanes are interrupted and the failure reducer receives the failing lane's typed error

#### Scenario: Concurrency is bounded

- **WHEN** an `all` declaration sets a numeric concurrency limit
- **THEN** no more than that number of lane Effects run simultaneously

### Requirement: Race work preserves winner correlation

A `race` declaration SHALL run its named task lanes concurrently and select the first successful lane. The success reducer SHALL receive a correlated union of `{ winner, value }` such that narrowing the winner name narrows the value to that lane's exact output type. Losing and unfinished lanes SHALL be interrupted. Failed lanes SHALL remain out of contention while another lane can still succeed; if all lanes fail, the failure transition SHALL receive the typed failure from the last lane to establish that no success remains possible.

#### Scenario: One lane wins

- **WHEN** a lane succeeds while other lanes are still running or have failed
- **THEN** its name and value are passed together to the success reducer and unfinished lanes are interrupted

#### Scenario: Winner is narrowed

- **WHEN** reducer code narrows the `winner` discriminant
- **THEN** TypeScript narrows `value` to that lane's output type

#### Scenario: Every lane fails

- **WHEN** all race lanes fail in the typed error channel
- **THEN** the failure transition runs once with the final observed lane failure

### Requirement: Named task records use keys as lane identity

Within `all` and `race`, a task MAY be authored directly as an Effect-producing function when it needs no metadata, or as an object with an Effect-producing function and description. In both forms, the enclosing record key SHALL be the stable lane name.

#### Scenario: Direct task function is used

- **WHEN** a lane is authored as a function
- **THEN** its record key names the lane and its output, failure, and requirements are inferred from the returned Effect

#### Scenario: Task metadata is used

- **WHEN** a lane needs a description
- **THEN** the object form retains that metadata without changing the lane's inferred Effect channels

### Requirement: After transitions are entry-scoped timers

An `after` declaration SHALL expose an inspectable duration and destination transition. Its timer SHALL start when its owning node entry becomes active, fire at most once while that entry remains active, restart after explicit re-entry, survive a stay update, and be interrupted when the owner exits.

#### Scenario: Timer reaches its duration

- **WHEN** the owning entry remains active for the declared duration
- **THEN** the timer transition is selected once using the current active state as reducer input

#### Scenario: Self-target restarts timer

- **WHEN** an event explicitly self-targets before the duration elapses
- **THEN** the previous timer is interrupted and a full new duration begins on re-entry

#### Scenario: Stay preserves timer

- **WHEN** a stay update occurs before the duration elapses
- **THEN** the existing timer continues from its original entry time

### Requirement: Stale work and timer outcomes cannot transition

Work and timers SHALL be scoped to a unique node entry. After that entry exits or is replaced, any late success, failure, retry wake-up, or timer wake-up from it MUST NOT commit a transition or update state.

#### Scenario: Event exits before work completes

- **WHEN** an event transition exits an invoked-work state and the interrupted Effect later produces an outcome
- **THEN** that outcome is ignored and the event transition remains the only committed transition

#### Scenario: Parent exits a region work owner

- **WHEN** a parent transition exits a state whose active region owns work
- **THEN** late outcomes from that region entry cannot affect the machine

### Requirement: Region work receives local and parent snapshots

Work owned by a region child SHALL receive the active region variant and a read-only snapshot of the narrowed parent state from that entry. Its outcome transitions SHALL target only tags from the same region slot and SHALL contribute output, failure, retry, and requirement types to the containing machine exactly as top-level work does.

#### Scenario: Region work succeeds

- **WHEN** region work succeeds using data from its parent snapshot
- **THEN** its success reducer updates only that region slot through a valid local target

#### Scenario: Region work requires a service

- **WHEN** a region Effect requires a service absent from all top-level work
- **THEN** that service still appears in the machine's requirements type
