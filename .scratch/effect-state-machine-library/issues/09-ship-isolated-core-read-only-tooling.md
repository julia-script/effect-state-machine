# 09 — Ship isolated core and read-only tooling surfaces

**What to build:** Package the proven state-machine core and optional read-only tooling so Effect users can install a small library, keep production imports clean, and inspect their own application behavior in code and as a graph.

**Blocked by:** 08 — Prove the library with a local-first document workflow

**Status:** completed

- [x] The package exposes stable, documented entry points for machine definition/execution and for optional tooling.
- [x] Importing the core does not load Mermaid, a UI framework, renderer code, or devtools-only dependencies.
- [x] The tooling surface projects definitions into the renderer-independent graph model and provides Mermaid as the initial renderer.
- [x] A simple read-only development experience displays the reference workflow's graph without making the graph an editable source of truth.
- [x] The package ships no React, Vue, Effect Atom, or other application-framework binding and adds no Promise methods or global runtime.
- [x] Package exports, generated declarations, build output, and tree-shaking behavior are verified from a consumer's perspective.
- [x] User documentation explains the promise of preserving codebase literacy during agentic development, the code-first graph model, installation, a minimal Effect-native quick start, and the supported runtime contract.
- [x] A clean consumer project can install the package with pnpm, define and run a machine, supply dependencies with a Layer, and generate a graph using the documented APIs.
- [x] Compatibility with the selected Effect beta version and the supported TypeScript/toolchain versions is explicit and tested.
- [x] All repository checks and the complete conformance suite pass from a clean install.

## Implementation

- `effect-state-machine` exports only `Machine`; `effect-state-machine/devtools` exports `Graph`
  and `Mermaid`. The package is ESM, side-effect-free, and peers on the exact supported Effect beta.
- The declaration build follows only the two public entry graphs. Legacy prototype sources and UI
  code are absent from the tarball.
- `pnpm build` emits modules, declarations, maps, and a read-only Mermaid artifact for the reference
  workflow.
- `scripts/check-package.mjs` packs and installs the tarball into a clean temporary pnpm consumer,
  verifies its types and runtime behavior, and inspects an esbuild metafile for core isolation.
- The README now documents product intent, installation, an Effect/Layer quick start, graph tooling,
  runtime semantics, v0 scope, compatibility, and clean verification.
