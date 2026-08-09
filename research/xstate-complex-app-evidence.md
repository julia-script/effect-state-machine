# What XState uses as evidence for complex applications

Research snapshot: **2026-08-09**. Sources are limited to current first-party Stately/XState documentation, examples, and repositories. XState repository links are pinned to commit [`d146eaa`](https://github.com/statelyai/xstate/commit/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a) where the exact source matters.

## Conclusion

XState does **not** appear to use one flagship complex application as its primary proof. Its evidence has three layers:

1. Small browser examples prove basic machine and framework ergonomics.
2. A broad catalog of executable backend workflows proves individual orchestration capabilities.
3. A few larger educational applications show several capabilities composed together.

The official claims that XState handles “complex application logic” and “scales to any level of complexity” are positioning statements, not runnable evidence by themselves. The stronger evidence is the source and run instructions behind the examples. [XState README](https://github.com/statelyai/xstate#readme), [Stately/XState docs](https://stately.ai/docs)

## Evidence inventory

| Evidence | What it demonstrates | Strength and limitation |
| --- | --- | --- |
| **Browser examples:** fetch, 7GUIs, stopwatch, tic-tac-toe, tiles, TodoMVC, toggle | Events, context, guards, async work, and framework consumption | Many have CodeSandbox links, so they are genuinely runnable. They are teaching-scale, however; TodoMVC in particular is poor evidence for complex state topology. [Official examples catalog](https://stately.ai/docs/examples) |
| **25 CNCF-inspired server workflows** | Parallel execution, async subflows, polling, error routing, event accumulation, timeouts, schedules, retries, repeats, and final states | This is XState's strongest systematic breadth evidence. Each example is narrow, so the catalog proves capability coverage more than whole-application coherence. Stately explicitly presents the set as ranging from simple machines to more complex workflows. [Announcement](https://stately.ai/blog/2023-06-20-serverside-workflow-examples), [repository examples](https://github.com/statelyai/xstate/tree/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples) |
| **MongoDB credit-check API** | Express workflow instances, state hydration, hierarchy, a three-way parallel fan-out and join, invoked actors, guards, failures, final states, and descriptions | Probably the strongest integrated example in the core repository. It requires MongoDB and explicitly says it is educational and not production-ready. [README](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/mongodb-credit-check-api/README.md), [machine](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/mongodb-credit-check-api/machine.ts) |
| **Media-scanner workflow** | A long-running I/O pipeline, injected input, named invoked operations, result batching, error reporting, restart recovery, and extensive state descriptions | A coherent backend flow with visible recovery, but it is intentionally small and not production-ready. [README](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-media-scanner/README.md), [machine](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-media-scanner/src/mediaScannerMachine.ts) |
| **MongoDB persisted-state example** | Serializing/restoring actor snapshots across processes, with hierarchy and parallel regions in the restored machine | Strong focused evidence for persistence, but not a realistic domain application. [runtime](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/mongodb-persisted-state/main.ts), [machine](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/mongodb-persisted-state/donutMachine.ts) |
| **Trivia game** | Nested states, sequential async loads, named and composed guards, ordered branches, eventless transitions, and reset loops | The most substantial first-party frontend machine found, but still a bounded game rather than a long-lived application. [machine](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/trivia-game-example/src/triviaMachine.ts) |
| **`@statelyai/agent` examples** | Durable snapshot resume, human-in-the-loop pauses, typed child-machine composition, hierarchical teams, parallel analysts, bounded loops, and concurrent research workflows | The richest current composition evidence. The examples are explicitly runnable in real-model mode and tested with injected mocks, but the package is alpha and sits above core XState. [Official example index](https://stately.ai/docs/packages/agent/examples), [first-party repository](https://github.com/statelyai/agent/tree/91f0d0e3b91a502542426581572a71cea58a3088/examples) |

The core repository examples are standalone projects rather than members of the root pnpm workspace. They are executable source, but the root workspace test command is not itself evidence that all examples run continuously. [Workspace definition](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/pnpm-workspace.yaml), [example contribution/run convention](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/readme.md)

## Representative advanced capabilities

The server-workflow catalog is especially useful because its files isolate semantics cleanly:

- **Parallel work and joining:** two independently invoked branches reach final states before their parent completes. [Parallel workflow](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-parallel/main.ts)
- **Polling and time:** a delayed transition starts an async status check, ordered guarded eventless transitions choose success, failure, or another polling loop. [Monitor-job workflow](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-monitor-job/main.ts)
- **Typed-looking failure routing:** guarded `onError` branches select nested exception handlers, though errors are inspected through casts and message strings rather than a typed error channel. [Provision-orders workflow](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-provision-orders/main.ts)
- **Event accumulation:** independent events update context until a guarded eventless transition opens the finalization step. [College-application workflow](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-finalize-college-app/main.ts)
- **Nested workflows:** a parent invokes a complete onboarding child machine and waits for its final result. [Async-subflow workflow](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-async-subflow/main.ts)
- **Retries as operational detail:** the patient-onboarding example places a third-party Cockatiel retry policy inside each invoked Promise actor. The machine graphs that an onboarding step is running and whether it ultimately succeeds or fails, but not every retry attempt. [Patient-onboarding workflow](https://github.com/statelyai/xstate/blob/d146eaa1cd7112a289b8b9fffaf5cbb2489e859a/examples/workflow-new-patient-onboarding/main.ts)

That last example directly supports allowing an Effect `Schedule` to remain inside an invoked Effect while attaching a name or description to the policy. Retry attempts should become machine state only when their count changes user-visible behavior, accepted events, or business decisions.

## Lessons for our acceptance application

1. **Use a proof matrix, not one heroic demo.** Keep small deterministic fixtures for guards, schedules, cancellation, parallel work, persistence, and child composition. Add one integrated reference application that forces those features to coexist.
2. **Do not treat TodoMVC as complexity evidence.** It remains an excellent onboarding example, but the acceptance application should require concurrency, interruption, typed failure branching, retry policy, recovery, persistence/resume, and swappable Effect services.
3. **Keep the reference application framework-free.** XState's browser examples mainly prove adapter ergonomics. Our semantic proof should run entirely through Effects, Layers, `TestClock`, and transition traces; Atom or UI consumption is the user's concern.
4. **Make descriptions testable output.** The media-scanner example demonstrates that descriptions belong in real machine code. Our acceptance criteria should verify that named guards, retry policies, states, and operations remain understandable in both code and the generated read-only graph.
5. **Prefer a domain with visible operational stress.** A local-first document editor is a strong candidate: editing and autosave, offline queuing, sync conflicts, cancellation, retry schedules, crash/restart, and concurrent per-document work. A headless media-processing or order workflow is the simpler alternative if deterministic integration tests matter more than user-facing state.
6. **Require stronger evidence than the example catalog provides.** Every reference scenario should have deterministic tests with injected Layers and clocks, plus graph snapshots. Runnable demos show plausibility; executable acceptance tests protect the library's promise.

The most useful pattern to borrow from XState is therefore **many focused executable capability examples plus one integrated, explicitly non-framework reference application**. The goal is not to copy its feature catalog, but to make our claim of supporting complex applications inspectable and falsifiable.
