# Tasks

## 1. Restore the release gate

- [x] 1.1 Rewrite the `core.ts` consumer fixture in `packages/core/scripts/check-package.mjs` to the current authoring API (`define(config, statesRecord)`, `state(on)`, `invoke(config)`, `final()`), keeping the existing assertions (subpath isolation, Layer injection, runtime execution) intact. Mirror the style used in `packages/core/tests/Completion.test.ts`.
- [x] 1.2 Rewrite the `tooling.ts` consumer fixture in the same script to the current API, keeping the Graph/Mermaid assertions and the send/changes runtime check.
- [x] 1.3 Run `pnpm --filter effect-state-machine run check:package` and confirm it exits green.

## 2. Package READMEs

- [x] 2.1 Write `packages/core/README.md` — short: what the library is, install, one `define` example (can be condensed from root README), link to docs site. Current-API examples only.
- [x] 2.2 Write `packages/studio-client/README.md` — what it does (connects running machines to Studio), install, minimal attach example.
- [x] 2.3 Write `packages/studio/README.md` — what it does (standalone Studio devtool), `npx effect-state-machine-studio` usage.
- [x] 2.4 Review root `README.md` and `packages/studio-react/README.md` for stale API or stale claims; fix anything outdated.
- [x] 2.5 Confirm each package tarball now includes its README: `pnpm pack` per package, `tar -tf | grep -i readme`.

## 3. Packaging cleanup

- [x] 3.1 In `packages/studio/package.json`, move `react`, `react-dom`, `effect-state-machine`, `@effect-state-machine/studio-client`, `@effect-state-machine/studio-react` from `dependencies` to `devDependencies` (they are fully bundled into `dist/`; only `effect` and `@effect/platform-node` are esbuild externals and stay runtime deps). Rebuild studio and rerun its tests plus a manual `node bin/studio.mjs` smoke start.
- [x] 3.2 In `packages/studio-react/package.json`, relax `react`/`react-dom` peer pins from `19.2.8` to `^19.2.8`.
- [x] 3.3 Delete the stale `dist/` directory at the repo root (gitignored pre-refactor core build output).
- [x] 3.4 Run `pnpm format` to fix the three biome formatting failures; confirm `pnpm exec biome check .` is clean.

## 4. Release readiness

- [x] 4.1 Run the full `pnpm check` at the workspace root and confirm everything is green end to end.
- [x] 4.2 Decide the first-publish path with Julia: publish the current `0.1.0` directly (`changeset publish` publishes any version missing from the registry — no changeset file needed for a first release) or add a changeset and bump first. Default recommendation: publish `0.1.0` as-is, use changesets from the next change onward.
- [x] 4.3 Dry-run the publish (`pnpm -r publish --dry-run --no-git-checks`) and eyeball each package's resolved `exports`, `files`, and versions.
