## Why

The durable implementation imports protocol types through its own public façade, creating three module cycles, while the shared transition planner is exposed as the `Machine._durableRuntime` value in published declarations. These seams make private interpreter structure consumer-visible and increasingly fragile without adding supported behavior.

## What Changes

- Move durable identifiers, schemas, errors, request models, and the Store capability into a cycle-free protocol leaf imported by runner, memory, and conformance modules.
- Keep `effect-state-machine/Durable` as the one-way public façade and preserve its existing named exports.
- Extract the shared pure transition-planning kernel from the public `Machine` module into a private, typed internal module used by both interpreters.
- Remove `_durableRuntime` from the public `Machine` declaration and add package checks that prevent internal planner exports from returning.

## Capabilities

### New Capabilities

None. This is an internal refactor and the change opts out of spec deltas.

### Modified Capabilities

None.

## Impact

This reorganizes `packages/core/src/Durable*.ts`, `Machine.ts`, the package build graph, and packed-consumer declaration assertions. Public import paths and runtime semantics are intentionally unchanged.
