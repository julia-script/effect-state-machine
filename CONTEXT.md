# State Machine Library

A small publishable state-machine library built with Effect for Effect users. It makes complex application behavior explicit enough for developers to understand and remain active participants in the code they ship.

## Language

**Machine definition**:
The immutable, synchronously inspectable authored value that declares a machine's schemas, nodes, accepted events, transitions, invoked work, and explanatory descriptions. It is the canonical source of truth; tooling never executes Effects or provides dependencies to discover its topology.
_Avoid_: Visual model, graph definition

**Machine builder**:
The schema-bound definition API that binds machine input, state, and event vocabulary once, then constructs typed nodes before producing a machine definition. Exact syntax is validated through an API prototype before publication.
_Avoid_: Untyped config object, runtime builder

**Machine node**:
One state in a machine definition with exactly one visible behavior kind: ordinary state, invoked Effect, invoked child machine, or final state. Every node may accept events, while an invoked node owns one named operation.
_Avoid_: Action collection, hidden concurrent operations

**Machine state**:
A validated value from the machine's schema-first tagged union. Each variant carries only the state data valid while that state is active.
_Avoid_: State value plus context, mutable context

**Machine input**:
A value validated by the machine's input Schema and consumed by a pure initializer to derive the initial machine state. It becomes long-lived state data only when that initializer stores it there.

**State data**:
The fields carried by a particular machine-state variant. External information becomes state data only after entering through an event or invoked Effect.
_Avoid_: Context

**Machine event**:
A validated value from the machine's schema-first tagged union that requests a transition. An event outside that union is rejected by the type system or schema boundary.
_Avoid_: Untyped message

**Machine schema**:
The Effect Schemas that are the runtime and compile-time source for machine input, states, and events. The interpreter trusts their decoded types; explicit encode/decode helper Effects own codec requirements. In v0 schemas provide definition metadata and encoding boundaries, not persistence or durable resumption; transient invoked outputs, failures, Schedule values, and reducer internals remain inferred TypeScript types.
_Avoid_: Parallel type declaration, persistence engine

**Description**:
Human-written metadata attached beside a named machine element to explain its intent without determining its behavior. State and event descriptions live on their Schema annotations; behavioral descriptions live beside their declarations in the machine definition. Descriptions are visible in both authored code and visualization.

**Named logic**:
An executable element whose behavior cannot be fully reproduced by static tooling, such as a guard, invocation source, or retry policy. Named logic always has a stable human-readable name and may also carry a description.
_Avoid_: Anonymous behavior, opaque callback

**Guard**:
Synchronous, deterministic named logic that selects a transition using only the current machine state and event. Data from an Effect service must enter the machine before a guard can use it.
_Avoid_: Effectful guard, service lookup

**Guarded transition**:
An ordered set of named guard branches for one accepted event, evaluated first-match-wins. An optional final unguarded branch is the fallback; no matching branch is a protocol defect.
_Avoid_: Unordered conditions, implicit fallback

**Reducer**:
Pure logic that derives the next machine state from the current state, the accepted event, or the result of invoked work. Reducers never execute side effects.
Reducers may remain inline because transition topology is already inspectable and trivial data updates should not require artificial names.
_Avoid_: Action, effectful transition, mandatory named reducer

**Machine instance**:
A scoped execution of a machine definition with its dependencies provided. Each instance serializes external events and concurrent Effect completions through one event queue.
_Avoid_: Global machine, concurrent transition processing

**Machine handle**:
The Effect-native interface to a machine instance: current `snapshot`, state `changes`, `send`, `can`, and `completion`. It exposes no Promise conversion.
_Avoid_: Runtime wrapper, Promise API

**Inspection event**:
A metadata-first record of a meaningful interpreter decision or lifecycle change: event receipt, selected branch, state transition, invocation or retry activity, child lifecycle, completion, or defect. Payload values are excluded by default and require an explicit local projection.
_Avoid_: Raw fiber event, implicit payload dump

**Inspection stream**:
The structured Stream of inspection events emitted by a machine instance for devtools, diagnostics, and tests.
_Avoid_: State-change stream, application event bus

**Child machine**:
A statically declared machine invoked by a visible parent state with an independent protocol and a lifetime owned by that state's Scope. Its Effect requirements contribute transitively to the parent definition and are provided only at the composition root. It is the provisional v0 mechanism for behavioral composition.
_Avoid_: Nested state, dynamically spawned actor

**Child protocol**:
The Schema-described input, explicitly forwarded events, and final completion value through which a parent communicates with a child machine. V0 has no global registry, peer addressing, or arbitrary intermediate child emissions.
_Avoid_: Actor system, shared service bus

**Invocation name**:
A stable authored identifier linking a parent definition to an invoked Effect or child definition. Each execution also receives a generated instance ID used to correlate runtime inspection events.
_Avoid_: Runtime ID, display label

**Final state**:
A terminal machine-state variant that completes its machine and is itself the completion value. The declared final tags determine the inferred completion union; a machine with no final states has completion type `never`. Committing it interrupts active work, resolves completion, and ends the state-change stream while preserving the final snapshot.
_Avoid_: Crashed state

**Protocol defect**:
An event from the machine's global event union that is not accepted by its live state. It terminates execution unless a consumer deliberately handles the resulting defect.
_Avoid_: Invalid-transition error, silently ignored event

**Typed failure**:
An expected failure from invoked work that follows a transition declared by the machine definition.

**Defect**:
An unexpected failure that terminates the machine instance and remains observable through the defect Cause of its completion Effect. Consumers may sandbox or supervise that Effect; defects are not converted into ordinary machine states by default.
_Avoid_: Crashed state, failure transition

**Operational retry**:
A retry whose attempts and delays do not change application behavior. The machine remains in its current state while a named Effect Schedule controls execution.

**Modeled retry**:
A retry whose progress affects application data, accepted events, or visible behavior. Relevant attempts and decisions are represented explicitly by the machine.

**Graph model**:
A renderer-independent, read-only projection of a machine definition that visualization tools can select from and render.
_Avoid_: Mermaid document, visual source

**Visualization**:
A read-only rendering of a graph model, including its descriptions, intended primarily to help developers understand their own application behavior.
_Avoid_: Visual editor, source graph

**Devtools**:
An optional development surface that projects or observes machines through their public tooling contract. It may share a distribution package with the core, but core imports never load devtools code and the core never depends on it.
_Avoid_: Framework binding, application adapter, core dependency

**Devtools session**:
The development view of one root machine instance: its definition metadata, current and historical snapshots, inspection events, and available controls. Child-machine and actor-system topology are outside the initial session model.
_Avoid_: Application-wide machine registry, actor registry

**History cursor**:
A selection over snapshots already recorded by a devtools session. Moving it backward or forward changes only what the developer is inspecting; it does not change the live machine, replay events, or repeat external effects.
_Avoid_: Time travel, undo, replay

**Live head**:
The newest snapshot recorded from the running machine while a developer may be inspecting an older snapshot with the history cursor. Returning to live moves the cursor to this position; it does not perform a machine transition.
_Avoid_: Current cursor, replay target

**Quick event**:
A named machine event exposed by devtools-session setup for direct dispatch. It may contain a predefined decoded event or a factory evaluated on every dispatch, allowing fresh or randomized payloads without an application UI or hand-authored input form.
_Avoid_: Named path, generated event form

**Focused graph**:
A partial graph projection centered on the selected snapshot's active state and a configurable depth of states reachable ahead of it. It reduces visual noise without changing the underlying machine definition or full graph model; future child-machine graphs may appear as collapsed nodes that can be expanded separately.
_Avoid_: Separate graph, pruned machine definition

**Source location**:
Best-effort development metadata captured automatically when authored machine elements are constructed, identifying the declaration or decision function that produced them. Authors never maintain file paths or line numbers; tooling omits links when runtime stacks or source maps cannot resolve a trustworthy location.
_Avoid_: Authored line number, exact statement mapping

**Codebase literacy**:
A developer's ability to navigate and explain the application behavior they ship, including code produced with agentic assistance. Preserving it is a public promise of the library.
_Avoid_: Non-developer authoring, visual programming

**Reference application**:
The headless, single-document local-first workflow used to falsify claims that the library supports complex applications. It covers opening, editing, saving, offline retry, conflict resolution through one statically declared child, cancellation, typed failures, and snapshot encoding without requiring dynamic actors or parallel regions.
_Avoid_: Demo application, framework example

**Capability evidence**:
An executable focused fixture or an unavoidable need in the reference application that justifies adding a semantic feature to the library.
_Avoid_: Feature parity, speculative capability
