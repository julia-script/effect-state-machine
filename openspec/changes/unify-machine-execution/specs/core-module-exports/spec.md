## MODIFIED Requirements

### Requirement: Per-module public subpaths

The effect-state-machine package SHALL expose `./Machine`, `./MachineEngine`, `./MachineStore`, `./LocalStorageMachineStore`, `./MachineWorkflow`, `./Graph`, `./Mermaid`, and `./SourceLocation` in its export map, in addition to `.`, `./devtools`, and `./package.json`. No compatibility execution subpaths SHALL be published. Each public subpath SHALL resolve in workspace and published forms, and the published form MUST provide type declarations alongside JavaScript.

#### Scenario: Consumer imports a single module subpath

- **WHEN** a consumer writes `import * as Machine from "effect-state-machine/Machine"`
- **THEN** the import resolves to the same `Machine` namespace exposed by the root barrel in workspace and published forms

#### Scenario: Consumer imports the engine and store

- **WHEN** a consumer imports `MachineEngine` or `MachineStore` from its public subpath
- **THEN** the corresponding Effect service, constructors, layers, types, and errors resolve without importing unrelated adapters

#### Scenario: Consumer imports browser-local storage

- **WHEN** a consumer imports `LocalStorageMachineStore`
- **THEN** browser-specific dependencies remain isolated to that subpath

#### Scenario: Consumer imports Workflow integration

- **WHEN** a consumer imports `MachineWorkflow`
- **THEN** the optional Effect Workflow integration resolves without making unstable Workflow APIs part of the core `Machine`, `MachineEngine`, or `MachineStore` modules

#### Scenario: Consumer imports durable execution

- **WHEN** a consumer imports `MachineEngine` and `MachineStore` from their documented subpaths
- **THEN** the current engine and persistence services resolve without any compatibility entry point

#### Scenario: Existing entrypoints keep working

- **WHEN** a consumer imports `effect-state-machine` or `effect-state-machine/devtools`
- **THEN** those entrypoints resolve and expose only the current unified namespaces

#### Scenario: Consumer imports an unlisted subpath

- **WHEN** a consumer imports a package subpath outside the documented public module set
- **THEN** module resolution fails and no compatibility entry point is provided
