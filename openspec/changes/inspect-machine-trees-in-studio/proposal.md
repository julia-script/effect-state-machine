## Why

Studio currently shows only the root machine's execution even though child-machine topology and lifecycle facts are available. Developers need one causal view of the entire running system so they can follow state changes, forwarded events, child completions, and nested behavior without switching between disconnected machine sessions.

## What Changes

- **BREAKING** Redefine a Studio session as one attached root-machine execution together with every descendant machine instance it owns, rather than one session per machine instance.
- Add stable runtime actor identities and parent-child relationships so every inspection fact identifies the machine instance that produced it.
- Record root and descendant facts in one globally ordered inspection journal, including actor start and termination boundaries.
- Announce every machine definition needed to render the execution tree, including each definition's graph and schemas.
- Attach Studio Client once at the root and capture, buffer, replay, and route dispatches for the entire machine tree.
- Render all machine graphs expanded in one Studio view and present one causally ordered history across the complete actor tree.
- Target dispatches at an actor within the root session.
- Keep automatic collapsing of inactive machines, activation-driven expansion, and focused/collapsed navigation out of scope for this change; the initial view shows the complete expanded system.

## Capabilities

### New Capabilities

- `machine-tree-inspection`: Defines runtime actor identity, parent-child lifecycle, and globally ordered inspection of a root machine and all descendants.

### Modified Capabilities

- `studio-client`: Changes attachment, buffering, and dispatch handling from one machine handle to the complete tree owned by an attached root.
- `studio-protocol`: Changes session identity from one machine instance to one root execution and adds actor-addressed definitions, facts, lifecycle, and dispatches.
- `studio-ui`: Changes graph, history, state, and dispatch presentation to cover all actors in one expanded system view.

## Impact

- Core machine runtime and public handle inspection APIs must expose a shared tree journal without changing machine execution semantics.
- Studio Client announcement, buffering, replay, and dispatch routing must become actor-aware.
- The wire protocol requires a version increment and coordinated client, relay, and viewer updates.
- Studio's world model, history reducer, graph layout, state selection, event controls, and detail panels must support multiple actor instances in one session.
- Existing single-machine sessions remain a valid one-actor tree, but older clients and Studio versions will be rejected through the existing protocol-version mechanism.
