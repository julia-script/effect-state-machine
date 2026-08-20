## ADDED Requirements

### Requirement: Durable interruption remains outside authored work outcomes

Under durable execution, interruption caused by scope closure, owner exit, lease loss, or cancellation SHALL NOT be encoded as an authored success, allowed failure, or durable activity defect. Until a terminal activity outcome is atomically committed, interrupted work MAY run again with the same execution key and a later delivery attempt.

#### Scenario: Lease renewal loses ownership

- **WHEN** an activity loses its lease while its authored Effect is still running
- **THEN** the local Effect is interrupted, no outcome is committed by that worker, and a later owner can run the activity with the same execution key

#### Scenario: Interruption races with a typed failure

- **WHEN** concurrent work produces a Cause containing both interruption and a typed failure
- **THEN** the interruption prevents the Cause from being reduced as the authored allowed failure
