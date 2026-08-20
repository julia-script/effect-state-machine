## Context

See `proposal.md` for the reviewed drift. Production imports already use stable Effect subpaths, tests use `@effect/vitest`, clocks are Effect-native, and scoped fibers are correct. The cleanup is concentrated in durable function authoring, service construction, cast documentation, maintained examples, and the current Biome warning baseline.

## Goals / Non-Goals

**Goals:**

- Apply the repository's existing Effect and type-safety conventions consistently.
- Reach a warning-free package baseline that can prevent regression.
- Keep public signatures and runtime behavior unchanged.

**Non-Goals:**

- Rework durable module boundaries or Cause semantics; those have dedicated changes.
- Force `Effect.fnUntraced` onto generic recursive `Machine.run` without a proven type-safe form.
- Replace intentional barrel-import package smoke tests.

## Decisions

### Classify functions before mechanical conversion

Reusable parameterized functions that return Effects become `Effect.fnUntraced`, with explicit public or local signatures pinned where inference is important. Already-built one-off Effect values such as worker steps, drains, synchronization values, and conformance `run` fields remain ordinary `Effect.gen`. The documented generic-recursive exception for `Machine.run` remains.

Alternative considered: replace every `Effect.gen` mechanically. Rejected because it would obscure the distinction between a reusable Effect function and an Effect value and can destabilize generic inference.

### Construct Store implementations through the capability

The memory service value will be returned through `Store.of({ ... })`; `layerMemory` remains the focused Layer constructor. This gives adapter construction one capability-owned type checkpoint without moving adapter behavior into the Store class.

### Treat casts as named boundaries

Avoidable casts become property predicates, Schema decoding, or typed constructors. Irreducible authoring/runtime erasure moves into a small number of named helpers, each with the one-line reason required by repository policy. This change will not duplicate work scheduled in the private planner extraction; it cleans remaining boundaries after that change or excludes overlapping files when applied first.

### Make quality gates explicit

Remove the unused `AggregateProgress`, the unused duplicate region encoding, prototype `any` warnings, and the type-only import warning. The package check will fail on Biome warnings. Maintained README/examples/prototypes will use stable subpaths; tests whose purpose is to verify barrels are allowlisted by path and comment.

## Risks / Trade-offs

- **[Function conversion changes inferred channels]** → Pin signatures first and run typecheck after each module.
- **[Warning gate catches generated or experimental code]** → Scope it to maintained package paths and make exceptions explicit rather than global.
- **[Overlap with module-boundary refactor causes conflicts]** → Apply `refactor-durable-module-boundaries` before cast cleanup, or rebase this change after extraction.

## Migration Plan

1. Establish warning and broad-import checks with current intentional exceptions.
2. Remove dead work and current warnings.
3. Convert service construction and reusable Effect functions module by module.
4. Tighten and document cast boundaries after structural extraction settles.
5. Update maintained imports and run typecheck, tests, Biome, API, and package checks.

Rollback is a source-only revert with no public or persisted-data migration.
