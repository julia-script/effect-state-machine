# 04 — Dispatch quick events from devtools setup

**What to build:** Let an application provide compact named controls beside the machine it is
inspecting, including predefined events and factories that create a fresh event for every click.

**Blocked by:** 01 — Attach a live devtools session to a real machine

**Status:** resolved

- [x] Session setup accepts quick-event declarations with a stable identifier, label, optional
      description, optional group, and either a decoded event or synchronous event factory.
- [x] Quick events remain session configuration and do not appear in the machine definition,
      renderer-independent graph, encoded snapshots, or core package surface.
- [x] A predefined event dispatches through the real machine handle and the resulting transition is
      visible in the same live session.
- [x] A factory is evaluated exactly once for each dispatch request and can produce different
      payloads on consecutive clicks.
- [x] Factories are not evaluated while rendering controls, grouping them, inspecting history, or
      calculating graph topology.
- [x] A materialized event is checked with the machine's observational acceptance API immediately
      before send.
- [x] A currently unavailable quick event produces a visible devtools control failure and is not
      intentionally sent to the machine.
- [x] A factory exception is surfaced as a devtools control failure without being converted into a
      machine domain failure.
- [x] Predefined controls may show advisory availability, while factory controls remain available
      until materialized on click.
- [x] The embedded viewer groups quick events and presents labels and descriptions with compact,
      information-first spacing.
- [x] Acceptance tests cover fixed values, fresh randomized or generated values, exactly-once
      evaluation, unavailable events, factory exceptions, and genuine can/send races without hiding
      machine defects.

## Answer

Session setup now accepts grouped, named quick events backed by either a decoded value or a synchronous
factory. Only safe metadata enters the session view. Dispatch materializes once, calls `can`, and then
uses the real handle's `send`; unavailable controls and factory exceptions are typed devtools failures,
while a genuine post-check protocol race remains the machine's defect. The embedded viewer renders
compact grouped controls and visible failures, and acceptance tests cover values, fresh factories,
exceptions, unavailable states, and a real can/send race.
