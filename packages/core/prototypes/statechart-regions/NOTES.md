# Statechart-syntax prototype: findings

Throwaway prototype (no interpreter) for the syntax direction discussed around
regions, auto-tagging, and declared work combinators. `machine.ts` is the
authoring surface, `example.ts` is compile-checked authoring evidence,
`type-errors.ts` is compile-checked rejection evidence.

## What the prototype encodes

1. **`states` record instead of `nodes` array.** Keyed by state tag;
   exhaustive (a missing state is a compile error), duplicates are impossible,
   and node kind is discriminated by shape — `on` / `invoke` / `regions` /
   `final: true` — with `?: never` fields enforcing mutual exclusion.
2. **Auto-tagging.** `reduce` returns the target state's fields; `target`
   supplies the `_tag`. This deletes the `_tag:` line from every reducer in
   the examples.
3. **Region slots.** A state declares tagged-union fields as live regions
   under `regions:`. One slot = compound state, several = parallel state, an
   undeclared union field = inert data (the history pattern). Region reducers
   receive `parent` (the whole parent value) read-only.
4. **Work combinators.** `invoke: ($) => $({...})` for one effect (with the
   v0 retry policy), `$.all({ concurrency, tasks })` joining a product keyed
   by task name, `$.race({ tasks })` joining a sum plus a `winner` lane name.
   Task names are declared data, so the graph can render lanes.
5. **`after`.** A declared timer transition on a node; re-entry (explicit
   self-target) restarts it. Debounce is a self-target + `after`; the stay
   shorthand (bare function handler) updates fields *without* re-entry and
   therefore without restarting owned work.

## Type-level findings (the reason to prototype)

- **The toolkit-callback trick works.** `invoke: ($) => $({...})` opens a
  fresh generic call site inside the states record, so Output/Failure/
  Requirements infer per node with no state-tag repetition, at top level and
  inside regions. `MachineRequirements` correctly collects `MediaSource` from
  a region invoke and `Documents` / `Listings` from node invokes.
- **The declared callback return type must be unparameterized**
  (`InvokeSpecBase`, not `InvokeSpec<unknown>`). With `InvokeSpec<unknown>` in
  the config type, the contextual return type feeds `unknown` backwards into
  the toolkit call's inference and machine requirements collapse to `unknown`.
  This bit the region path first but is a hazard for any nesting depth.
- **`all`/`race` sibling inference works.** `tasks` infers first; `onSuccess`
  then sees `value` keyed by task name (product) or unioned (sum + `winner`).
  A wrong task key in the reduce is a compile error.
- **Return-position excess-property checking does not fire** (TS 7.0.2), so a
  reducer may return a stray — even wrong — `_tag`. It must stay legal
  (`{ ...state }` spreads carry `_tag`), so the contract is: the interpreter
  always writes the committed tag from `target`; a returned `_tag` is dead
  data. Recorded in `type-errors.ts` as a documented allowance.
- **Exhaustiveness, missing targets, cross-layer reducer mixups** (region
  reduce returning parent fields, region transition targeting a machine
  state, final states with handlers, regions on non-union fields) all reject
  cleanly — see `type-errors.ts`.

## Open questions this prototype does NOT settle

- **Region `initial` / slot auto-fill.** Reducers targeting a region-bearing
  state supply every slot explicitly here. Letting them omit slots that
  declare an `initial` requires the transition's type to know the *target*
  node's region config, which is circular inside a single `make` literal.
  Candidate escapes: declare region defaults on the builder (before `make`),
  a two-phase `make`, or keep slots explicit (current choice; it is also the
  most honest about what entering a configuration means).
- **Restart semantics are invisible to types.** Stay-shorthand (keep owned
  work) vs explicit self-target (re-enter, restart work) is an interpreter
  contract the syntax can only document, not enforce.
- **Innermost-first selection** (region handler beats node-level handler for
  the same event) is runtime semantics; nothing here proves it.
- **Macrostep semantics for parallel regions** — one event offered to every
  region and the node level, all selected reducers applied to the pre-event
  value, one committed snapshot — needs the interpreter prototype next.
- **`onComplete` reachability** (every region must be able to reach a
  `final: true`) should be a `make()` validation like v0's missing-target
  checks; not expressible in the types.
- **Region invokes are single-effect** here; whether `all`/`race` are wanted
  inside regions is deferred until an example demands it.
- **Guarded transitions inside regions** are omitted; nothing suggests they
  are harder than top-level ones, but it is unproven.
