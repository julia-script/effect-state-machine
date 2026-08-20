## Context

See `proposal.md` for motivation. The package will ship one engine-backed interpreter with one set of run options, execution metadata, child-machine behavior, and persistence semantics.

The persistence service must avoid transition-domain operations such as offering, claiming, renewing, fencing, and completing activities. Making adapters implement that queue protocol would be disproportionate for in-memory and browser-local stores and would couple machine semantics to persistence technology.

The definition tree is already inert and inspectable, state and events already cross Schema boundaries, transition planning is substantially separable from execution, and the durable format already groups checkpoint, messages, and activities for migration. Those are the seams this design deepens.

Effect Workflow remains unstable and exposes an execution engine rather than a general transactional checkpoint store. Its queue/message storage cannot atomically replace a machine checkpoint plus all derived timers, child changes, and activity outcomes. The integration therefore needs to reuse Workflow execution, not pretend Workflow storage implements the machine store.

## Goals / Non-Goals

**Goals:**

- Give every machine one execution and recovery model, selected through an explicit `MachineEngine` layer.
- Make the memory path the simplest way to run while keeping persistence capability visible in the Effect environment.
- Keep the storage primitive small enough for memory, browser-local, IndexedDB, SQL, and Redis implementations without moving machine semantics into adapters.
- Preserve atomic statechart transitions, stable activity identities, absolute timer deadlines, durable completion, and child-machine behavior.
- Make the common authoring path resemble other Effect model/engine pairs and remove per-run operational configuration.
- Offer a native Workflow-backed work declaration without making core depend on unstable Workflow APIs.

**Non-Goals:**

- Persist or resume the continuation, stack, or internal retry schedule of an arbitrary Effect.
- Guarantee exactly-once side effects in an external system that does not honor an idempotency key.
- Use Effect Workflow as the machine checkpoint store or require an entire machine to run as a Workflow.
- Provide automatic global discovery and activation of every stored instance in the first aggregate-store release. An application resumes an instance by running or opening its definition-derived identity; adapter-specific wakeups may optimize active instances.
- Decode or adapt documents from earlier pre-release repository formats. Application definition migrations remain a forward-looking contract after the clean format is introduced.
- Ship every production adapter in this change. The memory and browser-local implementations establish the contract; SQL, Redis, and IndexedDB can follow independently.

## Decisions

### 1. Separate the model, engine, store, and targeted integrations

The public modules will follow these ownership boundaries:

- `Machine` owns schemas, builders, immutable definitions, instance identity derivation, handles, and definition-level operations.
- `MachineEngine` is the Effect service that runs/opens instances and owns mailbox, transition, claim, timer, activity, child, migration, and recovery semantics.
- `MachineStore` is the minimal persistence service plus opaque aggregate types, Schemas, errors, memory layer, and store conformance helpers.
- `LocalStorageMachineStore` is a browser-only adapter module.
- `MachineWorkflow` is an optional integration module at the declared-work seam.

`MachineEngine.layer(config)` will build the engine from a `MachineStore`; `MachineEngine.layerMemory(config)` is the convenience layer that supplies one shared in-memory store. `MachineStore.layerMemory` remains available when callers want to compose or test the store separately. A new layer instance means a new volatile database.

This mirrors Effect's model/engine organization and keeps targeted dependencies out of concept modules. A separate durability namespace was rejected because it would retain a false distinction between ordinary and persistent machines. Putting adapters on `MachineEngine` was rejected because storage backends have their own dependencies and configuration.

### 2. Make persistence explicit, including memory

`Definition.run(input)` returns an Effect requiring `MachineEngine`; there is no ambient or hidden memory fallback. The simplest program is intentionally one explicit provision:

```ts
const handle = yield* Order.run({ orderId: "42" })

// At the application boundary
Effect.provide(program, MachineEngine.layerMemory())
```

This avoids a production application silently losing recovery because a service was omitted. The memory implementation still uses the same aggregate document, absolute deadlines, dispatch records, claims, execution identities, and child lifecycle as persistent stores. It differs only in the lifetime and sharing of the backing data.

An overload that runs without an engine was rejected: it would preserve two type-level execution modes and make work context optional again.

### 3. Derive instance identity from definition metadata and input

Definitions add a required `idempotencyKey(input)` function. The runtime combines its result with the stable definition ID through a versioned, total, collision-safe encoding to produce an opaque `MachineInstanceId`. The definition exposes the same derivation through `instanceId(input)` and uses it internally in `run(input)` and `open(input)`.

```ts
const Order = order.define(
  {
    id: "Order",
    idempotencyKey: ({ orderId }) => orderId,
    version: "2",
    migrations: orderMigrations,
    initial: ({ orderId }) => ({ _tag: "Pending", orderId }),
  },
  states,
)
```

The three identity domains remain deliberately distinct:

| Identity | Lifetime | Source |
| --- | --- | --- |
| Machine instance | Definition plus logical input | `definition.id` + `idempotencyKey(input)` |
| External dispatch | One caller operation | caller key, or a generated fresh key |
| Work execution | One active entry and invocation lane | instance + entry + owner + invocation/lane |

Deriving a dispatch key from event content was rejected because identical events may be legitimate repeated actions. A generated dispatch key is convenient but cannot be reconstructed after a caller loses the response; callers that need retry-safe reattachment must supply one.

### 4. Put persistence version and migrations on the definition

Persistence compatibility is an attribute of authored state, not of one execution attempt. `version` defaults to `"1"`; migrations are an ordered definition-owned map or chain. The run API no longer accepts `persistenceVersion` or migrations.

The aggregate has a separate engine `formatVersion`. A definition migration receives a validated migration document exposing encoded application state plus the runtime records that must remain coherent, and returns the next version. Every step is decoded and validated before compare-and-set replacement. Engine format changes use library-owned decoders and are not confused with application migrations.

Allowing run callers to supply a version was rejected because two processes could run the same definition under incompatible persistence declarations.

### 5. Persist one opaque, revisioned aggregate per root machine

The engine stores one aggregate document for a root instance. Its logical shape is:

```ts
interface MachineDocument {
  readonly formatVersion: number
  readonly revision: number
  readonly instanceId: MachineInstanceId
  readonly definition: { readonly id: string; readonly version: string }
  readonly input: PersistedValue
  readonly status: "running" | "completed" | "defected"
  readonly runtime: PersistedRuntimeTree
  readonly mailbox: ReadonlyArray<PersistedDelivery>
  readonly timers: ReadonlyArray<PersistedTimer>
  readonly activities: ReadonlyArray<PersistedActivity>
  readonly dispatches: ReadonlyArray<PersistedDispatchRecord>
  readonly executions: ReadonlyArray<PersistedExecutionRecord>
}
```

The exported document is Schema-validated and opaque to adapters: adapters store and compare it but do not interpret transition semantics. The runtime tree includes the root plus nested invoked children. All dynamic keyed collections use safe maps or canonical arrays at the boundary rather than prototype-bearing dictionaries.

The store service is intentionally narrow:

```ts
interface MachineStore {
  readonly now: Effect.Effect<number, MachineStoreError>
  readonly load: (
    instanceId: MachineInstanceId,
  ) => Effect.Effect<Option.Option<MachineDocument>, MachineStoreError>
  readonly compareAndSet: (
    request: CompareAndSetRequest,
  ) => Effect.Effect<CompareAndSetResult, MachineStoreError>
}
```

`CompareAndSetRequest` carries an absent-or-revision expectation, the complete next document, and an optional `notAfter` store-time precondition for a lease owner. The store atomically checks revision and deadline and returns a tagged committed, conflict, or expired result with its observed time. The deadline precondition is necessary: a separate `now` read followed by a write cannot prevent a former owner from committing just after its lease expires.

High-level `claim`, `renew`, `offer`, `completeActivity`, and migration operations are removed from the store. The engine performs each by loading, planning a replacement, and retrying compare-and-set. A queue-only store was rejected because checkpoint advancement and all derived deliveries must remain atomic. Multiple documents per instance were rejected for the first version because they would require multi-key transactions or an outbox protocol from every adapter.

### 6. Keep queue and fencing semantics in the aggregate engine

Every external event, timer, child notification, and activity outcome is a keyed mailbox delivery. Activity commands are keyed execution records. Claims contain owner, attempt, fence, and absolute expiry. Claim, renewal, release, outcome publication, transition commit, and terminal cleanup are pure document transformations guarded by compare-and-set.

Machine transitions remain single-threaded per root aggregate. Activities can run concurrently after separately committing their claims; their claim and result commits may contend on the aggregate but their external execution does not. A stale revision retries by reloading and determining whether the logical operation was already accepted, superseded, or remains eligible.

Engine configuration owns lease duration, renewal cadence, polling/backoff, activity concurrency, and compaction thresholds. Run calls own only logical input and user dispatch choices.

### 7. Resolve timers once and store absolute deadlines

On accepted entry, the engine reads store time, resolves the authored duration once, and writes its absolute deadline with the new entry identity in the same aggregate. If compare-and-set conflicts, planning is repeated against the new authoritative document; no timer from the rejected plan exists. Once the entry revision commits, retries and resumes use the stored deadline only.

Due eligibility is evaluated against store time. A resume before the deadline waits for the remainder; a resume after it makes the delivery immediately eligible. Stay updates preserve entry identity and deadline; self-target or later re-entry creates both anew.

Relative in-process sleeps as the source of truth were rejected because they reset after restart. Persisting only elapsed duration was rejected because it cannot establish whether a timer became due while no process was active.

### 8. Represent child machines inside the root aggregate

Each invoked child is a runtime-tree node keyed by its owner path and parent entry identity, with its own encoded input/state, entries, work, timers, and status. Parent-to-child forwarding creates an internal keyed delivery. Child completion updates child state and creates exactly one parent completion delivery in the same document replacement. Parent exit marks the child inactive and invalidates child-owned timers, activities, and pending outcomes atomically.

This preserves current child features and avoids cross-instance transactions, orphan cleanup, and parent/child ordering races. It also means one root aggregate is the unit of contention and storage size. Making each child a separate store instance was rejected for the first version because cancellation and completion would require atomic writes across instance IDs.

### 9. Require a work execution context everywhere

The work callback becomes `(state, execution) => Effect`. `execution` is never optional under memory or persistent engines. It contains the stable execution ID plus diagnostic instance, entry, owner, invocation, lane, and attempt fields. The ID is stable until an encoded terminal outcome commits; re-entry creates a new one.

The engine remains at-least-once across external-effect completion and outcome persistence. Applications can pass `execution.id` to an idempotent API, queue, or Workflow integration. Cause classification preserves interruption as redeliverable, treats only pure typed failure as an authored failure, and routes defects through machine defect semantics.

An optional execution-parameter type was rejected because it would recreate the original defensive branch. JavaScript/TypeScript still permits an author to supply a shorter function that ignores the second argument; the engine always calls work through the required-context contract, and any callback that references `execution` sees a non-optional value.

### 10. Integrate Workflow at the invoked-work seam

`MachineWorkflow.invoke` constructs ordinary inspectable work whose payload mapper is typed from a Workflow's input and whose success/failure reducers are inferred from its declared schemas. Internally it uses the public Workflow engine execute operation with an explicit execution ID derived from a versioned namespace of Workflow identity plus `execution.id`.

```ts
Charging: MachineWorkflow.invoke(order, {
  workflow: ChargeOrder,
  payload: ({ state }) => ({ orderId: state.orderId }),
  onSuccess: order.to("Paid", ({ state }) => state),
  onFailure: order.to("PaymentFailed", ({ state, error }) => ({
    ...state,
    reason: error,
  })),
})
```

On worker interruption, no machine outcome commits; redelivery addresses the same Workflow execution. On declared Workflow completion, its decoded outcome is persisted through the ordinary machine activity path. Workflow defects remain defects.

The module is isolated from core exports so applications without it do not load or require unstable Workflow services. Machine and Workflow layers may share a database client or deployment, but their records and protocols remain logically separate. A whole-machine Workflow wrapper was rejected because the public Workflow API does not provide the machine's externally addressable mailbox or arbitrary atomic aggregate replacement.

### 11. Use two complementary conformance suites

The store corpus tests only the persistence primitive: Schema boundary behavior, absent load, atomic create, successful replacement, stale-revision conflict, atomic deadline precondition, and time control. The engine corpus runs machine scenarios over a supplied store layer: dispatch deduplication, ordering, CAS contention, leases/fences, work replay, timer resume, migrations, terminal cleanup, regions, and child machines.

This separation keeps adapter obligations small while proving that the engine/store composition has the same semantics for memory and browser persistence. Existing durable tests will be classified into primitive-store, engine-semantic, and definition/type suites instead of being discarded.

### 12. Coordinate local storage explicitly

`LocalStorageMachineStore.layer` stores one canonical JSON document per instance under a configurable namespace. Compare-and-set runs under a per-instance Web Lock so the read, revision/deadline check, and write are serialized across same-origin tabs. If Web Locks are unavailable, the default layer fails with a typed unsupported-platform error; an explicitly named single-context layer/configuration may opt into same-page-only behavior. `storage` events may wake an active engine but are never the correctness mechanism.

Core modules do not reference `window`, `localStorage`, or Web Locks. The adapter accepts the platform capabilities or resolves them at layer construction. IndexedDB is the recommended future browser adapter for larger documents and higher write volume.

## Risks / Trade-offs

- **[Whole-document rewrites increase write amplification, quota pressure, and per-instance contention]** → Keep the document canonical and compact, add safe tombstone compaction, expose size/compaction configuration, test realistic large aggregates, and leave room for a future transactional multi-record store protocol without changing machine semantics.
- **[Activity claim and renewal commits can contend while activities execute concurrently]** → Keep external activity execution outside compare-and-set, retry logical claim operations idempotently, use bounded concurrency, and benchmark before adding a more complex store primitive.
- **[A load-by-ID store cannot discover every dormant instance after a process restart]** → Define resumption through `run/open` in this release, document that applications must reactivate known instances, and allow future adapter wakeup/index services as engine extensions rather than weakening the minimal store.
- **[Incorrect Layer placement can unexpectedly reset memory state]** → Document application-scope provisioning, test same-layer resume versus new-layer initialization, and avoid a hidden fallback.
- **[Browser local storage has small synchronous storage and platform coordination limits]** → Serialize writes under Web Locks, fail explicitly when safe coordination is unavailable, document single-context mode, and position IndexedDB as the larger-scale browser adapter.
- **[Stable execution IDs may be mistaken for exactly-once effects]** → Name and document the at-least-once boundary prominently, provide retry tests, and make Workflow/idempotent-provider examples use the ID explicitly.
- **[Moving child execution into the aggregate expands the first implementation]** → Port child semantics before removing the local interpreter, reuse one transition planner, and run the existing child suite plus restart/contention cases against memory and persistent stores.
- **[Effect Workflow APIs are unstable]** → Isolate the bridge in one optional subpath, pin its supported Effect version, test against the public engine API, and permit independent adaptation without changing core machine contracts.
- **[The clean API and format invalidate repository examples and fixtures]** → Update every repository consumer and fixture atomically; do not ship compatibility code or migration material for earlier pre-release states.

## Implementation Plan

1. Introduce the aggregate Schema, `MachineStore`, memory store, store corpus, and `MachineEngine` service.
2. Extract or adapt transition planning so the new engine can reproduce event, region, timer, work, completion, Cause, and safe-key semantics against aggregate documents.
3. Add nested child runtime persistence and pass the full existing child behavior suite plus restart, cancellation, forwarding, and completion-idempotency tests.
4. Add definition-owned identity/version/migrations, required work execution context, engine-backed definition operations, generated/caller dispatch keys, and compile-time tests.
5. Add the browser-local adapter and run both conformance suites with virtual/store time and page-reload simulations.
6. Add the optional Workflow integration and verify deterministic execution reuse across activity redelivery.
7. Migrate repository applications, examples, API docs, generated reference, and tests to the new modules and explicit layers.
8. Remove the alternative interpreter and compatibility surface, bump the aggregate format and package version, and verify the packed package contains exactly the documented public subpaths.

Because there are no external consumers, rollout is one clean pre-release cutover rather than a compatibility period. Rollback before release is a source revert; no source or documentation for earlier APIs or formats ships with the package.
