## MODIFIED Requirements

### Requirement: Per-module public subpaths

The effect-state-machine package SHALL expose the subpaths `./Machine`, `./Durable`, `./Graph`, `./Mermaid`, and `./SourceLocation` in its export map, in addition to the existing `.` (root barrel), `./devtools`, and `./package.json` entries. Each subpath SHALL resolve in both the workspace (source) form and the published form, and the published form MUST provide type declarations alongside the JavaScript entry.

#### Scenario: Consumer imports a single module subpath

- **WHEN** a consumer writes `import * as Machine from "effect-state-machine/Machine"`
- **THEN** the import resolves and provides the same exports as the `Machine` namespace on the root barrel, both in the workspace and against the published package

#### Scenario: Consumer imports durable execution

- **WHEN** a consumer writes `import * as Durable from "effect-state-machine/Durable"`
- **THEN** the import resolves and provides the same exports as the `Durable` namespace on the root barrel, both in the workspace and against the published package

#### Scenario: Existing entrypoints keep working

- **WHEN** a consumer imports `effect-state-machine` or `effect-state-machine/devtools`
- **THEN** those imports resolve unchanged, with the same namespaces as before the durable subpath was added
