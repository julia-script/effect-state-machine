## 1. Characterize Persistence Boundaries

- [x] 1.1 Add transformed-state tests proving region activity snapshots come only from the Schema-encoded parent representation
- [x] 1.2 Add tests for missing encoded region slots and invalid checkpoint, command, outcome, dispatch, and migration envelopes
- [x] 1.3 Add compile-time and runtime tests for every compatibility reason variant and optional live causes

## 2. Remove JSON Escape Hatches

- [x] 2.1 Introduce a shared Schema boundary helper that validates durable envelopes and maps parse failures to `DurableEncodingError`
- [x] 2.2 Make region entry planning require an own encoded parent slot and remove the generic `unknown -> Json` fallback
- [x] 2.3 Validate complete activity-outcome and outcome-message envelopes before Store completion
- [x] 2.4 Apply the boundary helper to checkpoints, messages, commands, dispatch records, and migration documents at Store crossings
- [x] 2.5 Remove superseded JSON assertions and duplicate encodings, then document any remaining type-erasure boundary

## 3. Structure Durable Errors

- [x] 3.1 Define the tagged compatibility-reason union for format, definition, persistence-version, and missing-migration mismatches
- [x] 3.2 Replace `CompatibilityError.expected/actual` with the reason union and migrate runner construction, tests, examples, and TSDoc
- [x] 3.3 Add optional opaque causes to encoding, Store, and migration boundary errors and preserve original failures during translation
- [x] 3.4 Verify no live cause or arbitrary error object appears in persisted Schemas or durable defect summaries

## 4. Verify

- [x] 4.1 Run core typecheck and durable encoding, runner, resume, migration, region, Store, and type-contract tests
- [x] 4.2 Run Biome, API extraction, package build, and packed-consumer verification
- [x] 4.3 Validate the OpenSpec change in strict mode and document the pre-release compatibility-error migration
