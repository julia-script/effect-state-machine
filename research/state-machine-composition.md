# Composition in complex state-machine applications

Research date: 2026-08-09

This note investigates composition mechanisms rather than selecting a product design. It uses current XState v5 documentation and Effect 4.0.0-beta.106 source code as primary sources.

## Executive findings

Hierarchy, parallel regions, and child actors are not three syntaxes for the same feature:

- **Hierarchy** factors one statechart into nested modes while preserving one logical machine, one state configuration, and hierarchical event selection. It solves shared transitions and phase-local behavior.
- **Parallel regions** represent several orthogonal modes that are simultaneously active and receive the same event in one statechart step. They solve atomic coordination across a fixed set of dimensions.
- **Child actors** isolate logic, state, lifecycle, and communication behind an event protocol. Invoked children solve state-bound, fixed-cardinality work; spawned children solve dynamic-cardinality entities. They do not automatically provide the shared-event, single-step semantics of parallel regions.

Effect already supplies most runtime machinery needed by child-machine composition: `Scope` for lifetime boundaries, scoped fibers for interruption, `Layer` for dependencies, `Queue` for a serialized mailbox, and `Stream` for observations. Those primitives do **not** define statechart composition semantics by themselves.

For a complex but bounded headless reference application, the smallest composition capability supported by this evidence is **a statically declared child machine whose lifetime is scoped to a visible parent state, with typed parent/child messages and child completion/failure routed through the parent's serialized queue**. This can test decomposition, lifecycle, cancellation, dependencies, and combined inspection without requiring full hierarchy, parallel-state semantics, dynamic spawning, or actor-system addressing. If the reference application intentionally models an unknown number of independently addressable entities, dynamic spawning becomes a separate minimum requirement.

## 1. XState v5 composition mechanisms

### 1.1 Compound (hierarchical) states

A compound state contains child states; entering it also enters its configured initial child. Only descendants of an active parent can be active. When an event arrives, XState checks enabled transitions from the deepest active child upward through its ancestors. A child final state completes its parent and can trigger the parent's `onDone` transition. [XState: parent states](https://stately.ai/docs/parent-states) [XState: transition selection](https://stately.ai/docs/transitions)

Hierarchy therefore solves:

- **Shared transitions:** `Cancel`, `Close`, or `Disconnect` can be declared once on a parent and apply to all descendants.
- **Phase-local vocabulary:** `Editing.Clean` and `Editing.Dirty` exist only while `Editing` is active.
- **Subprocess completion:** a parent phase can finish when its nested final state is reached.
- **Lifecycle containment:** invocation attached to a parent remains alive across transitions between its descendants unless the parent is re-entered or exited. XState explicitly distinguishes descendant transitions from re-entering transitions for invoked-actor lifecycle. [XState: invoke lifecycle and re-entry](https://stately.ai/docs/invoke)

Representative scenario: a document session has an `Open` phase containing `Clean`, `Dirty`, and `ResolvingConflict`. `Close` is valid throughout `Open`; a connection monitor attached to `Open` should survive movement among those child states.

Hierarchy is **not isolation**. Nested state nodes are part of the same statechart configuration, participate in the same transition-selection algorithm, and use the machine's state data. It also does not express simultaneous orthogonal modes: an ordinary compound parent has one active child branch.

The official XState guidance cautions that nesting should emerge from shared behavior or subprocess boundaries, and that deep hierarchy can reduce understandability. [XState: modeling parent states](https://stately.ai/docs/parent-states#modeling)

### 1.2 Parallel states

A parallel state contains multiple regions that are all active. Entering or exiting the parallel parent enters or exits every region; an incoming event is received and handled by all regions; the parallel parent is done after every region reaches a final state. [XState: parallel states](https://stately.ai/docs/parallel-states)

Parallel regions solve a problem hierarchy alone cannot: **a single machine snapshot may need several simultaneously active finite modes**. For example:

- editor content: `Clean | Dirty`
- connectivity: `Online | Offline`
- synchronization: `Idle | Pushing | Pulling | Conflict`

Without orthogonal regions, flattening those dimensions creates a Cartesian product (`DirtyOfflinePushing`, `CleanOnlineIdle`, and so on) or moves finite modes into loosely governed data fields.

The important semantic property is not merely that work runs concurrently. The regions are part of one state configuration and all observe the same event during statechart processing. A fixed set of independent Effect fibers can execute concurrently, but fibers alone do not define simultaneous event broadcast, conflict resolution among selected transitions, a composite state value, or the “all regions final” completion barrier.

Parallel regions are unnecessary when concurrent concerns are behaviorally independent and communicate only through explicit messages. XState's own guidance points to invocation for separate concerns, nesting where only one child should be active, and ordinary data where aspects are tightly coupled. [XState: when to use parallel states](https://stately.ai/docs/parallel-states#when-to-use-parallel-states)

### 1.3 Invoked actors

An XState state can invoke one or more actors. An invoked actor starts when its owning state is entered and stops when that state is exited. The child may be a machine, promise, observable, transition actor, or callback actor; completion and failure can drive `onDone` and `onError` transitions. A Promise actor cannot be canceled at the Promise level, but XState discards its emitted result after the owning state has exited. [XState: invoke](https://stately.ai/docs/invoke)

Invoked actors solve:

- **Encapsulation and reuse:** a subprocess can have its own state and event vocabulary.
- **Explicit asynchronous lifecycle:** work is started and canceled by a visible parent state.
- **Fixed-cardinality composition:** a known child such as `syncSession` or `conflictResolver` exists while a corresponding state is active.
- **Failure/completion protocol:** the parent reacts to child termination without sharing the child's internal states.

Representative scenario: entering `ResolvingConflict` invokes a conflict-resolution machine. The parent knows only its input, allowed messages, output, and failure; the child owns the steps for loading versions, awaiting a resolution, and applying it.

Invocation differs from hierarchy: a child actor has an independent snapshot and communicates through messages, while a nested state is part of the parent's state configuration. Invocation also differs from an arbitrary invoked Effect: a child machine remains interactive and stateful during its lifetime rather than merely producing one success or failure value.

### 1.4 Spawned actors and actor systems

XState distinguishes invoked actors, which are bound to a state, from spawned actors, which start during a transition and live until explicitly stopped or their parent machine stops. The docs characterize invocation as appropriate for a finite/known number of actors and spawning for a dynamic/unknown number, using a todo per item as the example. [XState: actors](https://stately.ai/docs/actors) [XState: spawn lifecycle](https://stately.ai/docs/spawn)

Spawned actors solve **dynamic topology**: tabs, jobs, documents, uploads, peers, or domain entities can be added and removed at runtime. This is not solved by a static hierarchy or fixed parallel regions because their topology is definition-time data.

An actor system is implicitly rooted at the actor created by `createActor`; descendants form a communication hierarchy. Actors may be registered under system-wide IDs and found by other actors, and stopping the root stops the whole system. [XState: systems](https://stately.ai/docs/system)

Actor-system addressing solves cross-tree discovery and communication, but introduces additional design concerns:

- stable identity and ID collisions;
- message protocols between isolated components;
- ownership and stopping rules;
- ordering across independent mailboxes;
- supervision and failure policy;
- graph/inspection views for a runtime topology that may not exist statically.

A full actor system is therefore more than child-machine composition. A library can support a statically invoked child without supporting dynamic registration or arbitrary peer lookup.

### 1.5 Child lifecycle and cancellation

XState's lifecycle rules are structural:

- invoked child: starts on state entry, stops on state exit;
- spawned child: starts when spawned, stops explicitly or with its parent;
- root stop: stops the actor system;
- re-entering an invocation-owning state restarts its child, while an internal transition that keeps the parent active does not. [XState: invoke lifecycle](https://stately.ai/docs/invoke#lifecycle) [XState: actors](https://stately.ai/docs/actors)

These rules make lifetime visible in the definition. They also answer a question ordinary async composition leaves ambiguous: which owner is responsible for interrupting a child when the surrounding application changes mode?

### 1.6 Persistence

XState separates an actor's emitted snapshot from its persisted internal state. `getPersistedSnapshot()` captures persistence data and `createActor(logic, { snapshot })` restores it. Machine persistence is deep: invoked and spawned descendants are persisted and restored recursively. On restoration, actions are not replayed, invocations restart, and spawned actors are recursively restored. The docs require serialized data to be JSON-compatible and warn that definitions may evolve incompatibly. [XState: persistence](https://stately.ai/docs/persistence)

This creates a strong coupling between composition and persistence:

- child identity must survive serialization;
- runtime topology becomes persisted data;
- restoration needs lifecycle rules distinct from fresh entry;
- machine evolution needs compatibility or migrations;
- replaying events is semantically different from restoring a snapshot.

Persistence is not required merely to compose children in memory. Deep persistence is a later semantic commitment because it freezes more of the runtime representation as data.

### 1.7 Visualization and inspection semantics

XState exposes both static and live views:

- State-machine definitions have compound and parallel nodes, so a static renderer can represent hierarchy and orthogonal regions directly.
- `xstate/graph` converts a machine to graph structures and generates paths for testing, analysis, and visualization. [XState: graph and paths](https://stately.ai/docs/graph)
- The inspection API reports actor creation, message delivery, snapshot updates, and statechart microsteps across the entire actor system. Microsteps matter because transient states can be entered and left before a subscriber sees the final snapshot. [XState: inspection](https://stately.ai/docs/inspection)
- The Stately inspector can generate machine diagrams when definitions are available and sequence diagrams from actor communication. [Stately Inspector](https://stately.ai/docs/inspector)

This reveals two different graph problems:

1. **Definition topology:** possible state transitions, nested regions, declared invocations.
2. **Runtime topology and trace:** actor instances, dynamic children, message paths, microsteps, and active configurations.

A static graph cannot enumerate an unknown number of spawned actors. Conversely, a runtime actor diagram cannot replace the definition graph because it shows only instantiated paths. Partial graphs become increasingly important once nesting or actor composition exists: a parent can display a child as a collapsed node and link to the child's own definition, while inspection can expand only the active/runtime-relevant portion.

## 2. What Effect 4 already provides

### 2.1 Scope and scoped fibers

Effect's `Scope` is a resource lifetime boundary: finalizers are registered with a scope and run when it closes. `Effect.forkIn` and `Effect.forkScoped` attach a fiber to a supplied or current scope so closing that scope interrupts the fiber. `forkChild` is supervised by the parent fiber, while detached fibers deliberately escape that lifetime. [Effect 4 `Scope` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Scope.ts#L1-L46) [Effect 4 scoped-fork source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Effect.ts#L16980-L17110)

Applicable mapping: an invoked child machine can run in a scope owned by the parent state. Exiting the state closes the scope, interrupts the child's event loop and invocations, and runs its finalizers. This provides the mechanism for XState-like state-bound lifetime without inventing a second cleanup system.

Limit: Scope answers **when resources die**, not which parent events are forwarded, which child outputs cause transitions, how snapshots compose, or whether several child transitions are atomic.

### 2.2 Fibers

Effects execute concurrently in fibers with structured interruption and supervision. This is enough to run several child interpreters or invocations simultaneously. [Effect 4 `Effect` model and forking source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Effect.ts#L90-L125)

Applicable mapping: each child machine can own an event-loop fiber; parent shutdown can interrupt it structurally; child completion can be joined or translated into a parent event.

Limit: concurrent fibers are not parallel statechart regions. Effect defines scheduling and interruption but not a statechart macrostep in which one event is evaluated against multiple regions and committed as one composite transition.

### 2.3 Layer and services

`Layer<ROut, E, RIn>` describes how services are acquired, which dependencies they require, and how scoped resources are released; layers can be composed and memoized. [Effect 4 `Layer` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Layer.ts#L1-L62)

Applicable mapping: a child definition's Effect requirements can contribute to the composed machine requirements, while the caller supplies implementations at execution time. A parent and child can share memoized services or receive different layers when isolation is intentional.

Limit: Layer is dependency composition, not behavioral composition. A shared service should not become an implicit event bus between machines unless that communication is part of the declared protocol; doing so would make the graph incomplete.

### 2.4 Queue and Stream

Effect `Queue` is an asynchronous producer/consumer queue with bounded variants and shutdown/failure states. `Stream` represents a pull-based, backpressured sequence of values requiring typed services. [Effect 4 `Queue` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Queue.ts#L289-L322) [Effect 4 `Stream` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Stream.ts#L1-L132)

Applicable mapping:

- one queue per machine provides a serialized mailbox;
- invocation and child-completion events re-enter through that queue;
- streams expose state changes and structured inspection events;
- a parent can consume a child's output/inspection stream without sharing mutable state.

Limit: separate queues mean separate ordering domains. If parent and child messages race, the design must specify what ordering is guaranteed. A Queue does not provide actor identity, dead-letter handling, supervision, or transactional multi-machine commits.

### 2.5 Official Effect Workflow

Effect 4's unstable Workflow API defines named durable workflows with schemas for payload, success, and error, deterministic execution IDs, polling, interruption, resumption, and handler Layers. Activities are named Effects whose encoded results can be stored and replayed. Durable clocks and deferreds provide persisted suspension boundaries. [Effect 4 `Workflow` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Workflow.ts#L1-L149) [Effect 4 `Activity` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Activity.ts#L1-L160) [Effect 4 durable clock source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/DurableClock.ts#L1-L112)

Workflow also recognizes parent executions: starting a workflow inside another links interruption and suspension; the engine explicitly warns that unsafe interruption can orphan child workflows. [Effect 4 `WorkflowEngine` source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/WorkflowEngine.ts#L100-L156) [Effect 4 child-workflow execution source](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/WorkflowEngine.ts#L400-L450)

Workflow is relevant to future durable-machine execution but is not a substitute for state-machine composition:

- it persists workflow inputs and durable operation boundaries, not a statechart definition or active hierarchical/parallel configuration;
- its handler is ordinary Effect code, so its control flow is not statically graphable;
- child workflows express durable execution relationships, not nested state transition selection or parallel-region macrosteps;
- adopting it would bring engine, identity, replay, schema, and compatibility semantics beyond in-memory composition.

The useful precedent is narrower: durable boundaries need stable names and schemas, child lifetime must be explicit, and recovery semantics must distinguish rerunning code from replaying stored operation results.

## 3. Problems solved: comparison matrix

| Problem | Hierarchical states | Parallel regions | Invoked child machine | Spawned child / actor system | Effect primitive alone |
| --- | --- | --- | --- | --- | --- |
| Factor shared transitions across related modes | Native | Within each region/ancestor | Requires messages or duplication | Requires messages or registry | No |
| Represent one exclusive nested phase | Native | Each region has one | Child owns it, parent cannot directly treat it as own state | Child owns it | Fibers do not model states |
| Represent several simultaneously active finite modes | No | Native composite configuration | Several children can be active, but not one atomic configuration | Same, dynamic topology | Concurrent fibers only |
| One event handled synchronously by several regions | Ancestor/child selection, not orthogonal broadcast | Native | Must explicitly broadcast; separate mailboxes | Must explicitly broadcast | Queue/fibers need custom semantics |
| Encapsulate reusable stateful subprocess | Inline, coupled to parent definition/data | Inline regions | Native | Native | Scope/fiber supplies runtime only |
| State-bound child lifetime | Nested node lifetime, but not isolated child | Region lifetime | Native invocation | Must manage manually | Scope is the direct mechanism |
| Dynamic number of independently addressable entities | No | No | Normally fixed declarations | Native | Requires registry + scopes + queues |
| Recursive persistence of runtime topology | State value captures nesting | State value captures regions | XState deep persistence | XState deep persistence | Schema/storage policy still needed |
| Collapsible static visualization | Native nesting | Native regions | Definition can link to separate child graph | Only actor type is static; instances are runtime | Needs explicit metadata model |

## 4. Representative scenarios and discriminating questions

### Scenario A: document editing phase

`Closed -> Opening -> Open.{Clean | Dirty | ResolvingConflict} -> Closing`

This primarily tests hierarchy: shared `Close`, phase-local states, and a connection or lock lifetime spanning several children. Modeling `Clean`, `Dirty`, and `ResolvingConflict` as independent child actors would isolate them but make transitions among mutually exclusive modes an inter-actor protocol instead of one statechart.

Discriminating question: must a transition be inherited across several substates while staying in one logical machine? If yes, hierarchy has unique value.

### Scenario B: editing, connectivity, and sync modes coexist

The editor can be dirty while offline and a pending sync policy can simultaneously be backing off.

This tests orthogonality. Parallel regions avoid flattening a Cartesian product and define how one event (for example `DocumentClosed`) affects every region in the same step. Separate child machines can also represent the concerns, but their event delivery and snapshot updates are not automatically atomic.

Discriminating question: does the application require a coherent composite state and shared-event semantics, or merely concurrent independent processes? Only the former requires parallel-state semantics.

### Scenario C: conflict resolution subprocess

While `Conflict` is active, a reusable interactive subprocess loads versions, accepts user/system resolution events, and eventually produces a merge result.

This tests state-bound child invocation. A single Effect invocation is insufficient if the subprocess must accept events while running; inline hierarchy is sufficient if isolation and reuse are unimportant.

Discriminating question: does the subprocess need its own protocol, state, reusable definition, and cancellation boundary? If yes, a child machine adds unique value.

### Scenario D: many open documents or uploads

Each document/upload has independent state and can be created or removed at runtime.

This tests dynamic spawning and identity. Static regions or declarations cannot enumerate unknown cardinality. A runtime registry, addressable references, and explicit stop semantics are required.

Discriminating question: is runtime cardinality unbounded or data-driven? If yes, fixed child invocation is insufficient.

## 5. Smallest composition capability that can prove v0

For a **single-session, headless local-first document workflow** with a fixed set of subprocesses, the smallest composition slice supported by the preceding distinctions is:

1. **Statically declared machine invocation.** A visible parent state names a child machine definition and its input.
2. **State-bound scoped lifetime.** Entering starts the child in a fresh Effect Scope; leaving interrupts the child and its effects and runs finalizers.
3. **Typed protocol.** The parent can send declared child events; child completion, typed failure, or emitted events re-enter the parent's serialized queue.
4. **Requirement composition.** Child Effect requirements are reflected in the executable composition and supplied by Layers at the boundary.
5. **Inspection and definition identity across the tree.** Static tooling can link or collapse the child graph, while runtime inspection correlates parent and child instance IDs and lifecycle.
6. **Defined ordering.** Each instance processes its own queue serially; documentation must say what is and is not ordered across parent/child mailboxes.

This slice exercises the hard seam—behavioral composition on top of Effect's runtime—without committing v0 to:

- compound-state transition inheritance;
- parallel-region macrosteps and atomic composite snapshots;
- dynamic spawning and system-wide lookup;
- deep persistence of an actor tree;
- supervision strategies beyond scoped interruption;
- a global actor registry.

That is not proof those features are undesirable. It is a way to make their necessity falsifiable through the reference application.

Two changes to the reference application would move the minimum:

- If it must model `editing × connectivity × synchronization` as one coherent state configuration with one-event atomicity, **parallel regions** become necessary.
- If it must manage an unknown number of documents/jobs concurrently, **dynamic spawning plus stable identity** becomes necessary.

Hierarchy is the least replaceable when shared ancestor transitions and nested completion materially simplify the reference definition; until such a case appears, a child graph linked from a parent invocation can provide structural decomposition without adopting full statechart hierarchy.

## 6. Questions the implementation spike should answer

These are empirical questions, not product decisions:

1. Can child requirements be inferred without making parent types unreadable?
2. Does state exit close the child scope before or after the parent's next state is committed, and what appears in inspection?
3. Can child completion and external parent events race, and which queue order is observable?
4. Are child outputs ordinary typed internal events, or a distinct completion channel?
5. Can graph tooling derive parent/child links without importing executable child logic?
6. Does a collapsed child graph preserve enough information for the codebase-literacy goal?
7. Does the reference application reveal a real need for shared ancestor transitions, atomic parallel regions, or runtime-dynamic topology?
8. What snapshot is serializable: only each machine's tagged state, or also child identity/lifecycle data?

## Sources

Only first-party sources were used:

- [XState v5 documentation](https://stately.ai/docs)
- [Effect 4.0.0-beta.106 source at commit `fb75264`](https://github.com/Effect-TS/effect/tree/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src)
