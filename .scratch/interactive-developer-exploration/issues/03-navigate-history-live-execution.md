# 03 — Navigate history while live execution continues

**What to build:** Let a developer inspect earlier committed snapshots while the real machine keeps
running, with an explicit distinction between the selected history cursor and the newest live head.

**Blocked by:** 02 — Derive semantic history from real machine activity

**Status:** resolved

- [x] The session exposes separate live-head and history-cursor positions.
- [x] Previous, next, and direct-position controls move only the history cursor and never call the
      machine's send operation.
- [x] Selecting a semantic step without its own commit displays the most recent committed snapshot
      associated with that activity.
- [x] New live commits append while a developer is inspecting history and do not move a deliberately
      historical cursor.
- [x] Session views explicitly report when the live head is ahead of the cursor.
- [x] A return-to-live control moves the cursor directly to the newest committed snapshot.
- [x] The embedded viewer's selected state and available projected details always correspond to the
      cursor rather than silently reverting to live state.
- [x] Previous, next, return-to-live, and live-ahead status remain usable from compact layouts.
- [x] Completed and defected machines retain their full accumulated history and selected snapshot
      until the session scope closes.
- [x] Dispatch controls become unavailable after completion or defect without removing historical
      inspection.
- [x] Acceptance tests prove that external Effects are not repeated and the live machine is not
      mutated while the cursor moves backward and forward.

## Answer

The session now keeps an independent cursor over committed positions and exposes Effect-native
previous, next, direct-position, semantic-step, and return-to-live controls. A cursor parked in
history stays there while new commits append; projected details always come from the selected
position. The embedded viewer exposes compact navigation and a live-ahead count. Acceptance coverage
proves navigation never changes the real machine or repeats its external behavior, and terminal
sessions retain their recorded model for the session scope.
