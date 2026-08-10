# Roadmap — effect-state-machine

> Direction, not commitment — Now is committed; Next is planned; Later is exploration.
> Only Now items may be promised to anyone. This document changes as we learn.
> Last reviewed: 2026-08-10 · Review cadence: after each milestone
> Scope: whole project

## Vision

Build a small state-machine library with Effect for Effect users who want application behavior to
remain understandable as agentic coding increases. Authored TypeScript stays canonical; the same
definition provides a trustworthy read-only graph and semantic runtime inspection. The project is
not an XState clone, visual programming environment, framework integration layer, or second
workflow engine.

**Current objective:** use the completed core and devtools milestone in one external Effect
application and learn where the public API creates real friction.

## Column rules

- **Now** — problem validated, solution shaped, actively worked or next up. Committed.
- **Next** — problem chosen and understood; solution still in discovery. Planned, not promised.
- **Later** — problem worth solving, no solution chosen. Options, not a queue.

## Completed

### Milestone 2 — Interactive developer exploration

- **Problem:** The local-first workbench demonstrates the intended experience, but it is coupled to
  one reference workflow. Full Mermaid diagrams already become noisy and expensive at Todo scale,
  so the project's central promise is not yet proven for arbitrary or larger definitions.
- **Outcome & done-when:** A development-only viewer can consume any machine's definition metadata
  and one running root-machine session without machine-specific rendering code. Session setup
  accepts named quick events as decoded values or factories evaluated for each dispatch. It records
  committed snapshots and semantic inspection events, maintains a live head independently from a
  movable history cursor, and never mutates the live machine or repeats Effects when historical
  snapshots are selected. The graph follows the cursor and offers one-step, two-step, and full-map
  projections with active-state and traversed-edge emphasis; child-machine and actor topology are
  deferred. Causally related runtime events collapse into developer-sized steps by default, while
  the raw event stream remains available on demand. Machine elements carry automatically captured,
  best-effort source locations so configurable editor-link resolvers can jump to the relevant
  declaration or decision function without author-maintained paths or line numbers. The same
  renderer-neutral session model supports an in-page browser dock and a standalone host, while
  cross-context browser or Node transport remains later adapter work. A second substantial machine
  and a large synthetic fixture prove the experience without rendering the entire graph at once.
  Core imports remain free of session, UI, layout, and renderer code.
- **Status:** complete — the generic session, semantic/raw history, quick events, cursor navigation,
  focused graph, automatic source navigation, optional viewer, checkout proof, and 100-state fixture
  ship behind isolated package entry points.
- **Appetite:** worth ~1–2 focused weeks. New runtime semantics enter only if the proof machine
  cannot express honest behavior without them.
- **Links:** [`src/Graph.ts`](../src/Graph.ts) · [`src/Machine.ts`](../src/Machine.ts) ·
  [`examples/local-first-document-page.ts`](../examples/local-first-document-page.ts) ·
  [`docs/capability-matrix.md`](../docs/capability-matrix.md)

## Now

### First use outside the reference repository

- **Problem:** Compile-time fixtures and a packed consumer prove mechanics, but not whether the API
  stays pleasant while evolving a real Effect application.
- **Hypothesis:** using a prerelease in one separate application will expose vocabulary and
  composition friction earlier than adding speculative features here.
- **Confidence:** high
- **Assumes:** an appropriate Effect application or bounded workflow is available — unvalidated.
- **Open questions:** package name, prerelease channel, and what feedback constitutes API stability.

## Next

### Semantic gaps revealed by real applications

- **Problem:** Timers, hierarchy, parallel regions, dynamic children, and other state-machine
  features may eventually be necessary, but parity is not evidence.
- **Hypothesis:** requiring a failing focused fixture or real application scenario before adding a
  semantic primitive will keep the interpreter small without making it artificially limited.
- **Confidence:** high in the admission rule; low in which feature will be first.
- **Assumes:** the current invocation, retry, guard, and static-child model covers the next proof —
  unvalidated.
- **Open questions:** which behavior becomes dishonest or excessively indirect with today's model?

### Snapshot persistence boundaries

- **Problem:** Schema-defined state is encodable, but persistence, migration, replay, and interrupted
  work recovery have intentionally undefined semantics.
- **Hypothesis:** experience persisting ordinary snapshots in an application will identify the
  smallest honest boundary before durable execution is considered.
- **Confidence:** medium
- **Assumes:** users need persistence rather than only encoding — unvalidated.
- **Open questions:** version identity, migration ownership, active invocation recovery, and whether
  Effect Workflow should remain entirely separate.

## Later

- Make complex topology easier to navigate — why it matters: partial graphs must remain useful as
  machines and child graphs grow.
- Correlate semantic history with Effect telemetry — why it matters: an optional development
  adapter could enrich each causal step with its OpenTelemetry spans, span annotations, and logs,
  letting developers connect modeled behavior to the work actually performed without making the
  state-machine core own telemetry or import an OpenTelemetry implementation.
- Support additional composition semantics when evidence demands them — why it matters: some
  applications genuinely require shared hierarchy, atomic parallel regions, or dynamic identity.
- Establish durable snapshot evolution — why it matters: long-lived applications must safely read
  state written by older definitions.

## Maintenance budget

Reserve roughly 20% of each milestone for compatibility and interpreter legibility.

- Track Effect 4 beta changes — the public Schema, Schedule, Scope, and Stream contracts are pinned
  to a beta and can change underneath the library.
- Keep the interpreter explainable — split or deepen internal modules when `Machine.ts` growth makes
  lifecycle and queue semantics harder to audit, without fragmenting the public API.
- Keep capability evidence synchronized — every public semantic promise needs a focused executable
  fixture or reference-application scenario.

## Not doing

- XState parity — features enter through application evidence, not comparison checklists.
- Editable or graph-first definitions — code remains the canonical source of truth.
- Application framework bindings — consumers already choose how Effects enter their framework.
- Core-owned runtimes or Promise APIs — runtime ownership remains at the application boundary.
- Persistence or durable resume in Milestone 2 — it would mix a separate semantic problem into the
  developer-orientation proof.
- Named paths, scenario scripting, history replay, and timeline branching in Milestone 2 — the
  prototype did not prove named paths useful, and selecting history is inspection rather than undo.
- Failure, latency, dependency, or network simulation controls in Milestone 2 — they are promising
  future environment controls, not part of the first session contract.
- Child-machine expansion, actor topology, hierarchy, parallel regions, or dynamic spawning in
  Milestone 2 — composition visualization receives its own later proof.
- Effect OpenTelemetry span, annotation, or log correlation in Milestone 2 — telemetry enrichment
  remains an optional future adapter.
- Cross-context browser transport, Node transport, persistence, or remote devtools connections in
  Milestone 2 — the direct in-page adapter proves the session boundary first.

## Open questions

- What machine size and topology should define the first meaningful graph-performance fixture?
- Who authors causal correlation IDs, and which grouping rules remain honest across invocations,
  retries, children, and independently arriving external events?
- Which layout engine can produce stable, readable partial graphs without binding the viewer model
  to a renderer?
- Should the first prerelease follow Milestone 2, or should an intentionally minimal core prerelease
  happen earlier to obtain external feedback?
- What permanent package and project name should replace the working name?

## Changelog

- 2026-08-10: Completed Milestone 2 with an Effect-native one-root devtools session, generic compact
  viewer, semantic/raw history, observational cursor, quick-event factories, focused graphs,
  declaration-level source links, checkout proof, 100-state stress fixture, and isolated package
  surfaces. Moved first external use into Now.

- 2026-08-09: Created after completing Milestone 1. The first milestone shipped the Schema-first
  interpreter, Effect invocation and retry, static children, inspection, renderer-independent graph,
  Mermaid renderer, isolated package surfaces, and the local-first reference workbench. Milestone 2
  prioritizes reusable developer orientation over speculative runtime semantics.
- 2026-08-09: Refined Milestone 2 around interactive scenario exploration: typed quick dispatchers,
  reproducible event sequences, history navigation, and honest replay through fresh sandbox sessions
  rather than reversal of live external effects.
- 2026-08-09: Added two devtools hosts to the exploration target: an in-page browser dock that moves
  beside the real application and a standalone viewer that can later connect through browser or Node
  adapters while sharing the same viewer/session model.
- 2026-08-09: Added causal-step grouping, raw-event inspection, source navigation, and compact graph
  density to the viewer proof. Kept source capture and production graph layout as explicit design
  questions rather than silently coupling them to the prototype renderer.
- 2026-08-10: Recorded Effect telemetry correlation as a later devtools exploration: semantic steps
  may eventually show associated spans, annotations, and logs through an optional adapter while
  keeping telemetry out of the core contract.
- 2026-08-10: Re-shaped Milestone 2 from scenario playback into one-root-machine developer
  inspection. Quick-event values and factories remain; named paths and replay are removed. A live
  head and non-mutating history cursor drive focused graph projections, while child topology,
  environment simulation, telemetry enrichment, and cross-context transports move to later work.
