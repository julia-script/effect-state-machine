# Shallow statecharts

Machine definitions are exhaustive records keyed by state tag. The key supplies the current-state
type, so constructors do not repeat it:

```ts
const definition = machine.define(
  { id: "editor", initial },
  {
    Typing: machine.state(events, { after }),
    Saving: machine.invoke(work, events),
    Closed: machine.final(),
  },
)
```

Reducers return the destination state's fields without `_tag`. The interpreter assigns the
declared `target` after the reducer runs and validates the resulting value with the state Schema.
This keeps the transition declaration authoritative even if a spread or excess return property
contains a conflicting `_tag`.

## Stay and self-target

Use `stay` to update the active value without leaving its current entry:

```ts
Edit: { stay: ({ event }) => ({ text: event.text }) }
```

A stay preserves entry-owned work and timers. A transition whose target is the current tag is
different: it exits and re-enters the node, interrupting work and restarting its timer. That makes
an explicit self-target useful for debounce:

```ts
Edit: { target: "Typing", reduce: ({ event }) => ({ text: event.text }) }
```

## Timers and declared work

A non-final node may own one `after` timer. The timer starts on entry, is cancelled on exit, and is
protected by the same stale-entry checks as work outcomes.

`invoke` runs one Effect. `invoke.all` joins a keyed product and can limit concurrency. Its first
typed failure interrupts unfinished siblings. `invoke.race` returns a correlated `winner` and
`value`; typed lane failures do not end the race while another lane can still succeed. Its failure
transition runs only after every lane has failed, using the final observed typed failure. Defects
remain defects and never enter a typed failure reducer.

## Regions

`regions` declares one compound slot or several parallel slots directly on their owning state:

```ts
Active: player.regions(
  {
    playback: {
      Playing: {
        Pause: { target: "Paused", reduce: ({ event }) => ({ position: event.position }) },
      },
      Paused: { Resume: { target: "Playing", reduce: () => ({}) } },
    },
    volume: {
      Audible: { Mute: { target: "Muted", reduce: () => ({}) } },
      Muted: { Unmute: { target: "Audible", reduce: () => ({}) } },
    },
  },
  { Stop: { target: "Stopped", reduce: () => ({}) } },
)
```

Region configuration is explicit state data. A transition entering `Active` must supply values for
`playback` and `volume`; there are no hidden initial child states. Tagged-union fields that are not
listed in `regions(...)` remain ordinary inert data. History is therefore modeled by copying a slot
value into a normal field on exit and restoring it in a later entry reducer.

Events are selected innermost first. A child transition, stay, or ignore suppresses the parent
handler for that event. Otherwise the parent handler is the fallback. When parallel siblings handle
one event, all selected reducers read the same pre-event parent snapshot and their slot updates are
committed atomically. Region targets stay within their own slot.

A region child can use `machine.region.invoke(...)`, own an `after` timer, or be final. When every
declared slot is final, the parent selects `onComplete` after committing the completing macrostep.
Without `onComplete`, the completed region configuration remains stable.

See the compile-checked player, editor, and importer definitions in
`packages/core/examples/Statecharts.ts` and the permanent inference contract in
`packages/core/tests/Statechart.types.ts`.
