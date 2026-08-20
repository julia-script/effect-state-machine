## Context

See `proposal.md` and the durable delta spec. The runner already uses machine Schemas for state and event values, but entry planning can fall back from an encoded region slot to a decoded runtime value asserted as `Json`. Activity outcome messages likewise cast a constructed envelope. Compatibility failures currently overload branded persistence-version strings for format and definition mismatches, and translated boundary errors retain only rendered messages.

## Goals / Non-Goals

**Goals:**

- Make published Schemas the sole authority for values crossing the Store boundary.
- Keep persistence validation failures typed and atomic.
- Give callers a branchable compatibility reason without string parsing.
- Preserve live diagnostic ancestry without persisting arbitrary error objects.

**Non-Goals:**

- Change canonical JSON format or checkpoint format version unless implementation discovery proves it necessary.
- Serialize database errors or full Effect Causes.
- Infer definition compatibility by decoding state alone.

## Decisions

### Keep encoded parent and local values coupled

Entry planning will receive both the decoded state used for authored functions and the Schema-encoded parent JSON used for persistence. A guarded helper will require the encoded parent to be an object with an own property for each active region slot. The local command snapshot comes only from that encoded property. Missing or non-JSON slots fail as `DurableEncodingError`; the decoded `Tagged` value is never used as persistence fallback.

Planning becomes Effectful only where validation can fail. Pure identity and transition planning remain pure.

Alternative considered: independently encode the decoded local region value. Rejected because the local tagged-union Schema is not retained as an independently addressable codec, and doing so could diverge from transformations applied by the parent state Schema.

### Validate complete durable envelopes with their public Schemas

Constructors may assemble typed values in memory, but the final checkpoint, message, activity command, outcome, dispatch record, or migration document will be encoded/validated by its published Schema before Store invocation. A shared boundary helper maps parse failures to `DurableEncodingError` with the operation and live cause.

Alternative considered: rely on TypeScript structural types. Rejected because types cannot prove JSON compatibility or transformation output at runtime.

### Model compatibility as a tagged reason union

`CompatibilityError` will carry `instanceId` plus a `reason` discriminated union:

- `CheckpointFormatMismatch { expectedFormatVersion, actualFormatVersion }`
- `DefinitionMismatch { expectedDefinitionId, actualDefinitionId }`
- `PersistenceVersionMismatch { expected, actual }`
- `MissingMigration { from, target }`

Resume checks definition and format independently so diagnostics are precise. Missing migration remains a compatibility error because callers can recover by supplying a migration; invalid migration execution remains `MigrationError`.

Alternative considered: separate top-level error classes per dimension. Rejected because the recovery boundary is still “checkpoint is incompatible,” and a reason union keeps `catchTag("CompatibilityError")` ergonomic.

### Preserve opaque causes only in live errors

`DurableEncodingError`, `StoreError`, and `MigrationError` gain an optional `cause: unknown`. Adapters translate external failures once and retain the original value. Durable defect summaries continue to persist category, name, and message only.

## Risks / Trade-offs

- **[Additional validation costs CPU]** → Validate once at each Store boundary and remove duplicate intermediate encoding; correctness dominates for durable I/O.
- **[Error field change breaks callers]** → Make the break explicit before release and provide migration examples from `expected/actual` to `reason._tag`.
- **[Cause fields tempt persistence]** → Document them as process-local diagnostics and keep them out of every persisted Schema.

## Migration Plan

1. Add tests for transformed states and malformed durable envelopes.
2. Add new error reason types and migrate all construction/tests/docs in one change.
3. Replace JSON assertions with Schema boundary helpers.
4. Update the memory adapter and conformance fixtures to validate envelopes.
5. Run type, migration, recovery, and packed-public-API tests.

Rollback before release is a code revert. No stored data migration is planned because the persisted envelope format is unchanged.
