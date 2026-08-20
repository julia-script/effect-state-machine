## Context

See `proposal.md` for motivation. `Durable.ts` currently owns protocol declarations and re-exports its runner, memory adapter, and conformance corpus; each of those modules imports back from `Durable.ts`. Separately, fourteen durable-runner calls reach a public `Machine._durableRuntime` object whose `unknown` arguments and casts adapt private transition functions.

## Goals / Non-Goals

**Goals:**

- Establish a one-directional source-module dependency graph.
- Give both interpreters a typed, package-private semantic planning kernel.
- Preserve all supported `Machine` and `Durable` exports and behavior.
- Prevent internal seams from appearing in emitted public declarations.

**Non-Goals:**

- Redesign transition semantics or the public builder API.
- Split checkpoint persistence from the durable queue Store capability.
- Create a public interpreter extension protocol.

## Decisions

### Introduce a package-private durable protocol leaf

A private `DurableProtocol.ts` will own brands, Schemas, request/commit models, errors, the Store service, run options, and handle contracts. `DurableRunner`, `DurableMemory`, and `DurableConformance` will import this leaf directly. `Durable.ts` will only re-export the supported surface from the protocol and implementation leaves.

The file remains absent from the package export map. This preserves the coherent consumer concept `effect-state-machine/Durable` while removing upward dependencies on its façade.

Alternative considered: have implementation files use `import type` from `Durable.ts`. Rejected because runtime schemas, constructors, and Store values still require value imports and the conceptual dependency remains inverted.

### Extract one typed transition-planning kernel

Pure runtime node views, selection functions, transition plans, region plans, completion checks, and duration resolution will move to a private `MachinePlan.ts`. Both `Machine.ts` and `DurableRunner.ts` will import named operations with typed parameters. Any unavoidable authoring-to-runtime erasure will occur once when definitions are projected into the kernel's runtime view.

The kernel owns no Ref, Queue, Scope, Store, or fiber behavior. The ordinary interpreter applies plans to process-local state; the durable runner applies them to checkpoint commits.

Alternative considered: leave planning in `Machine.ts` and export a typed object. Rejected because even a typed `@internal` export appears in the public declaration and invites accidental consumer coupling.

### Assert declaration privacy in package verification

The packed-consumer check will inspect the emitted `Machine.d.ts`/import surface and fail if `_durableRuntime`, the protocol leaf, or planner leaf becomes importable. Existing checks continue to assert that the root and stable subpaths work.

## Risks / Trade-offs

- **[Large source move obscures semantic changes]** → Land characterization tests first and perform mechanical extraction before naming cleanup.
- **[Generic relationships widen during extraction]** → Pin kernel signatures and add compile-time projection tests at the single erasure boundary.
- **[Build tooling accidentally emits private files]** → Permit emitted implementation files as needed but keep them out of export maps and assert consumer resolution failure.

## Migration Plan

1. Add dependency-cycle and public-declaration assertions.
2. Extract the durable protocol leaf and redirect imports without changing exports.
3. Extract the planning kernel with ordinary and durable characterization suites green after each operation group.
4. Remove `_durableRuntime` and obsolete local types.
5. Run typecheck, tests, package build, API extraction, and packed-consumer checks.

Rollback is a source-only revert; public APIs and persisted checkpoint formats do not change.
