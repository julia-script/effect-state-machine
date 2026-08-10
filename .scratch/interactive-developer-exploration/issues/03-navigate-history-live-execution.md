# 03 — Navigate history while live execution continues

**What to build:** Let a developer inspect earlier committed snapshots while the real machine keeps
running, with an explicit distinction between the selected history cursor and the newest live head.

**Blocked by:** 02 — Derive semantic history from real machine activity

**Status:** ready-for-agent

- [ ] The session exposes separate live-head and history-cursor positions.
- [ ] Previous, next, and direct-position controls move only the history cursor and never call the
      machine's send operation.
- [ ] Selecting a semantic step without its own commit displays the most recent committed snapshot
      associated with that activity.
- [ ] New live commits append while a developer is inspecting history and do not move a deliberately
      historical cursor.
- [ ] Session views explicitly report when the live head is ahead of the cursor.
- [ ] A return-to-live control moves the cursor directly to the newest committed snapshot.
- [ ] The embedded viewer's selected state and available projected details always correspond to the
      cursor rather than silently reverting to live state.
- [ ] Previous, next, return-to-live, and live-ahead status remain usable from compact layouts.
- [ ] Completed and defected machines retain their full accumulated history and selected snapshot
      until the session scope closes.
- [ ] Dispatch controls become unavailable after completion or defect without removing historical
      inspection.
- [ ] Acceptance tests prove that external Effects are not repeated and the live machine is not
      mutated while the cursor moves backward and forward.

