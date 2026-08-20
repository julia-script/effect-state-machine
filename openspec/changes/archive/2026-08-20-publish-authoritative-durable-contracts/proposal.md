## Why

The package currently protects its memory adapter with a private nine-case conformance suite but publishes a separate four-case suite to third-party adapter authors. The public `Durable.run` signature also crosses a broad type-erasure cast without a permanent exact-type contract, so runtime and compile-time adapter guarantees can drift.

## What Changes

- Make the framework-neutral public store conformance corpus the single authoritative source of granular adapter behavior.
- Port every stronger private assertion, including terminal-instance rejection, duplicate observer behavior, renew/release semantics, migration fencing, and tombstone retention, into named public cases.
- Reduce package tests to a thin `@effect/vitest` registration wrapper around the public corpus.
- Add permanent compile-time tests for `Durable.run`, handle state/event/completion types, durable errors, Scope/Store/machine/Schema requirements, migrations, and invalid input/event usage.
- Document how adapter authors execute and extend the conformance corpus.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `durable-machine-execution`: Require the published conformance corpus to exercise the complete Store contract used to certify the bundled adapter.

## Impact

This affects `DurableConformance.ts`, the duplicate test-local conformance helper, Store tests, a new durable type-contract test file, and adapter-facing documentation. It does not change valid Store or runner behavior.
