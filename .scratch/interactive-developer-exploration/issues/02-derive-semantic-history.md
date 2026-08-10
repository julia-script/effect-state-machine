# 02 — Derive semantic history from real machine activity

**What to build:** Turn a live session's ordered snapshots and inspection records into compact,
developer-sized semantic history while preserving the complete raw evidence beneath every summary.

**Blocked by:** 01 — Attach a live devtools session to a real machine

**Status:** resolved

- [x] The session retains ordered raw inspection metadata from the moment it attaches.
- [x] Every committed state change is paired by commit order with the correct decoded snapshot even
      when state and inspection Streams deliver at different moments.
- [x] Machine start, external event receipt, invocation lifecycle, retry scheduling, completion, and
      defect activity produce deterministic semantic steps.
- [x] Branch selection, ignored-event records, state changes, and synchronous owned-behavior records
      attach to the appropriate initiating step when causation is supported by inspection metadata.
- [x] Invocation name and generation correlate continuing invocation activity without using
      wall-clock timing.
- [x] Ambiguous records remain visible in raw history and are not assigned a fabricated cause.
- [x] Semantic activity that does not commit state references the most recent committed snapshot
      rather than inventing a new machine state.
- [x] The embedded viewer shows compact semantic steps by default and can reveal ordered raw records
      on demand.
- [x] Full event payloads remain excluded, and selected-state details continue to honor the explicit
      state projection configured by the application.
- [x] Public-seam acceptance tests cover external transitions, invoked success, typed failure,
      operational retry, cancellation, completion, and defect using real machines and deterministic
      Effect test services.

## Answer

The session now reduces ordered inspection metadata into compact semantic steps while retaining every
raw record. Snapshot and `StateChanged` delivery are buffered independently and paired in commit order;
invocations use authored name plus generation and children use instance identity. Unsupported or
ambiguous activity is preserved as standalone raw-backed semantic activity instead of receiving a
guessed cause. The embedded viewer shows recent semantic steps and an expandable raw record list, and
public-handle tests cover transitions, completion, and defects alongside the repository's existing
invocation, retry, cancellation, child, and typed-failure acceptance fixtures.
