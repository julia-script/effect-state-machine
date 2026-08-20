## Why

Machine execution is currently process-local: losing the process loses the active state entry, queued outcomes, and timer progress, so applications cannot safely resume long-running behavior. The library needs durable orchestration primitives that preserve machine semantics across restarts without claiming that arbitrary invoked Effects are themselves durable or binding users to one database, workflow engine, or queue.

## What Changes

- Add an opt-in durable machine runner alongside `Machine.run`, identified by a stable machine-instance ID and backed by an Effect-native `DurableStore` service.
- Define a store-agnostic durable mailbox with idempotent message keys, delayed availability, leased delivery, optimistic revisions, and an atomic commit that acknowledges one delivery while saving the next checkpoint and publishing derived messages.
- Persist Schema-encoded machine state together with durable state-entry identities, definition and format versions, status, and the metadata needed to resume execution safely.
- Represent `after` timers as delayed durable messages with absolute deadlines so downtime neither resets nor discards an active timer; overdue timers become eligible immediately on resume.
- **BREAKING**: Require every invoked Effect and named `all` or `race` lane to declare success and allowed-failure Schemas whose decoded types match the Effect channels; remove the schema-less direct lane shorthand.
- Give invoked Effects stable execution keys and invocation metadata, including distinct keys for named `all` and `race` lanes, so authored Effects can delegate to Effect Workflow, durable task queues, or application idempotency records.
- Deliver invoked work through a concurrent durable activity queue, persist Schema-encoded activity outcomes, and feed those outcomes through the serialized machine mailbox with stable-key replay and effectively-once machine-state commits.
- Preserve existing entry ownership rules: stays retain entry and timer identity, explicit re-entry creates new identities and deadlines, and messages from exited entries cannot transition the machine.
- Provide an in-memory store adapter and a reusable adapter conformance suite while leaving database- and queue-specific adapters outside the core orchestration semantics.
- Support ordinary, invoked-work, region, and final nodes in the first durable runner; reject child-machine definitions explicitly until durable parent-child cancellation and cross-instance commit semantics are designed.
- Keep the scoped, in-memory `Machine.run` runtime semantics unchanged while applying the new Schema-backed invoked-work definition contract to both ordinary and durable runners.

## Capabilities

### New Capabilities

- `durable-machine-execution`: Defines durable machine instances, the store and mailbox contract, atomic checkpoint commits, idempotent dispatch, resumption, delayed timers, delivery ownership, and compatibility handling.

### Modified Capabilities

- `statechart-declared-work`: Extends invoked work with stable execution metadata and defines how work outcomes, lanes, entry ownership, and `after` timers behave under durable execution.
- `core-module-exports`: Adds the durable execution module as a stable public subpath without changing existing entrypoints.

## Impact

- Affects the core interpreter seam in `packages/core/src/Machine.ts`, with durable orchestration isolated in a new coherent module rather than added to every ordinary machine handle.
- Adds public durable checkpoint, machine-message, activity, delivery, store, execution-key, error, runner, and handle types plus a new package export.
- Requires Schema encoding and decoding for persisted state and events, deterministic clock-based tests, crash-window tests, adapter conformance tests, and package export verification.
- Store adapters must provide the documented atomicity, idempotency, leasing, and compare-and-set guarantees; adapters that combine separate databases and queues must hide their transactional-outbox implementation behind the store interface.
- Existing machine definitions with invoked work or direct function lanes must add success and allowed-failure Schemas. Invoked Effects remain ordinary Effects; durable external work, retries within an external workflow, and side-effect idempotency remain application or integration responsibilities, enabled by the stable keys supplied by the library.
- Durable child-machine execution and inspection-history continuity across worker restarts are deferred; ordinary in-memory child and tree-inspection behavior is unchanged.
