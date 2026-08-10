# Milestone 2 — Interactive developer exploration

**Status:** ready-for-agent

## Problem Statement

Effect developers can already define and run understandable machines, project their definitions into
a read-only graph, and observe semantic inspection events. The current development experiences do
not yet combine those capabilities into a reusable way to investigate a real running application.
The local-first workbench is coupled to one workflow, Mermaid becomes noisy as topology grows, and
the scenario-viewer prototype uses a facsimile rather than the published machine runtime.

A developer therefore still has to correlate the active machine state, raw inspection events,
historical snapshots, graph topology, and source code manually. This is especially costly when
agentic coding produces behavior faster than the developer can build a mental model of it. Events
with nontrivial payloads are also inconvenient to trigger when the machine is headless or exposed
through an API rather than an application UI.

The prototype proved that a compact graph following a live machine, semantic history, quick event
dispatch, historical inspection, focused topology, and source navigation materially improve
codebase literacy. The remaining problem is to turn those findings into a generic, Effect-native
session contract and a real development viewer without coupling the core to UI, transport, layout,
or renderer dependencies.

## Solution

Introduce a development-only devtools session centered on one running root machine. Session setup
receives the machine definition, its Effect-native machine handle, optional quick events, and an
optional projection for state details. It observes the existing state-change and inspection streams,
records ordered committed snapshots and semantic activity, and derives a renderer-neutral view for
any host.

The session maintains two positions. The live head always points to the newest committed snapshot.
The history cursor points to the snapshot currently being inspected. Moving the cursor changes the
graph and state details shown by devtools but never mutates the running machine, replays events, or
repeats external Effects. New live activity continues to append while the developer inspects the
past, and an explicit return-to-live operation moves the cursor back to the live head.

Quick events are declared beside the machine when devtools is set up, not in the canonical machine
definition. A quick event may contain a decoded event value or a synchronous factory evaluated once
for each dispatch, allowing fresh or randomized payloads. The session checks whether a materialized
event is currently accepted before dispatching it and reports an unavailable control without
intentionally sending a protocol-defecting event.

The graph follows the history cursor. Its default focused projection contains the selected active
state and its immediate outgoing targets. Developers may expand to two outgoing steps or the full
root graph. Projection is renderer-independent; selection, layout, zooming, panning, edge routing,
and animation remain viewer concerns. Existing child-invocation nodes remain atomic root-graph
nodes. Expanding child definitions or displaying actor topology is a later milestone.

Machine construction automatically captures best-effort source references for authored elements.
Devtools resolves trustworthy references into file, line, and column locations when possible and
uses configurable editor-link resolvers. Authors never maintain paths or line numbers. A node or
decision links to its declaration or owning decision block; exact statement mapping is not required.
When stacks or source maps cannot produce a trustworthy location, the link is omitted.

A generic development viewer consumes only the public session contract. The same view model can be
hosted as an in-page dock or inside a standalone shell. The milestone proves the direct in-page
adapter; cross-context browser and Node transports are deliberately deferred. The viewer is compact
and information-first, supports graph-only use without losing history navigation, and retains raw
inspection events beneath semantic causal steps.

## User Stories

1. As an Effect developer, I want to attach devtools to a real running machine, so that the tool
   explains the behavior my application is actually executing.
2. As an Effect developer, I want devtools setup to accept the definition and machine handle in one
   place, so that observation does not require a global machine registry.
3. As an application developer, I want one devtools session to represent one root machine, so that
   its history and controls have an unambiguous execution boundary.
4. As a developer using a hidden dock, I want the session to begin recording when application setup
   creates it, so that opening the viewer later does not miss activity that occurred while hidden.
5. As an Effect developer, I want creating and consuming a session to remain Effect-native, so that
   the library does not introduce Promise methods or a global runtime.
6. As an application owner, I want closing or hiding the viewer to leave the machine running, so that
   development UI lifetime does not own application behavior.
7. As an application owner, I want closing the session scope to stop only its subscriptions and
   retained history, so that the externally owned machine remains unaffected.
8. As a developer, I want the live head to follow every committed machine snapshot, so that I can
   see where execution is now.
9. As a developer, I want to move a history cursor to an earlier committed snapshot, so that I can
   inspect how the machine reached its current behavior.
10. As a developer, I want moving through history to be observational only, so that inspecting the
    past never repeats database writes, network calls, logs, or other Effects.
11. As a developer inspecting history, I want new machine activity to keep appending, so that
    debugging does not pause or distort the live application.
12. As a developer inspecting history, I want a visible indication that live execution is ahead of
    my cursor, so that I never confuse an old snapshot with the current machine.
13. As a developer, I want an explicit return-to-live control, so that I can jump back to the newest
    snapshot without stepping through every intervening entry.
14. As a developer, I want previous and next controls to move between committed snapshots, so that
    keyboard and compact layouts do not depend on clicking individual history rows.
15. As a developer, I want a completed or defected machine to remain inspectable, so that terminal
    behavior does not erase the evidence needed to understand it.
16. As a developer, I want dispatch controls disabled after completion or defect, so that devtools
    does not imply that a terminal machine still accepts work.
17. As a developer, I want semantic causal steps by default, so that one meaningful transition is
    not overwhelmed by several low-level lifecycle records.
18. As a developer investigating details, I want to reveal the raw inspection events underlying a
    semantic step, so that abstraction never hides available evidence.
19. As a developer, I want semantic and raw history to preserve interpreter emission order, so that
    concurrent work is not presented as an invented sequence.
20. As a developer, I want every committed history entry associated with the correct state snapshot,
    so that the graph and state panel cannot drift from the selected transition.
21. As a developer, I want invocation starts, outcomes, retries, cancellations, completion, and
    defects represented in history, so that Effect-owned work remains visible beside transitions.
22. As a developer, I want a state projection to be optional, so that devtools can remain
    metadata-first when full state contains sensitive or very large values.
23. As an application owner, I want full state values excluded from transport-neutral view models by
    default, so that future adapters do not accidentally expose application data.
24. As a developer debugging locally, I want to provide an explicit state projection, so that the
    selected snapshot can show the values useful for this application.
25. As a developer of a headless machine, I want named quick events, so that I can exercise behavior
    without constructing API requests or adding temporary application buttons.
26. As a devtools integrator, I want quick events declared during session setup, so that development
    controls do not become part of the canonical behavioral definition or graph.
27. As a developer, I want a quick event to contain a predefined decoded event, so that common
    actions require no form or payload editor.
28. As a developer, I want a quick event to use a factory evaluated once per click, so that each
    dispatch may contain a fresh identifier, timestamp, randomized value, or other generated payload.
29. As a developer, I want quick event factories to remain synchronous, so that controls do not
    introduce hidden service requirements or a second Effect execution model into devtools setup.
30. As a developer, I want an unavailable quick event reported without intentionally sending it, so
    that experimenting with controls does not terminate the machine with an avoidable protocol
    defect.
31. As a developer, I want quick controls grouped and described, so that an API-like machine with
    many useful events remains navigable.
32. As a developer, I want quick controls to use compact information density, so that controls do not
    displace the graph and history they exist to support.
33. As a developer, I want the graph centered on the state selected by the history cursor, so that
    topology and history describe the same moment.
34. As a developer approaching a large machine, I want the default graph to show the selected state
    and immediate outgoing targets, so that I can answer “what can happen next?” without seeing the
    entire application.
35. As a developer needing more context, I want a two-step forward projection, so that nearby
    branches can be understood without switching to the full graph.
36. As a developer needing global orientation, I want a full root-machine graph, so that focused
    projections never become the only available truth.
37. As a developer, I want focus projection to preserve the original node and edge identities, so
    that switching depth does not create a different behavioral model.
38. As a developer, I want traversed edges and the selected active state emphasized, so that the
    direction of observed behavior is immediately visible.
39. As a developer, I want highlighted directional edges to communicate flow without obscuring
    labels, so that cycles and branching transitions remain readable.
40. As a developer with reduced-motion preferences, I want directional animation removed while
    emphasis remains, so that flow indication is accessible.
41. As a developer, I want graph zoom, pan, and fit controls, so that both focused and full views are
    usable at different viewport sizes.
42. As a developer using graph-only mode, I want history navigation and return-to-live controls to
    remain accessible, so that maximizing the graph does not strand the history cursor.
43. As a developer, I want a stable layout for unchanged topology, so that moving through history
    does not destroy my spatial memory.
44. As a developer, I want child invocation nodes treated as single atomic nodes in this milestone,
    so that root-machine inspection does not pretend to solve actor-system visualization.
45. As a developer, I want source links on states and decision points when trustworthy information is
    available, so that I can move directly from observed behavior into authored code.
46. As a machine author, I want source references captured automatically, so that file paths and line
    numbers never become metadata I must maintain during refactoring.
47. As a developer, I want a source link to target the relevant declaration or decision function, so
    that navigation remains useful without requiring exact statement-level instrumentation.
48. As a developer, I want missing or unreliable source information represented by no link, so that
    devtools never confidently sends me to unrelated code.
49. As a developer, I want built-in VS Code and Cursor link resolvers, so that common local editors
    work without custom configuration.
50. As a devtools integrator, I want to supply a custom editor-link resolver, so that another editor
    or remote development environment can interpret source locations.
51. As an application owner, I want source capture and resolution to add no UI, layout, renderer, or
    editor dependency to core imports, so that production runtime boundaries remain clean.
52. As a library maintainer, I want graph focus implemented as a pure renderer-independent
    projection, so that future viewers and renderers share the same topology semantics.
53. As a viewer maintainer, I want UI components to consume only the session view model and control
    Effects, so that machine-specific code never enters generic rendering.
54. As a browser application developer, I want an in-page dock connected directly to the session, so
    that clicking real application controls visibly advances graph and history.
55. As a viewer maintainer, I want the same view model usable in a standalone shell, so that adding
    browser or Node transports later does not require redesigning the renderer.
56. As a library evaluator, I want the local-first document workflow displayed by the generic viewer,
    so that the implementation remains grounded in the Milestone 1 reference application.
57. As a library evaluator, I want a second substantial machine displayed without machine-specific
    viewer code, so that genericity is proven rather than asserted.
58. As a library evaluator, I want a large synthetic graph fixture with branching and cycles, so that
    focused projection and layout are exercised beyond toy topology.
59. As a library evaluator, I want the large fixture to remain navigable without initially rendering
    its entire graph, so that partial views solve the performance and legibility problem they claim
    to solve.
60. As a library consumer, I want importing the core package to exclude session, viewer, layout,
    renderer, editor, and UI dependencies, so that development tooling has no production import cost.
61. As an Effect user, I want the devtools session to use scoped Effects and Streams, so that its
    subscriptions, queues, and retained state have explicit lifetimes.
62. As a future adapter author, I want the session view to be renderer- and transport-neutral, so
    that browser, Node, or remote connectivity can be added without changing semantic history.
63. As a future telemetry adapter author, I want semantic steps to retain stable correlation points,
    so that Effect spans, annotations, and logs may later enrich them without becoming a current core
    dependency.
64. As a project maintainer, I want the implementation to stay small and auditable, so that the
    devtools foundation supports rather than undermines the codebase-literacy promise.

## Implementation Decisions

- The primary public acceptance seam is a devtools session created from a real machine definition
  and real running machine handle. Session behavior is not tested against a simulated interpreter.
- A devtools session represents exactly one root machine instance. It does not discover unrelated
  machines globally and does not expose an actor registry.
- Session construction is a scoped Effect. It subscribes immediately to the machine's state changes
  and inspection stream; rendering or opening a dock is independent from recording lifetime.
- The machine handle remains owned by the application. Closing a session stops its subscriptions and
  releases retained history but does not interrupt the machine.
- Session setup accepts the definition, handle, quick-event declarations, and an optional projection
  for state details. It does not accept a runtime or convert any operation into a Promise.
- The session exposes Effect-native read and control operations plus a Stream of immutable session
  views. Its public view contains definition identity, lifecycle status, live-head position,
  history-cursor position, semantic steps, raw inspection metadata, projected selected-state data,
  quick-control metadata, and graph selection metadata.
- The initial snapshot emitted by the machine's state-change Stream becomes history position zero.
  Each later state change is paired by commit order with its corresponding state-change inspection
  activity. The session buffers either side when the two Streams deliver at different moments; it
  never associates snapshots by wall-clock timing.
- Raw inspection records remain the evidentiary source. A pure history reducer derives semantic
  steps without deleting or rewriting raw records.
- Machine start, external event receipt, invocation lifecycle, retry scheduling, machine completion,
  and machine defect are semantic step initiators. Branch selection, ignored-event records, state
  changes, and synchronous state-owned lifecycle records attach to the active initiating step.
  Invocation name and generation identify continuing invocation activity. Ambiguous records remain
  visible raw rather than being assigned an invented cause.
- History positions are committed snapshots, not arbitrary raw records. A semantic step that does
  not commit state points at the most recent committed snapshot, allowing its details to be selected
  without inventing a new state.
- The live head is the newest committed history position. The history cursor may differ from it.
  Appending live records never moves a cursor that the developer deliberately placed in history.
- Previous, next, select-position, and return-to-live operations modify only the history cursor.
  They never call the machine's send operation.
- Session completion or defect freezes dispatch capabilities but preserves all accumulated views
  until the session scope closes.
- Inspection remains metadata-only. Complete decoded snapshots may be retained locally to support
  the cursor, but the transport-neutral session view exposes only the state tag unless setup provides
  an explicit projection. Raw event payloads are never added implicitly.
- A quick event has a stable identifier, label, optional description, optional group, and either a
  decoded event value or a synchronous zero-argument factory. Values are normalized internally to a
  factory.
- A quick-event factory is evaluated exactly once for each dispatch request. It is not evaluated for
  rendering, labels, graph projection, or speculative availability checks.
- Quick-event dispatch materializes the event, checks the machine handle's `can` operation, and sends
  only when accepted. A currently unavailable event produces a devtools control failure and leaves
  the machine untouched. A protocol defect caused by a genuine race between checking and sending is
  not hidden or converted into an expected machine failure.
- Predefined quick events may expose advisory availability by probing `can`. Factory-backed quick
  events remain dispatchable controls because evaluating them merely to render availability would
  violate once-per-click semantics.
- Quick events belong only to session configuration. They are absent from the machine definition,
  renderer-independent graph, serialized state, and package core surface.
- Focused graph projection is a pure operation over the existing graph model. Depth one includes the
  selected node and direct outgoing targets; depth two repeats the same outgoing traversal once;
  full mode returns the complete root graph. Projection preserves authored order and stable IDs and
  includes only edges whose endpoints are selected.
- Cycles are handled with a visited set, so focus depth limits traversal rather than duplicating
  nodes. Self-transitions remain visible when their node is selected.
- Graph activity overlay is separate from topology projection. It identifies the selected active
  node and visible traversed edges without mutating graph nodes or edges.
- Existing child-invocation nodes may appear as atomic nodes already present in the root graph.
  Traversing into child definitions, expanding them, displaying runtime child instances, and actor
  topology are excluded.
- Machine builder operations capture a lazy caller stack when they construct nodes and named logic,
  following the same broad technique used by Effect tracing without importing Effect internals.
  Capturing source information never requires authored paths or line numbers.
- Node, invocation, child, final-state, and named guard helpers capture their own construction call
  site. An ordinary transition or inline reducer without a distinct construction helper falls back
  to the owning node declaration. Exact conditional-statement mapping is not attempted.
- The definition retains an opaque captured source reference. Devtools normalization parses common
  browser and Node stack-frame forms, rejects frames belonging to the state-machine library itself,
  and returns a file/line/column source location only when trustworthy.
- Source-map resolution is an optional development adapter. If an available source map maps a
  generated position to authored code, that authored location is preferred; otherwise an unresolved
  generated or malformed location is omitted rather than presented as authoritative.
- Editor navigation is a resolver from source location to an external URL or copyable reference.
  VS Code and Cursor resolvers ship as devtools utilities; consumers may provide another resolver.
- The generic viewer is a development application layered over the public session contract. It may
  use a UI framework, a graph-canvas library, and a layout engine, but those dependencies cannot be
  reached from core or renderer-independent devtools imports.
- The viewer supports an embedded dock and a standalone host shell through the same components and
  view model. Only the embedded host is connected to a live application in this milestone; the
  standalone shell is proven against direct fixture sessions rather than a cross-context transport.
- The graph canvas supports stable automatic layout, zoom, pan, fit, depth selection, selected-state
  emphasis, traversed-edge emphasis, and reduced-motion-safe directional indication. Layout output
  is cached by graph identity and projection so history navigation does not randomly reposition
  unchanged topology.
- Graph-only mode uses available workspace width but retains compact cursor navigation, live status,
  return-to-live, and depth controls. Quick events and history rows prioritize information density
  over the oversized presentation used by the throwaway prototype.
- The viewer shows semantic history by default and raw records on demand. It does not use the term
  “time travel,” because cursor movement is inspection rather than execution reversal.
- The existing local-first document workflow and one real checkout-style machine are displayed
  through identical generic viewer code. The checkout machine replaces the prototype's pure
  facsimile as the second proof.
- A synthetic root graph contains at least 100 nodes, branching paths, cycles, self-transitions, and
  at least 250 edges. Depth-one and depth-two projections must select bounded subsets without first
  rendering the complete topology. Full mode remains available for deliberate global inspection.
- The package keeps three dependency boundaries: the core machine surface, renderer-independent
  development tooling, and the optional viewer application. Core imports do not evaluate or bundle
  session, Mermaid, editor, source-map, layout, UI-framework, or graph-canvas code.
- No framework binding is added for consuming machines in applications. The embedded viewer is a
  development host, not a React, Vue, or Effect Atom machine integration.
- Semantic steps retain stable local identifiers so a future optional Effect OpenTelemetry adapter
  can correlate spans, annotations, and logs. This milestone neither imports OpenTelemetry nor
  displays telemetry.

## Testing Decisions

- Tests assert external behavior through the public devtools-session seam: construct a public
  definition, run it with the public machine API, attach a session, dispatch through machine or
  quick-event controls, and observe public session views and Streams.
- Session tests use Effect test utilities, scoped fibers, deterministic Layers, and TestClock where
  invoked work requires time. They do not call internal history reducers, queues, or mutable state
  directly.
- Acceptance coverage proves initial attachment, ordered snapshot capture, live-head advancement,
  historical cursor stability while live work continues, previous/next selection, return to live,
  completion, defects, and scope cleanup.
- Quick-event acceptance tests cover predefined values, a factory producing a different value on
  successive clicks, exactly-once factory evaluation, unavailable events, factory exceptions, and a
  real machine transition caused through session dispatch.
- History tests drive external events, invoked success, typed failure, operational retry,
  cancellation, completion, and defect through real machines. They assert semantic step summaries
  and the unchanged ordered raw records exposed beneath them.
- State-projection tests prove metadata-only defaults, explicit projected details, and absence of raw
  event payloads from session views.
- Focused-graph tests exercise the public renderer-independent projection using real definitions.
  They cover depth one, depth two, full mode, cycles, self-transitions, stable IDs, edge filtering,
  unreachable nodes, and active/traversed overlays.
- Source-location tests construct definitions through public builder operations and assert useful
  declaration-level locations without pinning assertions to the test file's exact line numbers.
  Parser fixtures cover common V8/browser and Node frame forms, library-frame filtering, malformed
  stacks, missing stacks, and optional source-map resolution.
- Package-isolation verification packs and installs the library into a clean consumer, imports the
  core entry, and confirms that devtools-session, viewer, layout, editor, source-map, graph-canvas,
  and UI-framework modules are absent from the core bundle graph.
- The local-first document workflow and real checkout machine are end-to-end semantic fixtures. The
  same session/viewer setup is used for both; machine-specific rendering branches are forbidden.
- The synthetic graph fixture verifies that focused projections stay bounded and deterministic. A
  browser smoke test confirms that depth controls, zoom, pan, fit, and history navigation remain
  responsive, but no fragile wall-clock performance threshold is treated as semantic correctness.
- Viewer browser tests operate only through visible controls and rendered output. They cover opening
  the dock, observing real application transitions, dispatching a quick event, selecting history,
  receiving live activity while historical, returning live, changing depth, graph-only navigation,
  reduced-motion rendering, and invoking an editor-link resolver.
- Viewer tests do not assert internal component structure, CSS class names, layout-engine internals,
  exact node coordinates, or animation frames.
- Existing machine, graph, invocation, retry, completion, child, and local-first acceptance tests
  remain the prior art. The milestone extends their public-definition/public-handle approach rather
  than adding implementation-level tests.
- Repository checks, declaration generation, package verification, formatting, type checking, unit
  tests, and browser acceptance all pass from a clean install.

## Out of Scope

- Named paths, event-sequence scenarios, scenario scripting, synchronization steps, and generated
  event forms.
- Replaying event prefixes, branching timelines, undoing state, mutating a live machine from a
  historical cursor, or repeating external Effects.
- Failure injection, connection throttling, latency simulation, service substitution controls, or
  other environment simulation. These may become future session controls.
- Child-definition expansion, nested graph navigation, runtime child-instance views, actor
  registries, actor topology, peer addressing, and dynamic spawning visualization.
- Hierarchical states, parallel regions, or new machine semantics introduced only for devtools.
- Cross-tab browser transport, BroadcastChannel connection, WebSocket transport, Node transport,
  remote sessions, session discovery, and application-wide machine registries.
- Persisting history, exporting sessions, importing recordings, durable resume, snapshot migration,
  or sharing traces between processes.
- Effect OpenTelemetry integration, span trees, span annotations, log display, metrics, or trace
  export. The session retains only a future correlation seam.
- Editable graphs, graph-driven code generation, drag-to-change topology, or any visual source of
  truth.
- Framework bindings for machine consumption, Effect Atom bindings, Promise APIs, or a core-owned
  ManagedRuntime.
- Exact statement-level source mapping, guaranteed source locations in every bundler, authored file
  paths, or authored line numbers.
- Transporting full state or event payloads by default.
- Publishing the standalone viewer as a stable remote devtools product before its connection model
  is separately designed.

## Further Notes

- The throwaway scenario viewer is behavioral and visual evidence only. Its pure cart reducer,
  hard-coded source lines, named paths, hand-built graph routing, spacing, and component structure
  are not production implementation inputs.
- The prototype showed that quick events, focus mode, semantic history, live graph movement, source
  navigation, full-width graph inspection, directional edges, zoom, and pan are valuable. It also
  showed that named paths were less useful than expected and that information density matters more
  than preserving the prototype's oversized style.
- “Redux DevTools on steroids” is a useful interaction analogy: developers recognize that selecting
  recorded history changes what is inspected rather than re-performing external work. Public copy
  should still use the precise project terms history cursor and live head.
- Source capture follows the principles recorded in the automatic-source-location ADR: zero author
  maintenance, declaration-level usefulness, and omission instead of false precision.
- Future child-machine visualization may represent child definitions as collapsed expandable nodes,
  but that requires a separate design for definition topology versus runtime actor instances.
- Future Effect telemetry support may enrich semantic steps with associated spans, annotations, and
  logs through an optional adapter. It must not turn OpenTelemetry into a machine-core dependency.
