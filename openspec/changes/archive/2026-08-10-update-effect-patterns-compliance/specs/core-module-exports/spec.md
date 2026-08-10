## Purpose

Defines the stable public import contract of the effect-state-machine package: which subpaths consumers may import, in both source-linked (workspace) and published forms, so dependencies stay narrow and explicit.

## ADDED Requirements

### Requirement: Per-module public subpaths

The effect-state-machine package SHALL expose the subpaths `./Machine`, `./Graph`, `./Mermaid`, and `./SourceLocation` in its export map, in addition to the existing `.` (root barrel), `./devtools`, and `./package.json` entries. Each subpath SHALL resolve in both the workspace (source) form and the published form, and the published form MUST provide type declarations alongside the JavaScript entry.

#### Scenario: Consumer imports a single module subpath

- **WHEN** a consumer writes `import * as Machine from "effect-state-machine/Machine"`
- **THEN** the import resolves and provides the same exports as the `Machine` namespace on the root barrel, both in the workspace and against the published package

#### Scenario: Existing entrypoints keep working

- **WHEN** a consumer imports `effect-state-machine` or `effect-state-machine/devtools`
- **THEN** those imports resolve unchanged, with the same namespaces as before the subpaths were added

### Requirement: Internal modules stay private

The package SHALL NOT expose an export subpath for internal modules (`Source`). An import of `effect-state-machine/Source` MUST fail to resolve.

#### Scenario: Internal module import is rejected

- **WHEN** a consumer attempts `import * as Source from "effect-state-machine/Source"`
- **THEN** module resolution fails in both workspace and published forms

### Requirement: Package verification covers subpaths

The package's packaging check SHALL verify that every public subpath in the publish export map resolves to files actually emitted in the build output.

#### Scenario: Packaging check fails on a broken subpath

- **WHEN** a public subpath entry points at a file missing from the build output
- **THEN** the packaging check exits non-zero and names the broken subpath
