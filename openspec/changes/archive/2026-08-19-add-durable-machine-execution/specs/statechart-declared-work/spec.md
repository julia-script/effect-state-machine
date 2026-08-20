## ADDED Requirements

### Requirement: Durable work receives stable execution identity

An invoked-work function MAY accept read-only execution metadata in addition to its existing state input. Under durable execution, that metadata SHALL include a stable execution key, machine instance ID, durable entry identity, owner path, invocation name, optional lane name, and delivery attempt; restarting or redelivering work for the same active entry and lane MUST preserve its execution key, while explicit re-entry MUST produce a new key. A state-only work function SHALL remain valid.

#### Scenario: Durable activity is restarted before outcome persistence

- **WHEN** a process stops after activity delivery and the activity is delivered again for the same active entry
- **THEN** the authored Effect receives the same execution key and a later delivery-attempt value

#### Scenario: Invoked state is re-entered

- **WHEN** the machine exits and later re-enters the same invoked node
- **THEN** the new invocation receives a different durable entry identity and execution key

#### Scenario: Existing Effect ignores metadata

- **WHEN** a Schema-backed work declaration supplies an Effect function that accepts only its state input
- **THEN** the definition remains valid for ordinary and durable execution

### Requirement: Durable work execution is at least once until encoded outcome commit

An authored activity Effect MAY run more than once after lease loss or process failure until its Schema-encoded terminal outcome is durably committed. Every run for one entry and lane SHALL receive the same execution key. After the encoded outcome commit succeeds, the Effect MUST NOT run again for that execution key; duplicate outcome delivery and stale entry checks SHALL prevent more than one machine transition. The library SHALL NOT claim to persist or resume the internal continuation of an arbitrary Effect.

#### Scenario: External work completes before worker loss

- **WHEN** external work succeeds but the worker stops before its encoded outcome is durably committed
- **THEN** the activity can be redelivered with the same execution key so an idempotent external system can return the existing result

#### Scenario: Process stops during operational retry

- **WHEN** a process stops while an activity's ordinary Effect Schedule is retrying or sleeping
- **THEN** the activity can be redelivered with the same execution key, while the in-process Schedule is allowed to restart because its internal continuation is not persisted

#### Scenario: Committed activity outcome is replayed

- **WHEN** the process stops after an activity outcome commit but before its machine transition commits
- **THEN** resume replays the encoded outcome message without executing the Effect again

## MODIFIED Requirements

### Requirement: Work declarations are named, typed, and inspectable

An invoked-work node SHALL declare a stable name, a work kind, success Schema, allowed-failure Schema, its Effect-producing function or named lane record, and success and failure transitions. The Schemas' decoded types SHALL match the Effect's success and complete typed-failure channels, including any retry-schedule terminal error. Definitions SHALL retain descriptions, lane names, concurrency settings, retry metadata, outcome Schemas, targets, and inferred Effect requirements without executing the work.

#### Scenario: Graph tooling inspects work

- **WHEN** tooling traverses an invoked-work definition
- **THEN** it can render the work kind, name, lanes, outcome Schema metadata, retry policy name, and outcome targets without running an Effect

#### Scenario: Requirements are inferred

- **WHEN** work, its outcome Schemas, or its retry schedule require Effect services
- **THEN** those requirements are included exactly in the machine's transitive requirements type

#### Scenario: Allowed failure Schema is incomplete

- **WHEN** a work Effect or retry Schedule has a typed failure not covered by the declaration's allowed-failure Schema
- **THEN** the definition is rejected by TypeScript rather than leaving an unencodable failure channel

### Requirement: Single Effect work has exact outcome channels

On node entry, a single-work declaration SHALL start one Effect from the entered state snapshot. Its success reducer SHALL receive the exact decoded type of the declared success Schema and its failure reducer SHALL receive the exact decoded type of the declared allowed-failure Schema. The Effect's output and typed failure SHALL be validated against those Schemas, and completion of either channel SHALL select its declared transition at most once while that entry remains active.

#### Scenario: Work succeeds

- **WHEN** the active Effect succeeds with a value accepted by its success Schema
- **THEN** the success reducer receives that value and its transition is committed

#### Scenario: Work fails

- **WHEN** the active Effect exhausts any retry policy and fails with an error accepted by its allowed-failure Schema
- **THEN** the failure reducer receives that error and its transition is committed

#### Scenario: Work produces an undeclared typed outcome

- **WHEN** the runtime value in either typed outcome channel cannot be encoded by its declared Schema
- **THEN** the machine terminates with a definition defect rather than selecting an outcome transition

#### Scenario: Work defects

- **WHEN** the Effect terminates with a defect rather than a typed failure
- **THEN** the machine terminates according to its defect semantics rather than selecting the typed failure transition

### Requirement: Retry is explicit state-owned behavior

A retry policy SHALL have an inspectable stable name and a Schedule compatible with the work's typed failure. Retries SHALL remain owned by the current node entry, and schedule requirements and schedule terminal errors SHALL be reflected in the machine requirements and covered by the declaration's allowed-failure Schema.

#### Scenario: Retry eventually succeeds

- **WHEN** work fails, the schedule permits another attempt, and a later attempt succeeds
- **THEN** only the success transition is selected

#### Scenario: Node exits during backoff

- **WHEN** the owning node exits while retry delay is pending
- **THEN** the retry schedule and future attempts are interrupted

### Requirement: All work joins named lanes

An `all` declaration SHALL start its named task lanes with the declared concurrency limit and succeed only after every lane succeeds. Each lane SHALL declare success and allowed-failure Schemas matching its Effect channels. The aggregate success value SHALL be a read-only record keyed by every lane name with that lane Schema's exact decoded success type. If any lane fails, the remaining active lanes SHALL be interrupted and the failure transition SHALL receive the union of the lanes' decoded allowed-failure types.

#### Scenario: All lanes succeed

- **WHEN** every lane succeeds with a value accepted by its success Schema
- **THEN** the success reducer receives one keyed result containing every lane output under its authored name

#### Scenario: One lane fails

- **WHEN** a lane fails with an error accepted by its allowed-failure Schema before all lanes succeed
- **THEN** unfinished lanes are interrupted and the failure reducer receives that lane's typed error

#### Scenario: Concurrency is bounded

- **WHEN** an `all` declaration sets a numeric concurrency limit
- **THEN** no more than that number of lane Effects run simultaneously

### Requirement: Race work preserves winner correlation

A `race` declaration SHALL run its named Schema-backed task lanes concurrently and select the first successful lane. The success reducer SHALL receive a correlated union of `{ winner, value }` such that narrowing the winner name narrows the value to that lane's decoded success type. Losing and unfinished lanes SHALL be interrupted. Failed lanes SHALL remain out of contention while another lane can still succeed; if all lanes fail, the failure transition SHALL receive the union of decoded allowed-failure types, with the value from the last lane to establish that no success remains possible.

#### Scenario: One lane wins

- **WHEN** a lane succeeds with a value accepted by its success Schema while other lanes are still running or have failed
- **THEN** its name and value are passed together to the success reducer and unfinished lanes are interrupted

#### Scenario: Winner is narrowed

- **WHEN** reducer code narrows the `winner` discriminant
- **THEN** TypeScript narrows `value` to that lane's decoded success type

#### Scenario: Every lane fails

- **WHEN** all race lanes fail with errors accepted by their allowed-failure Schemas
- **THEN** the failure transition runs once with the final observed lane failure

### Requirement: Named task records use keys as lane identity

Within `all` and `race`, every task SHALL use an object form that declares its Effect-producing function, success Schema, allowed-failure Schema, and optional description. The enclosing record key SHALL be the stable lane name and persistence identity. The previous direct Effect-producing function shorthand SHALL NOT be accepted.

#### Scenario: Schema-backed task object is used

- **WHEN** a lane is authored with its Effect, success Schema, and allowed-failure Schema
- **THEN** its record key names the lane and its output, failure, Schema, and requirement types are inferred exactly

#### Scenario: Direct task function is rejected

- **WHEN** a lane is authored directly as an Effect-producing function without outcome Schemas
- **THEN** the definition is rejected by TypeScript

#### Scenario: Task metadata is used

- **WHEN** a lane needs a description
- **THEN** the object form retains that metadata without changing the lane's inferred Effect channels

### Requirement: After transitions are entry-scoped timers

An `after` declaration SHALL expose an inspectable duration and destination transition. Its timer SHALL start when its owning node entry becomes active, fire at most once while that entry remains active, restart after explicit re-entry, survive a stay update, and be interrupted when the owner exits. Under durable execution, the resolved duration and absolute deadline SHALL be persisted when the entry is committed, and resumption MUST reuse that deadline rather than recomputing or restarting it.

#### Scenario: Timer reaches its duration

- **WHEN** the owning entry remains active for the declared duration
- **THEN** the timer transition is selected once using the current active state as reducer input

#### Scenario: Self-target restarts timer

- **WHEN** an event explicitly self-targets before the duration elapses
- **THEN** the previous timer is interrupted and a full new duration begins on re-entry

#### Scenario: Stay preserves timer

- **WHEN** a stay update occurs before the duration elapses
- **THEN** the existing timer continues from its original entry time

#### Scenario: Durable timer resumes before its deadline

- **WHEN** a process stops partway through an active timer and resumes before its absolute deadline
- **THEN** only the time remaining until the original deadline remains

#### Scenario: Durable timer resumes after its deadline

- **WHEN** a process resumes after an active timer's absolute deadline passed
- **THEN** the timer becomes eligible immediately and its transition is not skipped

#### Scenario: Dynamic duration state changes during stay

- **WHEN** a dynamic duration was resolved on entry and a stay update changes fields that its duration function would read
- **THEN** durable resume retains the originally resolved duration and deadline without evaluating that function again

### Requirement: Stale work and timer outcomes cannot transition

Work and timers SHALL be scoped to a unique node entry. Under durable execution that identity SHALL survive process restart. After the entry exits or is replaced, any late success, failure, retry wake-up, timer wake-up, activity command, or duplicate outcome from it MUST NOT commit a transition or update state.

#### Scenario: Event exits before work completes

- **WHEN** an event transition exits an invoked-work state and the interrupted Effect later produces an outcome
- **THEN** that outcome is ignored and the event transition remains the only committed transition

#### Scenario: Parent exits a region work owner

- **WHEN** a parent transition exits a state whose active region owns work
- **THEN** late outcomes from that region entry cannot affect the machine

#### Scenario: Old durable delivery arrives after re-entry

- **WHEN** a delayed message from a previous entry is delivered after the same authored node has been re-entered with a new entry identity
- **THEN** the old message is rejected as stale even though its state tag and owner path match the active node
