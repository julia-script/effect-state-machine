## Context

See [proposal.md](./proposal.md) for motivation. The core package already centralizes schema normalization, definition construction, interpretation, inspection, and derived machine types in `Machine.ts`; `Graph.ts` consumes the same immutable definition metadata. The branch prototype proves the proposed TypeScript inference on TypeScript 7.0.2 but deliberately has no interpreter.

The existing runtime already has useful seams to preserve: one serialized inbox for external events and internal outcomes, generation checks for stale invocation results, scoped fibers for owned behavior, semantic inspection facts, and a single erasure boundary where per-tag types become a homogeneous runtime lookup. The implementation should extend those seams rather than create a second interpreter.

Definitions remain code-first immutable values and schemas remain the source of truth, consistent with ADRs 0001 and 0002. Effect v4 conventions in `docs/agents/effect-conventions.md` apply throughout.

## Goals / Non-Goals

**Goals:**

- Make the common authored path no deeper than the domain hierarchy it represents.
- Preserve exact contextual inference for state/event variants, transition targets, Effect channels, region context, and transitive requirements.
- Give the interpreter, graph builder, and inspection code one canonical definition representation.
- Make every concurrent activity owned by a concrete top-level or region-node entry and make stale outcomes harmless.
- Keep definitions fully inspectable without executing user code or providing services.

**Non-Goals:**

- Automatic initial/default values for region slots; entry reducers continue to supply them explicitly.
- History pseudo-states; history remains ordinary tagged state data copied by reducers.
- Recursive regions inside region children in the first version. A region child can handle events, invoke one Effect, own a timer, or be final.
- Recursive or user-extensible work combinators beyond single, `all`, and `race`.
- Multiple timers on one node, transient/always transitions, delayed-event queues, or throttling as a separate primitive.
- Redesigning child-machine invocation. Existing child behavior and public types remain supported while adapting mechanically to the keyed state definition.
- Deep-freezing definition objects at runtime. The public surface is readonly and the library never mutates a constructed definition.

## Decisions

### 1. Keep authored definitions as values and normalize at constructors

The public shape is:

```ts
const machine = Machine.builder({ input, state, event })

const definition = machine.define(
  { id: "editor", initial },
  {
    Typing: machine.state(events, { after }),
    Saving: machine.invoke(work, events),
    Closed: machine.final(),
  },
)
```

`define` stores the exhaustive keyed record as `definition.states`. Node constructors return canonical structural nodes:

- `state(...)` produces `{ on, after?, description?, source }`.
- `invoke(...)` produces `{ invoke, on?, after?, source }` where `invoke.kind` is `effect`, `all`, or `race`.
- `regions(...)` produces `{ regions, on?, onComplete?, source }`.
- `final()` produces `{ final: true, source }`.
- Existing child invocation remains a separate structural node kind.

Node kind is discriminated by shape rather than by an authored `kind` field. Work kind remains explicit because `effect`, `all`, and `race` share one node category but have different execution rules. The `regions(...)` constructor is the only nontrivial authoring normalizer: it wraps direct region event maps into canonical `{ on }` nodes and region records into canonical `{ states }` containers synchronously.

This preserves the code-first value model and compile-time object-shape conflicts. A callback declaration DSL was rejected because duplicate handlers and incompatible node modes would become order-dependent synchronous defects. A separate root regions table was rejected because it splits behavior owned by one state across two locations.

### 2. Bind the current tag through contextual return typing

The exhaustive state record provides a contextual expected type for each keyed value. Calling a node constructor in that position binds its fresh `Current` generic to the key. Each `invoke` call then has its own generic scope to infer Effect output, failure, requirements, retry error, and retry environment.

The important type helpers are distributive over the tagged unions:

- `ByTag<Union, Tag>` selects a variant.
- `FieldsOf<Variant>` removes `_tag` from reducer output.
- target-indexed transition unions correlate `target` with reducer result.
- mapped task records derive keyed `all` output, failure union, and requirement union.
- mapped race records derive a correlated `{ winner, value }` union.
- recursive definition helpers collect requirements from top-level work, child machines, retry schedules, and region work.

Transitions remain inline objects. A free-standing `to(target, reducer)` helper was rejected by the prototype because it loses the enclosing event key's contextual type and widens the reducer event to the whole union. Similarly, the design does not add fluent typestate ordering or tag-scoped sub-builders; both repeat state identity and weaken direct record exhaustiveness.

Compile fixtures are part of the contract. Accepted fixtures assert mutual type equality for input, state, event, completion, output, error, and requirements. Rejection fixtures use `@ts-expect-error` for missing states, invalid targets and fields, conflicting node modes, invalid region slots, cross-slot targets, bad lane keys/results, and incorrect reducer contexts.

### 3. Commit tags at the interpreter boundary

A target reducer returns destination fields only. The interpreter constructs the next value as `{ ...fields, _tag: declaredTarget }`, with `_tag` assigned last. This ordering is intentional: TypeScript cannot reject every excess `_tag` returned from a function, so runtime authority must remain with the declared transition.

The same rule applies to region slot transitions. A top-level transition constructs a complete destination state; a region transition constructs one destination slot and then merges it into the unchanged parent snapshot. Stay reducers are separate structural handlers and can only return fields for the current variant.

### 4. Model live configuration in schema-defined state fields

A regions node derives its eligible slot keys from tagged-union fields on the enclosing state variant. Each selected slot is exhaustive over that field's tags. No separate hidden runtime configuration is introduced: the current parent value is the source of truth for active region tags.

At runtime, a parent state with one declared slot is compound and one with multiple declared slots is parallel. Entering the parent uses exactly the slot values supplied by the top-level transition reducer. Because region defaults would be circular in a one-pass exhaustive record, defaults are deliberately deferred rather than inferred from declaration order.

Region reducers receive:

```ts
{ state: ActiveSlotVariant, event: NarrowedEvent, parent: Readonly<ParentVariant> }
```

Work reducers replace `event` with `value` or `error`. The parent is a snapshot for reading shared and sibling fields; a region reducer cannot return parent or sibling updates. This makes parallel reduction composable and prevents write conflicts.

### 5. Process each external event as an atomic macrostep

The existing serialized inbox becomes the sole arbiter for external events, work outcomes, timer wake-ups, child outcomes, and region completion. Processing an external event uses one pre-event snapshot:

1. Look up every active region child and select its handler, including guard evaluation.
2. If any child declares a transition, stay, or ignore response, suppress the parent handler. Otherwise select the parent handler.
3. Evaluate all selected region reducers against the same parent snapshot.
4. Determine which node-entry scopes exit. An explicit self-target exits; a stay or ignore does not.
5. Interrupt exiting scopes, construct auto-tagged results, atomically commit the one next parent state, and then start entering scopes.
6. After the commit, test whether every declared slot is final and enqueue/select `onComplete` once for that completed configuration.

If two parallel slots handle the event, both results are merged into the one commit. An ignore in one child establishes inner ownership and suppresses the parent while still allowing a sibling child response in the same macrostep. Parent transitions exit every active region child.

This extends the existing `selectHandler` logic with a selection phase separate from reduction and commit. That separation is required to prevent the first sibling reducer from affecting the second sibling's inputs.

### 6. Give every entry a unique lifecycle token and scope

Replace the single coarse invocation generation with an entry identity for every active behavior owner:

```text
top-level entry: machine generation
region entry:    machine generation + slot + slot generation
```

Each entry owns a closeable scope (or equivalently a keyed fiber set) containing its Effect, retry schedule, and timer. Internal inbox envelopes carry the owner's identity. The processor compares it with the currently active identity before selecting any outcome; mismatch means the envelope is stale and is discarded after emitting an appropriate inspection fact if useful.

Exit order is inner before outer. Entry order is outer before inner, with region slots started in stable declaration order for reproducible inspection. State commits do not rely on fiber completion order.

This generalizes the current generation guard and scoped-fiber behavior and covers Effects that ignore interruption briefly or race with an external event.

### 7. Interpret work as a closed, inspectable algebra

The runtime switches on the declared work kind:

- `effect`: evaluate the one state-to-Effect function and apply the optional named retry schedule.
- `all`: normalize direct function lanes and metadata-bearing lanes, run them under the declared concurrency, collect outputs by key, and interrupt siblings on typed failure.
- `race`: run every lane concurrently, retain typed failures while another lane can succeed, publish the first successful `{ winner, value }`, interrupt unfinished lanes, and fail with the final observed typed failure only when all lanes fail.

All functions are evaluated only after entry and with that entry's state snapshot. Requirements are captured from the machine environment once and provided to owned Effects without erasing the public requirement union. Defects are not converted into typed failures; they retain the machine's existing defect path.

Region invocation uses the same single-Effect interpreter with an owner path and `(slotState, parentState)` input. `all` and `race` for region nodes remain out of scope until there is concrete usage evidence.

### 8. Represent timers as internal entry-owned outcomes

An `after` declaration starts one sleep fiber on entry. Its envelope carries the entry identity and the declared transition. A stay leaves the fiber untouched; self-target or exit closes its owner scope and entry creates a new full-duration timer. Timer transitions read the current active state when the envelope is processed, not the stale entry snapshot, so stays made during the wait are visible to the reducer.

The first version permits one `after` transition on atomic states, invoked-work states, and non-final region children. Region-bearing parent nodes do not own an `after` transition; parent-wide timeout behavior can be represented by a parent event or a dedicated region until evidence justifies combining parent completion and timer arbitration.

### 9. Extend canonical paths through graph and inspection models

Definition, graph, and inspection identities use a structural node path:

```text
top-level: <state>
region:    <state>/<slot>/<region-state>
lane:      <state>[/<slot>/<region-state>]/<work>/<lane>
```

Graph extraction traverses `definition.states` and nested canonical region states, rendering region boundaries, parallel slots, timers, work lanes, retry policies, outcome edges, and completion edges. Inspection facts retain the owning path, entry identity, work/lane name, and macrostep relationship so tooling can group parallel transitions under one commit.

Constructors capture their call site with the existing source utility. Guard constructors retain their precise source. Direct region event properties have no call boundary, so structural source resolution should attempt the property location when available and otherwise fall back to the enclosing `regions(...)` source. Source precision is best-effort metadata and never affects execution.

### 10. Keep validation at both type and runtime boundaries

The exhaustive keyed record removes duplicate and missing top-level tags by construction, but JavaScript and widened TypeScript callers still require synchronous validation. Definition construction validates nonblank stable names, valid targets, guard fallback position, compatible node shapes, exhaustive region maps, valid lane records, positive concurrency, and final-node restrictions without running application callbacks.

The interpreter still validates the initial value against the state schema and definition, verifies every committed auto-tagged result against the state schema at the existing boundary, and treats impossible canonical shapes as definition defects. Validation logic should be extracted from the current large builder into focused internal helpers so the public builder stays a deep module rather than accumulating branch-specific checks.

## Risks / Trade-offs

- [TypeScript contextual inference regresses across compiler versions] → Keep accepted and rejected fixtures in normal CI, assert exact types rather than assignability alone, and preserve fresh generic call sites in node constructors.
- [The return-position `_tag` hole permits misleading reducer code] → Always assign the declared tag last at commit and include a runtime regression test with a conflicting reducer tag.
- [Parallel reducers perform side effects despite being modeled as pure] → Document reducers and guards as synchronous pure functions; keep all asynchronous/resourceful behavior in declared Effects. A thrown reducer remains a defect.
- [A monolithic interpreter becomes harder to reason about] → Extract selection, macrostep planning, entry ownership, and work interpretation into private concept-oriented modules while keeping one public `Machine` subpath.
- [Race all-failure semantics surprise users] → Specify first-success behavior and the final observed failure explicitly, and emit lane-level inspection facts.
- [Readonly values can still be mutated from JavaScript] → Do not mutate definitions internally, expose readonly types, and test that graph/interpreter consumers are read-only; defer deep freezing unless mutation becomes an observed problem.
- [Graph and Studio consumers assume flat top-level node IDs] → Introduce structural paths in core graph metadata first, update renderers and serializers together, and retain top-level tags as the display label.
- [Child-machine behavior regresses during the definition-record migration] → Keep child runtime tests and requirement inference fixtures green before adding region execution.

## Migration Plan

1. Promote the compile-checked authoring types and shallow constructor normalizer from `packages/core/prototypes/statechart-regions` into the core definition model, while retaining existing child-machine support.
2. Migrate current core tests and examples from tag-repeating node arrays to the exhaustive keyed definition record; keep a temporary private adapter only if it materially reduces interpreter risk.
3. Update graph extraction and definition metadata consumers to traverse the canonical keyed tree and structural paths.
4. Refactor the interpreter into selection, macrostep commit, and entry-ownership seams while preserving existing atomic, invoke, child, inspection, and protocol tests.
5. Add timers and single/all/race work execution, then compound/parallel regions and completion, using deterministic clock and interruption tests.
6. Remove the throwaway prototype after its accepted/rejected fixtures have equivalent permanent coverage and package-consumer verification passes.

Because the new syntax is only present on the experimental branch, rollback is reverting the change before release. No persisted machine data or external migration is required.
