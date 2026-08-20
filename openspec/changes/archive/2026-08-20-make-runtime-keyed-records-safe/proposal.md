## Why

Authored state tags, region slots, invocation names, and instance IDs are runtime keys, but parts of both interpreters write them into ordinary objects or pass them directly to URI encoders. Keys such as `__proto__` can mutate prototypes, and malformed UTF-16 can synchronously throw `URIError` from otherwise total APIs.

## What Changes

- Use `Map`, null-prototype dictionaries, or explicit own-property definition for all runtime-authored keyed collections before producing public records.
- Preserve authored keys such as `__proto__`, `constructor`, and `prototype` as ordinary own data properties in machine and durable region execution.
- Centralize deterministic well-formed component encoding for durable identities, child definition paths, and source-location links.
- Keep synchronous identity/path helpers total for arbitrary JavaScript strings and ensure distinct well-formed inputs retain distinct encoded identities.
- Add ordinary/durable region-key and malformed-surrogate regression tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `statechart-regions`: Require authored region-slot keys to be handled as data without prototype mutation.
- `durable-machine-execution`: Require stable durable identity derivation and keyed checkpoint metadata for arbitrary caller/authored strings.
- `machine-tree-inspection`: Require child definition paths to remain deterministic and total for arbitrary authored names.

## Impact

This affects keyed-record construction in `Machine.ts` and `DurableRunner.ts`, durable identity helpers, child path construction, `SourceLocation` link generation, and related tests. Public value shapes remain unchanged.
