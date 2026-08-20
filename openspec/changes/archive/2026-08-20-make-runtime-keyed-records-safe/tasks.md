## 1. Add Edge-Case Coverage

- [x] 1.1 Add ordinary region tests for `__proto__`, `constructor`, and `prototype` slot names, including parallel macrosteps
- [x] 1.2 Add durable region checkpoint and resume tests for the same prototype-overlapping slot names
- [x] 1.3 Add malformed-surrogate tests for durable identity helpers, child definition paths, and source-location links
- [x] 1.4 Snapshot existing well-formed identity and path outputs to prevent accidental persisted-key changes

## 2. Introduce Safe Primitives

- [x] 2.1 Add a private open-key record builder that defines exact own enumerable data properties without invoking prototype setters
- [x] 2.2 Add a private well-formed string/component encoder with deterministic fallback behavior when `String.prototype.toWellFormed` is unavailable
- [x] 2.3 Unit-test property descriptors, prototype preservation, well-formed output compatibility, and malformed normalization

## 3. Migrate Runtime Call Sites

- [x] 3.1 Replace ordinary region update indexed writes with safe keyed accumulation and record materialization
- [x] 3.2 Replace durable region-entry `Object.assign` and related open-record writes with the safe primitive
- [x] 3.3 Route durable identities and child definition paths through the well-formed component encoder
- [x] 3.4 Route source-location editor-link encoding through the well-formed URI helper while retaining best-effort parsing
- [x] 3.5 Audit remaining dynamic `Record<string, ...>` writes and remove or explicitly justify every unsafe-looking site

## 4. Verify

- [x] 4.1 Run ordinary/durable region, child, inspection, source-location, and identity tests plus core typecheck
- [x] 4.2 Run Biome, API extraction, package build, and packed-consumer checks
- [x] 4.3 Validate the OpenSpec change in strict mode
