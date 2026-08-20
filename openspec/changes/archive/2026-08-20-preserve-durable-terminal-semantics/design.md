## Context

See `proposal.md` for motivation and the delta specs for required behavior. Activity execution is raced against a lease-renewal fiber. The current worker uses catch-all Cause matching to manufacture an `ActivityOutcome`, while terminal defect commits cancel timer messages but not execution keys or aggregate progress. Machine and activity claim methods can consequently keep serving work for a terminal checkpoint.

## Goals / Non-Goals

**Goals:**

- Preserve Effect interruption and compound Cause semantics through the worker boundary.
- Make a terminal checkpoint an atomic lifecycle boundary for every kind of owned work.
- Keep at-least-once redelivery and stable execution keys intact.
- Give Store adapters testable terminal-eligibility rules.

**Non-Goals:**

- Make arbitrary authored Effects or their side effects exactly once.
- Persist the full live Cause or reconstruct it after restart.
- Add durable child machines or instance deletion.

## Decisions

### Classify Causes by structure before encoding values

The activity worker will use a small private classifier with three results: `Interrupted`, `TypedFailure`, and `Defect`. Any interrupt bit wins and is re-failed as the original Cause. A Cause qualifies as `TypedFailure` only when it contains failures and contains neither defects nor interruption. Every other terminal Cause is a defect and retains the live Cause for the current runner while persisting only the sanitized summary.

This is stricter than taking the first failure with `Cause.findErrorOption`, because parallel Effect causes can contain a failure and a die simultaneously. It also avoids a catch-all around Schema encoding: only `DurableEncodingError` is converted to the library-owned encoding defect path, while interruption continues to propagate.

Alternative considered: prioritize typed failure whenever one exists. Rejected because it hides concurrent defects and treats a compound Cause as a declared domain outcome.

### Terminal commits cancel the complete owned-work set

Completion and defect paths will compute execution keys from the authoritative pre-terminal checkpoint and decoded active state, just as an ordinary exit does. The atomic Store commit will cancel all pending timer message IDs and activity execution keys, clear timers and aggregates from the terminal checkpoint, and acknowledge the causal delivery in the same operation.

The runner will also refuse to process a delivery whose supplied checkpoint is already terminal. This is defense in depth for adapters and for a delivery claimed immediately before the terminal commit.

Alternative considered: rely only on stale entry IDs. Rejected because the defect checkpoint currently preserves the entry ID, and terminality is a stronger invariant than staleness.

### Claim eligibility belongs to the Store contract

Both machine and activity claim operations will return no work for completed or defected checkpoints. Commit validation remains authoritative and rejects a claim that lost ownership or whose instance became terminal. The in-memory adapter will implement this directly; the public conformance corpus will make it mandatory for external adapters.

Alternative considered: stop only the local runner loops. Rejected because another runner or external activity worker can poll the same Store.

## Risks / Trade-offs

- **[Cause classification differs across Effect versions]** → Implement against public Cause predicates and test pure and compound cause trees rather than relying on rendering.
- **[Adapter implementations previously served terminal work]** → Add explicit conformance cases and document the strengthened Store obligation.
- **[Already-running external side effects cannot be recalled]** → Fence outcome completion and continue requiring user effects to apply the stable execution key externally.

## Migration Plan

1. Add failing Cause-classification and terminal-revival tests.
2. Strengthen the Store conformance contract and memory adapter eligibility.
3. Update activity exit classification and outcome encoding.
4. Update terminal commit planning and clear terminal metadata.
5. Run durable recovery, lease, timer, aggregate, region, and package tests.

Rollback can restore the prior code because no checkpoint format change is required; adapters deployed with the stronger eligibility rule remain compatible.
