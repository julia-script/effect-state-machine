# 09 — Ship isolated core and read-only tooling surfaces

**What to build:** Package the proven state-machine core and optional read-only tooling so Effect users can install a small library, keep production imports clean, and inspect their own application behavior in code and as a graph.

**Blocked by:** 08 — Prove the library with a local-first document workflow

**Status:** ready-for-agent

- [ ] The package exposes stable, documented entry points for machine definition/execution and for optional tooling.
- [ ] Importing the core does not load Mermaid, a UI framework, renderer code, or devtools-only dependencies.
- [ ] The tooling surface projects definitions into the renderer-independent graph model and provides Mermaid as the initial renderer.
- [ ] A simple read-only development experience displays the reference workflow's graph without making the graph an editable source of truth.
- [ ] The package ships no React, Vue, Effect Atom, or other application-framework binding and adds no Promise methods or global runtime.
- [ ] Package exports, generated declarations, build output, and tree-shaking behavior are verified from a consumer's perspective.
- [ ] User documentation explains the promise of preserving codebase literacy during agentic development, the code-first graph model, installation, a minimal Effect-native quick start, and the supported runtime contract.
- [ ] A clean consumer project can install the package with pnpm, define and run a machine, supply dependencies with a Layer, and generate a graph using the documented APIs.
- [ ] Compatibility with the selected Effect beta version and the supported TypeScript/toolchain versions is explicit and tested.
- [ ] All repository checks and the complete conformance suite pass from a clean install.
