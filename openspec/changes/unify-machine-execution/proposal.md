## Why

The library needs one durable-compatible execution model so ordinary use is as simple as choosing an in-memory layer while persistence, timers, work identity, child machines, and production adapters retain the same semantics.

## What Changes

- Make definition-level execution backed by a `MachineEngine` Effect service the only execution model.
- Make each definition derive its stable instance identity from its definition ID, input, and authored `idempotencyKey`; expose definition-level `run` and instance-addressing operations instead of requiring an `instanceId` at every call.
- Move persistence version and migrations onto the machine definition, with a default initial version, and move leases, polling, and worker policy into engine-layer configuration.
- Make invoked work always receive a required execution context with a stable idempotency identity; arbitrary external effects remain at-least-once unless the application or an integration makes them idempotent.
- Replace the large semantic durable-store interface with a minimal aggregate-document store contract using store-authoritative time and compare-and-set revisions. The engine owns mailboxes, deadlines, claims, fencing, retries, and atomic transition planning inside each machine aggregate.
- Provide `MachineEngine.layerMemory` as the explicit zero-dependency volatile runtime and publish adapter seams plus bundled memory and browser-local persistence implementations. Persistent adapters preserve deadlines across process or page restarts; memory preserves the same semantics only for the lifetime of the supplied layer.
- Allow ordinary sends to generate a dispatch identity while accepting a caller-supplied idempotency key for retry-safe dispatch.
- Persist child-machine lifecycle, state, timers, work, forwarding, cancellation, and completion within the owning aggregate so removing the process-local runner does not remove child-machine support.
- Add an optional Effect Workflow integration at the invoked-work seam. It derives a deterministic Workflow execution ID from the machine work execution identity and uses the public Workflow engine, while keeping the core package independent of unstable Workflow APIs and retaining a logically separate machine store.
- Expose only the Effect-shaped `Machine`, `MachineEngine`, `MachineStore`, adapter, and optional Workflow-integration modules.

## Capabilities

### New Capabilities

- `machine-workflow-integration`: Optional integration that executes declared machine work through Effect Workflow with deterministic execution identity and inferred Workflow outcome schemas.

### Modified Capabilities

- `durable-machine-execution`: Use one aggregate-document engine/store model with explicit memory execution, resumable timers, durable child machines, and generated or caller-supplied dispatch identities.
- `statechart-definition-authoring`: Add definition-owned instance identity, persistence version, migrations, and definition-level execution/addressing operations.
- `statechart-declared-work`: Require stable execution context for all work and align work, retry, interruption, and replay semantics with the unified engine.
- `core-module-exports`: Publish the engine, store, adapter, and optional integration entry points as the complete execution surface.

## Impact

- Affects the public authoring and execution API, package exports, machine interpreter, persistence model, store conformance tests, child-machine runtime, work metadata, timers, examples, and API documentation.
- Requires a new aggregate document schema and format version, engine-level compare-and-set retry logic, and conformance suites for both the minimal store primitive and engine semantics.
- Adds browser-specific adapter entry points without importing browser globals from core, and an optional package or unstable subpath for Effect Workflow integration.
- Repository consumers provide a `MachineEngine` layer and use definition-level execution. The clean pre-release format ships without compatibility code or migration material for earlier repository states; application-authored state migrations remain a forward-looking capability.
