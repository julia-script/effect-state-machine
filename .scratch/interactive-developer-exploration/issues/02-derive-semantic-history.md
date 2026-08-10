# 02 — Derive semantic history from real machine activity

**What to build:** Turn a live session's ordered snapshots and inspection records into compact,
developer-sized semantic history while preserving the complete raw evidence beneath every summary.

**Blocked by:** 01 — Attach a live devtools session to a real machine

**Status:** ready-for-agent

- [ ] The session retains ordered raw inspection metadata from the moment it attaches.
- [ ] Every committed state change is paired by commit order with the correct decoded snapshot even
      when state and inspection Streams deliver at different moments.
- [ ] Machine start, external event receipt, invocation lifecycle, retry scheduling, completion, and
      defect activity produce deterministic semantic steps.
- [ ] Branch selection, ignored-event records, state changes, and synchronous owned-behavior records
      attach to the appropriate initiating step when causation is supported by inspection metadata.
- [ ] Invocation name and generation correlate continuing invocation activity without using
      wall-clock timing.
- [ ] Ambiguous records remain visible in raw history and are not assigned a fabricated cause.
- [ ] Semantic activity that does not commit state references the most recent committed snapshot
      rather than inventing a new machine state.
- [ ] The embedded viewer shows compact semantic steps by default and can reveal ordered raw records
      on demand.
- [ ] Full event payloads remain excluded, and selected-state details continue to honor the explicit
      state projection configured by the application.
- [ ] Public-seam acceptance tests cover external transitions, invoked success, typed failure,
      operational retry, cancellation, completion, and defect using real machines and deterministic
      Effect test services.

