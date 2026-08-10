# Update effect-state-machine (packages/core) to follow effect-patterns

## Why

An effect-patterns review of `packages/core` found the package structurally sound (concept-oriented modules, data-first APIs, Effect-native interpreter and tests) but non-compliant on three points: consumers cannot import narrow public subpaths because the export map only exposes the root barrel and `./devtools`; reusable Effect-returning functions are authored as arrows returning `Effect.gen` instead of `Effect.fnUntraced`; and most type casts at erasure boundaries are undocumented. The repo also has no Effect conventions doc, so these regressions can silently recur.

## What Changes

- Add per-module subpath exports (`./Machine`, `./Graph`, `./Mermaid`, `./SourceLocation`) to `packages/core/package.json` in both the dev and `publishConfig` export maps, alongside the existing `.` and `./devtools` entries. `Source` stays internal.
- Convert reusable Effect-returning functions in `Machine.ts` from arrow-returning-`Effect.gen` to `Effect.fnUntraced`: `run` and its internal helpers (`startInvocation`, `startChild`, `closeActiveChild`, `commit`, `process`) and the handle's `can`/`send` implementations.
- Document each remaining `as` cast at a type-erasure boundary with a short justification comment (the interpreter-boundary cast at `Machine.ts:1311` is the existing model), or remove the cast where the signature can be fixed instead.
- Seed an Effect conventions section into the repo's agent docs (adapted from the effect-patterns skill's conventions reference) so the rules are durable.

Not changing: error model (`MachineDefinitionDefect`/`ProtocolDefect` are deliberate defects, not typed failures — sync builder throws are the documented authoring design), pure `Graph`/`Mermaid`/`SourceLocation` modules, and the test suite (already `@effect/vitest` + `it.effect` + `assert` + `TestClock`).

## Capabilities

### New Capabilities

- `core-module-exports`: the effect-state-machine package's stable public import contract — which subpaths consumers may import (`.`, `./devtools`, `./Machine`, `./Graph`, `./Mermaid`, `./SourceLocation`) in both source-linked and published forms.

### Modified Capabilities

<!-- none — remaining changes are refactors/docs with no spec-level behavior change -->

## Impact

- `packages/core/package.json` — export maps (dev + publish); `scripts/check-package.mjs` may need updating to verify the new subpaths.
- `packages/core/src/Machine.ts` — function authoring refactor and cast comments; no behavior change, existing tests must stay green.
- `AGENTS.md` / `docs/agents/` — new Effect conventions doc.
- Consumers (`packages/studio`, `packages/studio-client`, demos) keep working — root barrel is unchanged; subpaths are additive.
