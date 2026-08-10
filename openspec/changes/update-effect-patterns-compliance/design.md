# Design

## Context

See proposal.md — Why. Current state that shapes the approach:

- `packages/core/package.json` uses a dual export map: dev exports point at `src/*.ts`, `publishConfig.exports` points at `dist/*.js` + `dist/*.d.ts`. `scripts/check-package.mjs` verifies the published shape after build.
- `Machine.run` is a generic arrow (`<InputSchema, StateSchema, EventSchema, Nodes>`) with an explicitly annotated `Effect.Effect<MachineHandle<…>, never, Scope | Requirements>` return type, wrapping one large `Effect.gen`. Its internal helpers (`startInvocation`, `startChild`, `closeActiveChild`, `commit`, `process`) and the handle's `can`/`send` are arrows returning `Effect.gen`, all closing over interpreter-local state (`generation`, `activeChild`, refs, queues).
- Effect version is pinned to `4.0.0-beta.106` (peer + dev), so `Effect.fnUntraced` is available.
- Repo agent docs follow a pattern: one-line section in `AGENTS.md` pointing to a file under `docs/agents/`.

## Goals / Non-Goals

**Goals:**
- Compliance changes that are invisible to runtime behavior — the full existing test suite passes unmodified.
- Subpath exports verified by the same packaging check that guards the existing entrypoints.

**Non-Goals:**
- No changes to the error/defect model, the sync builder design, or the interpreter's event-loop semantics.
- No compliance pass over `packages/studio-client` or `packages/studio` (separate change if wanted).
- No migration of consumers to the new subpaths — the root barrel stays supported.

## Decisions

**D1 — Export map mirrors the existing dual pattern.** Add `"./Machine": "./src/Machine.ts"` (etc.) to the dev exports and `{ types: "./dist/Machine.d.ts", import: "./dist/Machine.js" }` (etc.) to `publishConfig.exports`. Alternative — a wildcard `"./*"` entry — rejected: it would expose `Source` and any future internal module by default; the explicit list *is* the public contract.

**D2 — `Source` stays private.** Its `Reference` type appears structurally in public signatures, which TypeScript resolves without an importable module; nothing forces us to widen the contract. If consumers later need the name, re-export the type from `Machine`.

**D3 — Convert to `Effect.fnUntraced`, keep `run`'s pinned signature.** Internal helpers convert mechanically (`const commit = Effect.fnUntraced(function* (previous: State, next: State) { … })`) since generator function expressions carry parameter types fine and the helpers close over interpreter state exactly as before. For the generic `run`, keep the existing explicit return-type annotation on the exported const so the public signature stays pinned (the effect-patterns `Effect.fn.Return` guidance — the annotation already serves that purpose); the generator callback carries the type parameters. If TypeScript 7 (the pinned compiler) cannot express the generic `fnUntraced` form for `run` without new casts, keep `run` as an annotated arrow over `Effect.gen` and record that as the justified exception — trading one authoring-convention win for new casts would be a net loss.

**D4 — Cast policy: comment, don't restructure.** Each remaining `as` at a type-erasure boundary gets a one-line comment naming why TypeScript cannot express the truth (model: the existing comment at `Machine.ts:1311`). The `{} as EventHandlers<…>` empty-default casts and `as unknown as TaggedUnion<Cases>` in `taggedUnion` are erasure boundaries, not fixable signatures. No cast is removed by restructuring in this change unless the fix is local to one signature.

**D5 — Conventions doc follows the repo's agent-docs pattern.** New `docs/agents/effect-conventions.md` seeded from the effect-patterns skill's conventions reference, adapted to this repo (public subpaths per D1, defects-not-typed-errors for `MachineDefinitionDefect`/`ProtocolDefect`, `@effect/vitest` testing rules), plus a one-line section in `AGENTS.md` linking it.

## Risks / Trade-offs

- [`fnUntraced` conversion subtly changes evaluation timing (eager argument capture vs lazy gen)] → helpers are only called with already-computed values inside the interpreter loop; the full test suite (including TestClock retry/cancellation tests) gates the refactor.
- [Generic inference breaks on `run` under `fnUntraced`] → D3 explicitly allows keeping the annotated arrow for `run` alone; the convention win is in the helpers.
- [Published subpath entries drift from build output] → extend `check-package.mjs` to resolve every `publishConfig.exports` entry against `dist/` (spec requirement), so `pnpm check:package` fails on drift.
- [Conventions doc conflicts with existing docs] → `AGENTS.md` currently has no Effect section; additive only.
