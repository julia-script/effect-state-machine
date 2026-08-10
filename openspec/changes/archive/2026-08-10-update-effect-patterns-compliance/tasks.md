## 1. Public subpath exports (core-module-exports)

- [x] 1.1 Add `./Machine`, `./Graph`, `./Mermaid`, `./SourceLocation` to the dev `exports` map in `packages/core/package.json`, pointing at `./src/<Module>.ts` (per design D1; `Source` stays private per D2)
- [x] 1.2 Add matching `{ types, import }` entries to `publishConfig.exports` pointing at `dist/<Module>.d.ts` / `dist/<Module>.js`
- [x] 1.3 Extend `packages/core/scripts/check-package.mjs` to resolve every `publishConfig.exports` entry against the build output and fail non-zero naming any broken subpath
- [x] 1.4 Verify: `pnpm --filter effect-state-machine check:package` passes, and a workspace consumer import of `effect-state-machine/Machine` typechecks while `effect-state-machine/Source` fails to resolve

## 2. Effect-native function authoring in Machine.ts

- [x] 2.1 Convert the interpreter-internal helpers (`startInvocation`, `startChild`, `closeActiveChild`, `commit`, `process`) from arrows returning `Effect.gen` to `Effect.fnUntraced`
- [x] 2.2 Convert the handle's `can` and `send` implementations to `Effect.fnUntraced`
- [x] 2.3 Convert `run` to `Effect.fnUntraced`, keeping its explicitly annotated public return type; if generic inference forces new casts, keep the annotated arrow and add a comment recording the justified exception (design D3)
- [x] 2.4 Verify: `pnpm --filter effect-state-machine typecheck && pnpm --filter effect-state-machine test` — all existing tests pass unmodified

## 3. Cast documentation

- [x] 3.1 Audit every `as` cast in `packages/core/src` and add a one-line justification comment at each type-erasure boundary (model: existing comment at `Machine.ts:1311`), fixing the signature instead wherever the fix is local (design D4)
- [x] 3.2 Verify: `pnpm --filter effect-state-machine typecheck` passes and no new casts were introduced

## 4. Effect conventions doc

- [x] 4.1 Write `docs/agents/effect-conventions.md` adapted from the effect-patterns skill's conventions reference: public subpath imports, concept-oriented modules, data-first APIs, defect-vs-typed-error policy (`MachineDefinitionDefect`/`ProtocolDefect` are defects by design), `Effect.fnUntraced` authoring, cast policy, `@effect/vitest` testing rules
- [x] 4.2 Add an "Effect conventions" section to `AGENTS.md` linking the new doc, following the existing one-line-pointer pattern

## 5. Final verification

- [x] 5.1 Run the full gate from the repo root: `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm --filter effect-state-machine check` — report actual output
