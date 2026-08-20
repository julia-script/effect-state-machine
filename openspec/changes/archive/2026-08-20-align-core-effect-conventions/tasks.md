## 1. Establish a Clean Baseline

- [x] 1.1 Add a package-scoped check that fails on Biome warnings while preserving explicit generated or smoke-test exceptions
- [x] 1.2 Add a maintained-example import check that rejects broad Effect and package barrels outside intentional barrel contract tests
- [x] 1.3 Remove the unused aggregate model, duplicate region-state encoding, prototype `any` warnings, and type-only import warning

## 2. Normalize Effect Authoring

- [x] 2.1 Inventory reusable Effect-returning functions versus one-off Effect values and record the documented `Machine.run` exception
- [x] 2.2 Convert reusable durable runner operations to `Effect.fnUntraced` with pinned signatures and typecheck after each group
- [x] 2.3 Convert reusable memory Store methods and the durable validator to `Effect.fnUntraced`
- [x] 2.4 Convert the remaining eligible ordinary-runtime helpers while leaving one-off worker/synchronization values as `Effect.gen`
- [x] 2.5 Construct the memory adapter through `Store.of` and verify `layerMemory` provisioning remains unchanged

## 3. Tighten Types and Imports

- [x] 3.1 Replace avoidable casts with guards, predicates, Schema validation, or typed constructors
- [x] 3.2 Concentrate irreducible authoring/runtime erasure in named helpers and add the required one-line reason to each remaining cast
- [x] 3.3 Update README, examples, and prototypes to stable Effect and package subpaths
- [x] 3.4 Retain and annotate root/devtools barrel imports only where a test explicitly verifies those aggregate contracts

## 4. Verify

- [x] 4.1 Run core typecheck and full tests after function and cast normalization
- [x] 4.2 Run warning-free Biome, import policy, API extraction, package build, and packed-consumer checks
- [x] 4.3 Validate the OpenSpec change in strict mode
