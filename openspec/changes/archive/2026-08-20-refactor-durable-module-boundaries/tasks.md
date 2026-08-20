## 1. Pin Existing Boundaries

- [x] 1.1 Add an import-cycle check that fails on dependencies from durable implementation leaves back through the public façade
- [x] 1.2 Add packed-declaration assertions that `_durableRuntime` and private durable/planner modules are not consumer-visible
- [x] 1.3 Confirm ordinary and durable transition characterization suites cover every planner operation before extraction

## 2. Extract the Durable Protocol Leaf

- [x] 2.1 Create the package-private durable protocol module containing brands, Schemas, errors, Store, request models, options, and handle contracts
- [x] 2.2 Redirect runner, memory, and conformance imports to the protocol leaf and remove their imports from the public façade
- [x] 2.3 Turn `Durable.ts` into a one-way façade while preserving every existing named export and generated public declaration
- [x] 2.4 Verify the source dependency graph is acyclic and the private leaf has no package export-map entry

## 3. Extract the Shared Planner

- [x] 3.1 Move runtime node projections and pure event/outcome/after selection into a typed private planner module
- [x] 3.2 Move region macrostep, completion, owned-command, stale-entry, and duration planning into the same private module
- [x] 3.3 Update the ordinary interpreter to import and apply the typed planner operations without behavior changes
- [x] 3.4 Update the durable runner to import typed operations directly and remove its `unknown` adapter calls
- [x] 3.5 Remove `Machine._durableRuntime`, obsolete planner types, and redundant erasure casts

## 4. Verify

- [x] 4.1 Run core typecheck and the ordinary, durable, regions, invocation, child, inspection, and graph test suites
- [x] 4.2 Run import-cycle, Biome, API extraction, package build, and packed-consumer checks
- [x] 4.3 Validate the OpenSpec change in strict mode
