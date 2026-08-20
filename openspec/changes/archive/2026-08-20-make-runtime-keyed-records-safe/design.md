## Context

See `proposal.md` and the three delta specs. Runtime-authored strings appear in region update records, durable region-entry maps, identity components, child definition paths, and editor links. Ordinary indexed assignment and `Object.assign` invoke the special `__proto__` setter on normal objects. JavaScript URI encoders throw on unpaired UTF-16 surrogates.

## Goals / Non-Goals

**Goals:**

- Treat open runtime keys as data across ordinary and durable interpreters.
- Keep identity/path construction deterministic and total for accepted strings.
- Preserve normal public object shapes where consumers expect records.

**Non-Goals:**

- Restrict authored names to an ASCII subset.
- Change identity delimiters or encodings for existing well-formed strings.
- Introduce a general-purpose collection package.

## Decisions

### Use Map while accumulating open-key data

Region updates and durable entry IDs will accumulate in `Map<string, T>`. At the boundary requiring a record, a helper will create a normal object and install each key with `Object.defineProperty(..., { enumerable: true, configurable: true, writable: true, value })`. This preserves an ordinary prototype without invoking setters for `__proto__`.

For purely internal records, a null-prototype dictionary is also acceptable when no public prototype contract exists, but one helper and strategy will be used consistently per representation.

Alternative considered: object spread. Rejected as the primary rule because safety differs by operation and invites future reintroduction of indexed writes or `Object.assign`.

### Normalize malformed UTF-16 before URI encoding

A private string helper will replace each unpaired surrogate with U+FFFD using `String.prototype.toWellFormed` when available and an equivalent deterministic fallback otherwise. Identity and path code then applies the existing `encodeURIComponent`/`encodeURI` semantics to the well-formed string.

Existing well-formed inputs therefore keep byte-for-byte identity output. Malformed inputs become total and deterministic; different malformed spellings that normalize to the same replacement sequence may collide, which is preferable to synchronous defects and will be documented.

Alternative considered: reject malformed strings at branded constructors. Rejected because authored state and invocation names are plain strings and several helpers are documented as pure total constructors.

### Centralize key and component helpers

One internal module will own safe record materialization and well-formed component encoding. Machine, Durable, and SourceLocation call it rather than open-coding platform edge cases. The module remains private and dependency-free.

## Risks / Trade-offs

- **[Malformed strings can normalize to the same replacement form]** → Preserve exact behavior for all well-formed inputs and document normalization for malformed UTF-16.
- **[Record conversion changes property descriptors]** → Match ordinary assignment descriptors and assert enumerable/writable/configurable behavior.
- **[Hidden unsafe writes remain elsewhere]** → Audit all `Record<string, ...>` mutations and add a lint/search regression check for open-key `Object.assign` sites.

## Migration Plan

1. Add regression tests for prototype-overlapping slots and malformed surrogate inputs.
2. Introduce private safe-string and safe-record helpers.
3. Migrate ordinary region planning, durable checkpoint planning, identities, child paths, and source links.
4. Verify existing well-formed identity snapshots remain unchanged.
5. Run ordinary, durable, graph/source-location, type, and package tests.

No persisted migration is needed because well-formed identities remain stable. Instances whose IDs contain malformed UTF-16 could not previously be created reliably.
