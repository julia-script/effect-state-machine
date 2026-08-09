# 06 — Retry invoked Effects with native Schedules

**What to build:** Let authors apply Effect's native Schedule policies to invoked work while making retry intent graphable, runtime attempts inspectable, and application-significant attempts explicitly modelable.

**Blocked by:** 05 — Invoke typed Effects with scoped cancellation

**Status:** completed

- [x] An invoked operation can use an arbitrary native Effect Schedule supplied with a stable name and optional description.
- [x] Operational retry keeps the machine in its invoked state while the Schedule controls attempts and delays.
- [x] The static graph shows that a retry policy exists and displays its authored metadata without pretending to reconstruct arbitrary Schedule internals.
- [x] Inspection reports actual retry attempts and delays as runtime metadata.
- [x] Retry timing is deterministically testable with Effect's TestClock.
- [x] Exiting the state while waiting for another attempt interrupts both the Schedule delay and the invoked work.
- [x] Schedule exhaustion routes the operation's expected typed failure through its declared failure transition.
- [x] A documented modeled-retry path lets attempt count or retry outcomes influence explicit machine state and accepted events when the application cares about them.
- [x] Tests cover successful retry, exhaustion, cancellation during delay, inspection metadata, and an application-visible modeled retry.

## Implementation

- Invoked nodes accept a named native `Schedule`; the interpreter delegates retry semantics to
  `Effect.retry` and instruments decisions with `Schedule.tap`.
- Schedule errors join the invocation's typed failure channel and Schedule service requirements
  join the machine's inferred environment.
- Graph projection retains only the authored retry name and description. It never executes or
  reverse-engineers the Schedule.
- Retry delays live inside the invoked state's state-owned fiber, so ordinary state exit
  interruption cancels both an active attempt and a pending delay.
- `docs/retry-policies.md` documents when retries should instead be explicit machine state.
