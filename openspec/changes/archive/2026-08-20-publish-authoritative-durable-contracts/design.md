## Context

See `proposal.md` and the modified Store-adapter requirement. `packages/core/tests/DurableStoreConformance.ts` registers nine detailed Vitest cases, while `packages/core/src/DurableConformance.ts` exports four larger framework-neutral cases. The memory adapter runs both. `Durable.run` also restores a detailed public Effect signature after internal runtime erasure, but permanent type-contract tests cover only `Machine.run`.

## Goals / Non-Goals

**Goals:**

- Give adapter authors exactly the contract used to certify the bundled adapter.
- Keep conformance cases independent of a specific test framework.
- Pin all public type channels that cross the durable runner's erasure seam.

**Non-Goals:**

- Ship a production database or queue adapter.
- Test adapter-specific performance or transaction mechanisms.
- Remove the internal runtime erasure in this change.

## Decisions

### Export granular framework-neutral cases

`storeConformance(makeStore)` will return a read-only array of small named cases whose `run` values are Effects. Assertions use Effect's assertion-compatible callback contract or return structured observations consumed by a thin test wrapper; the public module will not import Vitest.

The nine private behaviors become the minimum starting set, then gaps are added for renew/release, terminal claim eligibility, duplicate observer completion, both commit forms, and migration fencing. The private implementation is deleted after parity is demonstrated.

Alternative considered: export a function that calls `describe`/`it.effect`. Rejected because it binds adapter authors to the package's test framework and makes composition harder.

### Test the reference adapter only through the public corpus

`DurableStore.test.ts` will register each exported case once against `makeMemoryStore`. Adapter-specific unit tests are allowed only for behavior outside the Store contract. A manifest-style assertion will compare documented contract topics to case names so adding a Store method or guarantee requires an intentional conformance update.

Alternative considered: retain both suites for defense in depth. Rejected because duplicate implementations are the drift source and currently disagree in granularity.

### Add exact durable type assertions

A permanent `Durable.types.ts` will use equality helpers and negative `@ts-expect-error` cases to assert:

- exact `Handle<State, Event, Completion>` inference;
- the `DurableError` channel;
- `Scope | Store | MachineRequirements | Schema encoding/decoding services` requirements;
- input and event rejection;
- migration and Store factory signatures.

The file is included by the package tsconfig and must compile without runtime execution.

## Risks / Trade-offs

- **[Public cases become a compatibility surface]** → Keep case names descriptive but treat required behavior, not exact implementation structure, as the contract.
- **[One suite may be slower]** → Reuse fixtures within a case only when isolation remains deterministic; correctness takes priority.
- **[Type assertions can be brittle across Effect releases]** → Assert semantic channels and assignability, not rendered compiler strings.

## Migration Plan

1. Inventory every assertion in both suites and create a coverage matrix.
2. Expand the public case corpus until it subsumes the private suite.
3. Run the memory adapter only through the public cases and delete the duplicate helper.
4. Add `Durable.types.ts` and package inclusion checks.
5. Update adapter documentation and run typecheck, tests, API, and package checks.

External adapters can adopt new cases incrementally during development, but conformance is achieved only when the entire exported corpus passes.
