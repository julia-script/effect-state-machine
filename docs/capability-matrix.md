# V0 capability evidence

Every semantic promise is backed by the integrated reference workflow or a focused executable
fixture. “Reference” means [`LocalFirstDocument.test.ts`](../tests/LocalFirstDocument.test.ts).

| Capability | Executable evidence |
| --- | --- |
| Schema-first input, state, events, pure initialization, and explicit codecs | Reference; `Completion.test.ts` |
| Tagged-union state narrowing and pure reducers | Reference; `Machine.test.ts` |
| Serialized events, protocol defects, `can`, and explicit ignores | `Machine.test.ts`; `Guard.test.ts` |
| Ordered named guards, first-match selection, fallback, and no-match defects | Reference; `Guard.test.ts` |
| Final-state completion, terminal snapshots, stream ending, and post-completion defects | Reference; `Completion.test.ts` |
| Named typed Effect invocation with Layer-selected implementations | Reference; `Invocation.test.ts` |
| Typed failures as declared outcomes and defects as completion `Cause` | Reference; `Invocation.test.ts` |
| State-owned cancellation and stale outcome rejection | Reference; `Invocation.test.ts` |
| Native Schedule retry, authored graph metadata, runtime attempts, and `TestClock` | Reference; `Retry.test.ts` |
| Explicit modeled retry when attempts change application behavior | `Retry.test.ts` |
| Static child input, forwarded events, inferred output, and transitive requirements | Reference; `Child.test.ts` |
| Child scope interruption, defects, repeated runtime IDs, and inspection correlation | Reference; `Child.test.ts` |
| Exhaustive shallow definitions, destination-field reducers, stays, and explicit re-entry | `Statechart.types.ts`; `Statechart.test.ts` |
| Entry-owned timers, stale-outcome guards, and single/all/race declared work | `Statechart.test.ts`; `Invocation.test.ts` |
| Compound and parallel regions, parent fallback, atomic macrosteps, and completion | `Statechart.test.ts` |
| Renderer-independent graph data, descriptions, branch order, retry summaries, and child links | Reference; `Graph.test.ts` |
| Region paths, timer edges, work lanes/concurrency, and statechart inspection metadata | `Statechart.test.ts`; `Protocol.test.ts` |
| Compact Mermaid rendering from the graph model | Reference; `Graph.test.ts` |
| Effect-native handle with no Promise, runtime, or framework binding | All runtime fixtures; API prototype check |
| Synchronously inspectable definitions that do not execute Effects | `Graph.test.ts`; API prototype check |
| Scoped one-root devtools session with metadata privacy and optional state projection | `DevToolsSession.test.ts` |
| Semantic/raw history, live-head and non-mutating cursor navigation | `DevToolsSession.test.ts` |
| Fixed and factory quick events with typed control failures | `DevToolsSession.test.ts` |
| Depth-one, depth-two, and full graph projections with stable activity overlays | `Graph.test.ts`; `LargeMachine.test.ts` |
| Automatic source capture, mapping, and Cursor/VS Code/custom links | `SourceLocation.test.ts` |
| Generic viewer across document, checkout, and large machines | `Checkout.test.ts`; `LargeMachine.test.ts`; browser smoke pass |
| Studio region grouping, active child emphasis, atomic edge highlighting, and work/timer history | `History.test.ts`; `Statecharts.test.ts`; `Studio.test.tsx` |
| Core, renderer-independent devtools, and optional DOM viewer package isolation | packed consumer check |

Nested parent-state hierarchy, dynamic spawning, durable persistence, replay, simulations, telemetry
correlation, and additional framework bindings have no v0 capability promise.
