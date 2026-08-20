## Why

The new durable modules work, but they bypass several conventions the repository explicitly uses to keep Effect libraries consistent: reusable operations are mostly arrows around `Effect.gen`, the memory service is not built with `Store.of`, casts are scattered and undocumented, and canonical examples teach broad barrel imports. Existing lint warnings and dead work make that drift harder to see.

## What Changes

- Convert reusable durable and remaining ordinary-runtime Effect functions to `Effect.fnUntraced`, retaining only documented inference exceptions and one-off Effect values.
- Construct the memory adapter with `Store.of` and keep its focused Layer constructor.
- Concentrate unavoidable type erasure in named helpers with one-line reasons; replace avoidable casts with guards or typed constructors.
- Remove the unused aggregate model and duplicate region-state encoding, and make the package warning-free under Biome.
- Update canonical README, example, and prototype imports to stable public subpaths while retaining intentional barrel smoke tests.
- Add a check that prevents new Biome warnings and broad imports in maintained examples.

## Capabilities

### New Capabilities

None. This is convention, tooling, and documentation cleanup and the change opts out of spec deltas.

### Modified Capabilities

None.

## Impact

This touches durable implementation authoring style, a small `Machine.ts` remainder, prototypes, examples, README snippets, and package quality checks. Runtime and public API behavior are intentionally unchanged.
