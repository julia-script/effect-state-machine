# 06 — Retry invoked Effects with native Schedules

**What to build:** Let authors apply Effect's native Schedule policies to invoked work while making retry intent graphable, runtime attempts inspectable, and application-significant attempts explicitly modelable.

**Blocked by:** 05 — Invoke typed Effects with scoped cancellation

**Status:** ready-for-agent

- [ ] An invoked operation can use an arbitrary native Effect Schedule supplied with a stable name and optional description.
- [ ] Operational retry keeps the machine in its invoked state while the Schedule controls attempts and delays.
- [ ] The static graph shows that a retry policy exists and displays its authored metadata without pretending to reconstruct arbitrary Schedule internals.
- [ ] Inspection reports actual retry attempts and delays as runtime metadata.
- [ ] Retry timing is deterministically testable with Effect's TestClock.
- [ ] Exiting the state while waiting for another attempt interrupts both the Schedule delay and the invoked work.
- [ ] Schedule exhaustion routes the operation's expected typed failure through its declared failure transition.
- [ ] A documented modeled-retry path lets attempt count or retry outcomes influence explicit machine state and accepted events when the application cares about them.
- [ ] Tests cover successful retry, exhaustion, cancellation during delay, inspection metadata, and an application-visible modeled retry.
