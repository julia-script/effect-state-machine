## 1. Inventory the Contract

- [x] 1.1 Build a coverage matrix mapping every Store method and documented guarantee to the private and public conformance cases
- [x] 1.2 Identify missing cases for renew/release, terminal eligibility, duplicate observers, both commit forms, migration fencing, and tombstones
- [x] 1.3 Add a failing manifest assertion that names any documented contract topic without a public case

## 2. Publish One Conformance Corpus

- [x] 2.1 Split combined public cases into granular framework-neutral Effect cases with isolated Store factories
- [x] 2.2 Port every stronger private assertion and each identified gap into the public corpus
- [x] 2.3 Keep virtual-time operations in the case Effects so adapters can run them under `@effect/vitest` or another Effect-native harness
- [x] 2.4 Reduce `DurableStore.test.ts` to a thin registration wrapper over the public cases
- [x] 2.5 Delete the duplicate test-local conformance implementation after the coverage matrix reaches parity
- [x] 2.6 Document adapter registration, isolation expectations, and the requirement to run the entire corpus

## 3. Lock the Durable Type Contract

- [x] 3.1 Add `Durable.types.ts` and include it in the permanent package typecheck
- [x] 3.2 Assert exact handle state, event, completion, and `DurableError` inference
- [x] 3.3 Assert Scope, Store, machine Effect requirements, and state/event Schema encoding and decoding services
- [x] 3.4 Add negative input/event cases and migration, Store factory, and adapter signature assertions

## 4. Verify

- [x] 4.1 Run the public corpus against the in-memory adapter with all case names reported independently
- [x] 4.2 Run core typecheck, full tests, Biome, API extraction, package build, and packed-consumer checks
- [x] 4.3 Validate the OpenSpec change in strict mode
