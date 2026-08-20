## 1. Characterize Activity Causes

- [x] 1.1 Add deterministic tests for pure typed failure, pure defect, pure interruption, Fail-plus-Die, and Fail-plus-Interrupt activity exits
- [x] 1.2 Add lease-loss and Scope-close tests proving interrupted activity commands remain unacknowledged and retain their execution key on redelivery
- [x] 1.3 Implement a private structural Cause classifier and route only pure typed failures through the declared error Schema
- [x] 1.4 Replace catch-all outcome-encoding recovery with typed encoding-error handling that preserves interruption

## 2. Enforce Terminal Isolation

- [x] 2.1 Add regression tests in which another lane or region activity finishes after a completed or defected checkpoint
- [x] 2.2 Make terminal checkpoint construction clear timers and aggregate progress while preserving the final or defect state and summary
- [x] 2.3 Compute and atomically cancel all old execution keys and timer message IDs in both completion and defect commits
- [x] 2.4 Reject processing of any delivery whose authoritative checkpoint is already completed or defected

## 3. Strengthen the Store Contract

- [x] 3.1 Add public conformance cases proving terminal instances yield no machine or activity claims
- [x] 3.2 Update the in-memory Store to gate claims and late commits on running lifecycle status without weakening lease fencing
- [x] 3.3 Document terminal eligibility and at-least-once interruption behavior for Store and activity adapter authors

## 4. Verify

- [x] 4.1 Run core typecheck and all durable runner, resume, aggregate, region, timer, and Store tests
- [x] 4.2 Run Biome, API extraction, package build, and packed-consumer verification
- [x] 4.3 Validate the OpenSpec change in strict mode
