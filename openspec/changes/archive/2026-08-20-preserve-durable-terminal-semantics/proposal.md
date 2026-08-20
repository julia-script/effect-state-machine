## Why

Durable activity workers currently recover every `Cause` into an outcome, so interruption and compound causes can be acknowledged as authored failures or persisted defects instead of leaving the activity eligible for redelivery. A defected checkpoint also retains active execution keys, allowing later activity outcomes to be processed against an instance that should be terminal.

## What Changes

- Classify activity exits without collapsing Effect cause structure: only a pure typed failure enters the declared failure Schema; defects become durable defect outcomes; interruption propagates and leaves the claim uncommitted.
- Encode activity outcomes without catch-all recovery that can swallow interruption.
- Make completion and defect commits terminal by atomically cancelling every timer and activity owned by the exited entry and clearing resumable owned-work metadata.
- Prevent stores and runners from claiming or applying new work to completed or defected instances, while retaining stale-entry checks as a second line of defense.
- Add deterministic crash, lease-loss, scope-interruption, compound-cause, and late-outcome tests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `durable-machine-execution`: Define cancellation-preserving activity exit classification and terminal checkpoint isolation.
- `statechart-declared-work`: Clarify that durable interruption is not an authored failure or durable defect outcome and remains eligible for at-least-once redelivery.

## Impact

This changes `packages/core/src/DurableRunner.ts`, the Store contract and in-memory adapter where terminal eligibility must be enforced, the durable conformance corpus, and durable activity/lifecycle tests. The public happy-path API remains source-compatible; adapters may need to strengthen claim eligibility and terminal cancellation behavior.
