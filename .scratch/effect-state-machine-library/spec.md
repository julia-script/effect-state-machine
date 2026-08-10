Status: completed

# Effect State Machine Library

## Problem Statement

Agentic coding can make an Effect developer dramatically more productive while gradually separating them from the code they ship. The developer becomes responsible for intentions and specifications but loses the ability to navigate, explain, and confidently change the application behavior produced on their behalf.

Effect already provides excellent primitives for dependencies, typed failures, concurrency, cancellation, time, resource safety, and supervision. Those primitives are intentionally general and executable, so a complex program's orchestration is not necessarily recoverable as a static model. XState makes orchestration explicit, but combining it with Effect creates overlapping ownership and pressures Effect into a narrow execution role.

The project needs a small state-machine library built with Effect for Effect users. It must keep behavior understandable in authored code and through a read-only graph, preserve Effect's native dependency and execution model, and remain small enough that developers can understand the interpreter itself. It is not intended to reproduce XState, create a visual programming environment, or hide Effect behind a framework-neutral abstraction.

## Solution

Build a small publishable state-machine library whose immutable machine definitions are the canonical source of truth. Definitions use Effect Schema for input, state, and event data; represent the complete machine state as a tagged union; retain descriptions and topology as synchronous structural metadata; and attach named executable logic only where static representation is impossible.

The interpreter runs definitions as scoped Effects. It infers service requirements from invoked Effects, retry Schedules, and child machines; receives concrete implementations through Layers at the composition root; serializes all transition-producing activity through one queue per machine instance; interrupts state-owned work on exit; and exposes an entirely Effect-native machine handle.

Read-only tooling consumes a renderer-independent graph model and a structured inspection stream. Mermaid is the initial renderer, not the tooling data model. A standalone devtools application may use any appropriate UI technology while remaining isolated from the core import path.

The library's application-scale claim is proven by focused executable capability fixtures and one headless local-first document workflow. Features enter v0 only when such evidence demonstrates that honest behavior cannot be expressed without them.

## User Stories

1. As an Effect developer using coding agents, I want application behavior to remain readable in code, so that increased generation speed does not cost me codebase literacy.

2. As an Effect developer, I want a read-only graph derived from the same definition I execute, so that I can orient myself without maintaining a second behavioral model.

3. As a library user, I want authored code to remain the canonical source of truth, so that review, versioning, generation, and refactoring use ordinary TypeScript workflows.

4. As a developer reviewing agent-authored code, I want every state, event, transition, invocation, guard, retry policy, and child link to be discoverable from the definition, so that I can explain the machine before running it.

5. As an Effect developer, I want machine input, states, and events defined with Effect Schema, so that their runtime and compile-time vocabulary cannot drift apart.

6. As an Effect developer, I want TypeScript types derived from those Schemas, so that I do not maintain parallel data declarations.

7. As an application developer, I want each machine state represented by a tagged-union variant containing only valid state data, so that impossible combinations are not representable.

8. As an application developer, I want a pure initializer to derive the initial state from decoded machine input, so that initialization is deterministic and inspectable.

9. As an integration developer, I want explicit Schema encode/decode helpers, so that snapshots and events can cross runtime boundaries without coupling codec requirements to machine execution.

10. As an Effect developer, I want the interpreter to trust decoded values, so that internal transitions do not repeatedly pay for validation already performed at application boundaries.

11. As a machine author, I want state and event descriptions adjacent to their Schema cases, so that explanatory metadata stays close to the data it describes.

12. As a machine author, I want behavioral descriptions adjacent to guards, invocations, retry policies, transitions, and child declarations, so that graph labels and code tell the same story.

13. As a machine author, I want opaque executable elements to have stable human-readable names, so that tooling can describe their intention without pretending to inspect functions.

14. As a machine author, I want pure reducers to remain inline when they are simple, so that clarity does not require ceremonial names for ordinary state-data updates.

15. As a machine author, I want synchronous pure guards over the current state and event, so that transition selection remains deterministic.

16. As a machine author, I want external information to enter through events or invoked Effects before a guard can use it, so that service lookups do not hide nondeterministic routing.

17. As a machine author, I want ordered guarded branches with first-match-wins semantics, so that overlapping conditions have explicit precedence.

18. As a machine author, I want an explicit fallback branch or an explicit protocol defect when no guard matches, so that the graph does not imply nonexistent exhaustiveness.

19. As a machine author, I want distinct ordinary, invoked-Effect, invoked-child, and final node kinds, so that each state's lifecycle behavior is visible.

20. As a machine author, I want each invoked node to own one named operation, so that concurrent work is represented through explicit composition rather than hidden arrays of effects.

21. As an Effect developer, I want invoked operations to retain their typed success, failure, and service requirement types, so that the machine does not erase Effect's type information.

22. As an Effect developer, I want typed failures to follow declared machine transitions, so that expected failure remains modeled application behavior.

23. As an Effect developer, I want defects to terminate the machine and remain observable as an Effect Cause, so that bugs are not disguised as domain states.

24. As a consumer that needs recovery, I want to supervise or sandbox machine completion with standard Effect primitives, so that the state-machine library does not invent another defect system.

25. As a machine author, I want operational retries powered by native Effect Schedules, so that retry execution retains Effect's time, cancellation, composition, and testing semantics.

26. As a developer reading a graph, I want an operational retry's stable name and description displayed without a fabricated schedule diagram, so that the visualization remains honest.

27. As a developer inspecting a running machine, I want actual retry attempts and delays reported at runtime, so that opaque static policy still has observable execution.

28. As a machine author, I want retries that influence accepted events or visible behavior modeled explicitly, so that meaningful retry progress does not disappear inside an Effect.

29. As an application developer, I want leaving an invoked state to interrupt its Effect and any Schedule delay, so that work cannot outlive the state that owns it.

30. As an application developer, I want stale invocation completions ignored after state exit, so that interrupted work cannot mutate a later state.

31. As an application developer, I want one serialized event queue per machine instance, so that external events and concurrent Effect completions produce deterministic transitions.

32. As an application developer, I want event types outside the machine's event union rejected statically or at a Schema boundary, so that invalid vocabulary cannot reach the interpreter.

33. As an application developer, I want an event incompatible with the live state to become a protocol defect, so that accidental misuse is loud rather than silently ignored.

34. As an application developer, I want intentionally irrelevant or late events declared explicitly, so that expected tolerance remains visible in code and graphs.

35. As a UI or orchestration developer, I want `can(event)` as an observational helper, so that I can present available actions while understanding it is not an atomic send guarantee.

36. As an application developer, I want a scoped Effect to create a machine instance, so that its queue, fibers, children, and finalizers have one explicit lifetime.

37. As an application developer, I want the machine handle to expose Effect-valued `snapshot`, `send`, `can`, and `completion`, plus a Stream of `changes`, so that the application stays inside Effect.

38. As an application developer, I want Promise conversion and `ManagedRuntime` ownership left to my composition root, so that the core does not choose an execution boundary.

39. As an application developer, I want concrete service Layers selected only when executing a definition, so that the same machine can run with production, test, local, or failing implementations.

40. As a library user, I want service requirements inferred transitively from invoked Effects, Schedules, and child machines, so that composition remains type-safe without manually maintained environment declarations.

41. As a machine author, I want a statically declared child machine owned by a visible parent state, so that reusable interactive subprocesses have explicit protocols and scoped lifetimes.

42. As a machine author, I want child input, forwarded events, and final output typed through a minimal child protocol, so that parent-child communication remains understandable without a global actor system.

43. As a parent-machine author, I want child completion and failure activity serialized through the parent queue, so that child lifecycle cannot bypass transition ordering.

44. As a developer inspecting composed machines, I want stable authored invocation names and generated runtime instance IDs, so that static child links and repeated executions can both be correlated.

45. As a developer reading a parent graph, I want child definitions represented as collapsible or linked nodes rather than flattened automatically, so that complex applications can be viewed in parts.

46. As a machine author, I want explicit final states, so that terminating and non-terminating machines have distinguishable contracts.

47. As a parent-machine author, I want a child's final-state value to be its inferred completion output, so that completion does not require a duplicate output Schema.

48. As a consumer of a completing machine, I want the final snapshot committed before completion resolves, so that observers agree on the terminal state.

49. As a consumer of a completed machine, I want active work interrupted, the change Stream ended, and later events rejected, so that finality has precise lifecycle semantics.

50. As a developer using diagnostics or devtools, I want a semantic inspection Stream, so that I can see received events, selected branches, transitions, invocations, retries, children, completion, and defects.

51. As an application owner, I want inspection to exclude full payloads by default, so that sensitive or large state data is not accidentally transported.

52. As a developer debugging locally, I want to opt into an explicit payload projection, so that I can inspect useful values without weakening the safe default.

53. As a devtools author, I want immutable definition metadata available synchronously, so that topology can be projected without running Effects or providing services.

54. As a devtools author, I want a renderer-independent graph model, so that Mermaid, React Flow, partial views, and future renderers do not shape the interpreter API.

55. As a developer using v0 tooling, I want a simple Mermaid renderer, so that every definition has an immediately usable read-only visualization.

56. As a developer viewing a graph, I want state/event Schema descriptions, guarded branch order, named logic, retry summaries, and child links preserved, so that the graph conveys intent rather than only topology.

57. As an application developer, I want importing the core surface never to load devtools code, so that development tooling has no production runtime cost.

58. As a devtools application author, I want freedom to use an appropriate UI framework internally, so that core framework independence does not constrain a separate development application.

59. As an Effect Atom user, I want to consume machine Effects through Atom without a special binding package, so that existing Effect integrations remain the application's responsibility.

60. As a library maintainer, I want whole-definition validation for duplicate nodes, missing targets, and invalid initial tags, so that malformed definitions cannot begin execution or silently get stuck.

61. As a library maintainer, I want type-level checks wherever TypeScript can express an invariant, so that mistakes appear before runtime.

62. As a library maintainer, I want the core implementation to remain small enough to read as a whole, so that the library itself supports the codebase-literacy promise.

63. As a library maintainer, I want new semantics justified by executable capability evidence, so that XState parity does not become an implicit backlog.

64. As a library evaluator, I want focused fixtures for individual semantics and one integrated reference workflow, so that claims of complexity support are falsifiable.

65. As a library evaluator, I want the reference workflow to remain headless and framework-independent, so that it proves state-machine semantics rather than adapter ergonomics.

66. As a library evaluator, I want deterministic tests using injected Layers and `TestClock`, so that cancellation, retries, failures, and time-dependent transitions do not rely on wall-clock sleeps.

67. As a library evaluator, I want graph assertions derived from the same tested definitions, so that runtime behavior and static explanation cannot drift unnoticed.

68. As a future maintainer, I want persistence and schema evolution treated as separate deliberate designs, so that serializable state is not confused with durable execution.

69. As a future maintainer, I want hierarchy, parallel regions, and dynamic spawning admitted only for scenarios requiring their unique semantics, so that composition does not grow by imitation.

70. As a developer considering the library, I want it described as a state-machine library built with Effect for Effect users, so that its identity does not depend on comparisons with other libraries.

## Implementation Decisions

- The deliverable is a small publishable state-machine library built with Effect for existing Effect users. It is not positioned as an “Effect-native alternative” to another library.

- Preserving codebase literacy during agentic development is one public product promise: developers should be able to understand behavior in both code and a read-only graph even when coding agents contribute substantially.

- Machine definitions are authored code and the canonical source of truth. Visualizations are read-only projections; bidirectional visual authoring is deliberately rejected.

- The production implementation will be built cleanly from the specification. The existing todo interpreter remains throwaway primary evidence and is not evolved directly into the published library.

- The public model is Schema-first. Machine input uses an Effect Schema; machine states and events use Effect Schema tagged unions; TypeScript types are derived from those Schemas.

- The API accepts tagged-union schemas produced by both the concise tagged-union constructor and individually annotated cases converted into a tagged union. This preserves per-case description locality.

- Schemas are required for input, state, and events. Invoked outputs, typed failures, Schedule values, guard results, and reducer internals remain inferred TypeScript types unless a later durable boundary requires encoding.

- The interpreter operates on decoded Schema types and does not revalidate every event or reducer-produced state. External unknown data is decoded before it enters the core API.

- Encode/decode helpers are explicit Effects. Any codec service requirements stay on those helpers and do not contribute to machine execution requirements.

- State and event titles/descriptions live on their adjacent Schema cases. Transition, guard, invocation, retry, and child descriptions live adjacent to those declarations in the machine definition.

- A machine definition is immutable and synchronously inspectable. Tooling can read topology and metadata without running application Effects or providing dependencies.

- The builder binds input, state, and event Schemas once, then creates typed nodes before producing a definition. The prototype's builder shape is retained conceptually; exact syntax is decided by a focused API prototype.

- V0 has four explicit node kinds: ordinary state, invoked Effect, invoked child machine, and final state. Each node may accept events; an invoked node owns one named operation.

- Multiple concurrent operations are not hidden in an array on one state. Concurrency requiring separately meaningful lifecycles uses explicit composition.

- Reducers are synchronous and pure. They may remain inline and do not require artificial names.

- Guards are synchronous, deterministic, and pure over the current state and event. They cannot access Effect services directly.

- Guarded alternatives are ordered and evaluated first-match-wins. Every opaque guard has a stable name and optional description. A final unguarded branch is the fallback; no match without a fallback is a protocol defect.

- The guarded-branch API borrows narrowing and `when`/fallback ergonomics from Effect Match but stores its own first-class branch records. Effect Match values are not definition metadata because they discard authored structural information.

- One serialized queue owns all transitions for each machine instance. External events, invocation outcomes, retries that affect behavior, and child lifecycle outcomes re-enter through this ordering boundary.

- Event values outside the machine event union are rejected by TypeScript or Schema decoding. An event in the union that is not accepted by the live state is a protocol defect, not a typed application failure.

- `can(event)` remains an observational helper. Expected late or irrelevant events must be declared explicitly rather than silently ignored.

- Typed failures from invoked work are expected application outcomes and follow declared failure transitions. Defects terminate the machine and remain visible through the completion Effect's Cause.

- Consumers use standard Effect sandboxing or supervision when they deliberately want to handle machine defects. Defects do not become ordinary machine states by default.

- Entering an invoked node starts its named Effect in state-owned scope. Leaving interrupts the Effect, including Schedule sleeps; stale completion messages are rejected using invocation identity/generation.

- Operational retry accepts a native Effect Schedule plus a stable name and optional description. Static tooling shows authored metadata; runtime inspection reports actual attempts and delays.

- Modeled retry is used when attempts change state data, accepted events, or visible behavior. Such retry progress becomes explicit machine behavior rather than remaining an operational detail.

- `Machine.run` is a scoped Effect whose environment is inferred from invoked Effects, Schedules, and children. It creates no global runtime and performs no Promise conversion.

- The machine handle exposes Effect-valued `snapshot`, `send`, `can`, and `completion`, plus a Stream of state `changes`. Applications may wrap the handle in their own Effect service and Layer.

- A final state is the completion value. Final tags determine the completion union; a machine with no final nodes has completion type `never`.

- Reaching a final state atomically commits the final snapshot, interrupts active invocations and children, resolves completion, ends the change Stream, and makes later sends protocol defects.

- V0 behavioral composition is a statically declared child machine invoked by a visible parent state. Its lifetime is owned by that state's Scope.

- The minimal child protocol contains Schema-described input, explicitly forwarded child events, and the child's final-state completion value. V0 has no global addressing or arbitrary intermediate child emissions.

- Child requirements contribute transitively to the parent definition and are provided only by the composition root. Machine definitions never select service implementations or secretly construct Layers.

- A child declaration has a stable authored invocation name. Each execution receives a generated instance ID for inspection correlation.

- Whole-definition invariants are enforced through types where practical and construction-time validation otherwise. Duplicate state tags, absent initial states, nonexistent targets, and inconsistent declared targets cannot produce a runnable definition.

- Inspection reports semantic interpreter events: machine lifecycle, event receipt, selected branches, state transitions, invocation/retry lifecycle, child lifecycle, completion, and defects. It does not expose raw fiber internals.

- Inspection is metadata-only by default: tags, names, relationships, IDs, and timing. Full values require explicit local opt-in or a user-provided projection.

- The core exposes stable definition metadata and a structured inspection contract. Devtools remain dependency-isolated: core never imports them, even if core and tooling are distributed as separate entry points of one package.

- Tooling first derives a small renderer-independent graph model. Mermaid is the initial renderer. Large interactive graphs, partial selection, and React Flow remain future consumers of that model.

- A standalone devtools application is development infrastructure, not an application framework binding. It may use any suitable UI technology internally.

- The library publishes no React, Vue, Effect Atom, or other framework binding. Existing Effect integrations consume the machine's Effects directly.

- The v0 reference application is a headless single-document local-first workflow covering opening, editing, saving, offline operational retry, conflict resolution through one statically declared child, cancellation, typed failures, and snapshot encoding.

- Capability admission is evidence-driven. Focused executable fixtures or an unavoidable reference-application need must justify each semantic feature.

## Testing Decisions

- Tests exercise external behavior through one conceptual machine-definition seam with two independently imported public surfaces: runtime execution and static graph projection.

- Runtime acceptance tests construct definitions through the public builder, run them with public APIs, provide test Layers and `TestClock`, send events, and observe the machine handle and inspection Stream.

- Static tooling tests pass those same definitions into the graph-model projector without running them or providing Effect dependencies.

- Tests do not directly assert Queue operations, FiberMap usage, generation counters, internal envelopes, or private reducer wrappers. Those details are replaceable interpreter implementation.

- Compile-time tests verify state/event narrowing, builder target constraints, final-state completion inference, transitive Effect requirements, child protocol types, and rejection of invalid event/target vocabulary.

- Construction tests verify duplicate-state, absent-initial-state, nonexistent-target, and other whole-definition failures that TypeScript cannot prevent.

- State-transition tests verify accepted events, ordered guards, fallbacks, no-match defects, pure reducer results, explicit ignored events, and incompatible-live-state defects.

- Invocation tests verify typed success and failure routing, state-exit interruption, ignored stale completions, service requirement inference, and defect propagation through completion.

- Retry tests use native Effect Schedules and `TestClock` to verify attempts, delays, cancellation during sleep, inspection metadata, exhaustion, and the distinction between operational and modeled retry.

- Completion tests verify atomic final-state commit, inferred final output, cancellation of active work, termination of the change Stream, retained final snapshot, and post-completion protocol defects.

- Child tests verify state-bound child Scope, input, explicitly forwarded events, completion routing, transitive service requirements, cancellation on parent exit, stable definition identity, and unique runtime instance identity.

- Inspection tests assert semantic event ordering and metadata while confirming that payload values are absent unless an explicit projection is configured.

- Schema boundary tests verify input/state/event encoding and decoding separately from machine execution, including that codec-only requirements do not leak into `Machine.run`.

- Graph-model tests assert states, transitions, ordered branch metadata, descriptions, named Effects, retry summaries, final nodes, and child links structurally. Mermaid tests use small focused snapshots rather than one enormous diagram.

- The headless local-first document workflow is the end-to-end acceptance suite. It uses deterministic Layers and clocks and validates both runtime traces and graph output from the same definition.

- The existing todo prototype provides prior art for inferred Effect requirements, Layer swapping, serialized events, typed failure routing, interruption, state streaming, and devtools isolation. It is evidence, not production test code.

- Every new semantic feature must arrive with focused capability evidence and, when relevant, a reference-application scenario demonstrating why existing semantics are insufficient.

## Out of Scope

- XState feature parity or compatibility.

- A bidirectional or graph-first visual editor.

- Non-developer visual programming as a product goal.

- React, Vue, Effect Atom, or other application-framework bindings.

- Promise-based machine APIs or core-owned `ManagedRuntime` instances.

- Automatic persistence, durable execution, replay, snapshot migration, or schema-evolution policy.

- Effect Workflow integration or a second durable-workflow engine.

- Revalidating every internal event and reducer-produced state.

- Effectful guards or service access during guard evaluation.

- Entry actions, exit actions, effectful transition actions, or hidden side effects in reducers.

- Converting defects into ordinary machine states by default.

- Hierarchical/compound state semantics in v0.

- Parallel-region macrostep semantics in v0.

- Dynamic child spawning, global actor registries, peer addressing, or arbitrary actor systems in v0.

- Arbitrary intermediate child-to-parent emissions in v0.

- Multiple documents or data-driven child cardinality in the first reference application.

- Arrays of independently meaningful concurrent operations hidden inside one state node.

- A React Flow viewer, large-graph UI, or partial-graph selection in v0.

- Treating Mermaid as the long-term graph data model.

- Introspecting executable guards, reducers, Effects, service implementations, or Schedule internals.

- Reusing Effect Match as the stored guarded-transition representation.

- Automatically admitting features because another state-machine library has them.

## Further Notes

- The current prototype pins `effect@4.0.0-beta.106`. Implementation should confirm the current Effect beta APIs before establishing the published compatibility range.

- Research confirms that native Effect Schedules are runtime policies rather than inspectable syntax trees. Names, descriptions, and runtime metadata are the honest tooling boundary.

- Research confirms that Effect Match is useful ergonomic prior art but erases authored pattern metadata before evaluation; the library needs its own graphable branch records.

- Research confirms that hierarchy, parallel regions, child invocation, and dynamic actors solve distinct problems. V0 selects only static, state-owned child invocation because the bounded reference workflow needs isolation and lifecycle rather than atomic orthogonal state or runtime-defined cardinality.

- Exact public builder syntax remains a focused API-prototype question. The required concepts and information locality are fixed; method names and object shapes are not.

- The exact convenience API for exhaustively branching tagged typed failures remains open. It must preserve graphable tag metadata and fall back honestly when TypeScript cannot prove arbitrary predicates exhaustive.

- The exact surface for modeled retry progress remains open. It must preserve the settled rule that behaviorally meaningful attempts become explicit state-machine behavior while retaining native Schedule execution.

- The exact placement of the inspection Stream and opt-in payload projector on the public runtime surface remains an API-prototype question.

- The library/package name has not been selected.

- The next workflow step is to turn this spec into dependency-aware implementation tickets. API questions called out above should become small prototype tickets rather than speculative production implementation.
