## Why

The durable runner has unchecked `unknown -> Json` escape hatches and compatibility errors that brand definition/format descriptions as persistence versions. That weakens the guarantee that every store value is Schema-validated and makes incompatible checkpoints difficult for callers and adapters to diagnose programmatically.

## What Changes

- Remove the generic JSON assertion and require every checkpoint, activity command, and activity outcome to pass its owning Schema before crossing the Store boundary.
- Make entry planning fail with a typed durable encoding error when a transformed state Schema does not provide the encoded region slot required for a command.
- Encode the complete published activity-outcome envelope instead of casting it into canonical JSON.
- **BREAKING**: Replace overloaded compatibility `expected`/`actual` fields with a tagged reason that distinguishes checkpoint format, definition identity, persistence version, and missing migration-path mismatches.
- Preserve opaque causal diagnostics on encoding, migration, and adapter boundary errors while keeping persisted defect summaries sanitized and restart-safe.
- Add transformed-Schema, malformed persisted-value, compatibility-reason, and wrapped-cause tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `durable-machine-execution`: Strengthen canonical persistence validation and make compatibility failures dimension-specific and diagnosable.

## Impact

This affects durable public error types, `DurableRunner`, Store adapter error construction, Schema requirements in runner effects, migration tests, and public API documentation. The `CompatibilityError` field change is intentionally breaking before release.
