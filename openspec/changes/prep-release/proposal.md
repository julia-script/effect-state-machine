# prep-release

## Why

The workspace is close to a first npm release, but the release gate is red and several packaging details would ship broken or sloppy: core's packed-consumer check still exercises the legacy authoring API removed in e4965d3, three of four packages would publish without a README, and the studio package ships five bundled dependencies consumers would install for nothing.

## What Changes

- Migrate `packages/core/scripts/check-package.mjs` consumer fixtures (`core.ts`, `tooling.ts`) from the removed legacy authoring API (`builder().make({ nodes: [...] })`, `state("Name", cfg)`, `invoke("Name", cfg)`, `final("Name")`) to the current API (`define(config, statesRecord)`, `state(on)`, `invoke(config)`, `final()`), restoring the green release gate.
- Add package-level `README.md` to `packages/core`, `packages/studio-client`, and `packages/studio` (their `files` arrays already list it; tarballs currently ship none, so npm pages would be empty).
- Verify the root README and per-package READMEs describe the current API accurately (root README already uses `define`; confirm examples typecheck conceptually).
- Move studio's bundled dependencies (`react`, `react-dom`, `effect-state-machine`, `@effect-state-machine/studio-client`, `@effect-state-machine/studio-react`) to `devDependencies` — only `effect` and `@effect/platform-node` are esbuild externals and belong in runtime `dependencies`.
- Relax studio-react's exact react/react-dom peer pins (`19.2.8`) to `^19.2.8`.
- Run `pnpm format` to fix the three biome formatting failures (`packages/core/src/Graph.ts`, `packages/core/tests/Graph.test.ts`, `apps/docs/src/components/embedded-studio-demo.tsx`).
- Delete the stale gitignored `dist/` directory at the repo root (pre-refactor core build output).
- Add a changeset covering the fixed-version package group so `changeset publish` has something to release.

## Capabilities

### New Capabilities

None — no spec-level behavior changes. This change sets `skip_specs: true`.

### Modified Capabilities

None. The `core-module-exports` packaging-check requirement is unchanged; fixing its fixtures restores verification of the existing contract.

## Impact

- `packages/core/scripts/check-package.mjs` — fixture rewrite only; assertions and isolation checks stay.
- `packages/core/README.md`, `packages/studio-client/README.md`, `packages/studio/README.md` — new files, published in tarballs.
- `packages/studio/package.json` — dependency reclassification (no runtime behavior change; everything except the two externals is bundled).
- `packages/studio-react/package.json` — peer range relaxation.
- `.changeset/*.md` — one new changeset (patch or minor for the 0.1.x fixed group).
- Formatting-only edits to three files; deletion of stale root `dist/`.
- Release flow itself (`pnpm release`) is verified working: changesets v3 publishes via `pnpm publish`, which rewrites `publishConfig.exports` and `workspace:*` correctly.
