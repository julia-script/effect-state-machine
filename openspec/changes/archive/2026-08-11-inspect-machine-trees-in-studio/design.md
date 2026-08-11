## Context

`Machine.run` currently creates an inspection log, state stream, and dispatch inbox for one machine. A child-state interpreter recursively calls `run`, keeps the returned child handle private, and projects only child lifecycle events into the parent's inspection log. Consequently, Studio Client can observe the root's state and inspection records but cannot observe or address the child handle.

The definition graph already contains child graphs recursively, while the Studio protocol and UI normalize one announcement, one graph, one state history, and one dispatch target per session. Merging independently observed handles in Studio Client would not establish an authoritative order between parent and child records. The runtime must therefore establish tree identity and ordering before records reach Studio Client.

Machine state and event types differ between descendants and are existential from the root's TypeScript type. Any tree-level API must erase those types at one controlled interpreter boundary while preserving each definition's schemas for encoding, decoding, and validation.

## Goals / Non-Goals

**Goals:**

- Establish one authoritative execution tree and ordered journal for a root machine and all descendants.
- Preserve existing machine ownership, cancellation, completion, and defect semantics.
- Keep existing per-machine typed operations available while adding an inspection-oriented tree capability to the root handle.
- Give Studio Client enough runtime routing and definition metadata to encode every actor's facts and dispatch to any live actor.
- Model global time travel without copying the complete state of every actor at every timeline position.
- Render a stable, fully expanded structural graph whether or not each child definition currently has a live actor.

**Non-Goals:**

- Collapsing inactive machines, automatically expanding on activation, or focusing the map on one actor.
- Changing the rule that the current runtime owns at most one active child for a machine actor.
- Supporting recursive definition graphs that cannot already be serialized by `Graph.fromDefinition`.
- Persisting sessions outside the existing in-memory relay and client buffering lifecycle.
- Providing compatibility between the old and new wire-protocol versions.

## Decisions

### 1. A session represents one root execution tree

Studio Client creates one session identifier for the attached root. Root and descendant actors retain that session identifier, and `actorId` selects a runtime machine instance inside it.

The root session ends when the attachment ends. A descendant terminating changes actor state and history but does not end the session. A root with no children is the degenerate one-actor case and follows the same model.

**Alternative considered: one linked session per child.** This would reuse more of the current viewer model, but it fragments causal history, makes global time travel artificial, and does not satisfy the complete-system view.

### 2. The root runtime owns shared tree infrastructure

The public `run` operation creates an internal tree runtime and delegates to an internal actor runner. Recursive child runs receive the same tree runtime plus their parent actor identity and structural definition path.

The tree runtime owns:

- A monotonic actor-ID allocator.
- An atomic journal sequence and append operation.
- A replayable journal retained from root start.
- A registry of currently live actor dispatch adapters.
- Root actor identity and actor lifecycle metadata.

Journal append atomically allocates the next sequence and stores the record. This append point defines order for concurrent fibers. Parent-child causal operations must append in semantic order: actor start before actor facts, event-forwarding before resulting child processing, actor terminal after its final machine fact, and child terminal before the parent's completion handling.

**Alternative considered: merge each handle's inspection stream in Studio Client.** Independent streams have no trustworthy relative ordering and can race during child start and termination, so a downstream merge cannot reconstruct causality.

### 3. Tree records combine actor lifecycle with machine facts and state snapshots

Each journal record contains:

```ts
interface TreeRecord {
  readonly sequence: number
  readonly actorId: string
  readonly definitionPath: string
  readonly body: TreeRecordBody
}
```

`TreeRecordBody` distinguishes actor start, existing machine inspection metadata, state snapshot, and actor terminal records. Actor start carries `parentActorId`, invocation/state ownership, machine definition ID, and runtime instance ID. Actor terminal carries completion, cancellation, or defect status.

Initial and committed state values are appended inside the runtime rather than observed later through each actor's state stream. This places state snapshots in the same sequence as inspection and lifecycle records. Values remain application-local unknown values in the core journal; Studio Client encodes them with the schema for `definitionPath` before they cross the wire. Event payloads use the same controlled erasure and encoding boundary.

Existing parent-level `ChildStarted`, `ChildEventForwarded`, `ChildCompleted`, `ChildCancelled`, and `ChildDefected` inspection metadata remains. Those records explain the parent's semantic step, while actor lifecycle records establish tree membership and bound the child's own facts.

**Alternative considered: derive state facts from actor state streams.** That reproduces the current root attachment pattern but loses ordering relative to inspection and actor lifecycle records.

### 4. The root handle exposes replay and actor-targeted routing

The root handle gains an inspection-oriented tree view containing the root actor ID, replayable tree journal, and actor-targeted event delivery. Existing typed root operations and local inspection remain available.

The live registry stores a type-erased adapter created at the interpreter boundary for each actor. An adapter closes over the actor's typed inbox and acceptance logic but exposes an unknown event input to the tree router. Studio Client first finds the actor's definition path and decodes custom JSON with that definition's event schema; only the decoded value reaches the adapter. Unknown and terminated actor IDs fail before delivery.

Quick events are registered by structural definition path. Their factories remain in the application and return values decoded or validated against that definition before routing to the selected actor.

**Alternative considered: expose every child `MachineHandle` publicly.** Heterogeneous child types require existential wrappers anyway, and exposing handles would leak ownership and lifecycle details that Studio only needs as replay and dispatch capabilities.

### 5. Structural definition paths namespace the announced system

The announcement builder recursively walks the root definition and creates a definition registry. Each entry contains machine metadata, graph, state and event schemas, invocation outcome schemas, quick-event metadata, and child-definition relationships.

Entries are keyed by a structural definition path derived from the parent path and child invocation site, not solely by machine ID. This keeps repeated state/event tags and reuse of one machine definition at multiple invocation sites unambiguous. Runtime actors reference the path they instantiate. Successive actors at one invocation site share the path but have different actor IDs.

The current runtime permits at most one live actor for a structural path within one root tree. If future runtime semantics allow multiple concurrent actors at the same path, the UI will need instance-specific graph overlays; that expansion is outside this change.

**Alternative considered: key definitions only by machine ID.** Machine IDs describe definitions but do not disambiguate repeated placement of the same definition within the root structure.

### 6. Protocol version 2 carries an actor-addressed fact stream

The protocol version is incremented. `Hello` describes the root session and definition registry. Every `Fact` carries the core-assigned session sequence, actor ID, definition path, and encoded body. Repeating the definition path on facts keeps retained facts interpretable even when bounded buffering drops an actor's start record.

`Dispatch` adds `actorId`; the application resolves the actor's current definition path before interpreting the command. Dispatch outcomes retain correlation IDs and add unknown-actor and actor-ended failure distinctions where needed.

Truncation reports include the dropped sequence range as well as count. The server relay continues to route and replay messages by session ID; it does not interpret the actor tree, but its protocol codec and version checks change with the message schema.

**Alternative considered: dynamically announce a child definition when its actor starts.** All reachable child definitions are already static definition metadata. Including them in the initial announcement preserves the self-describing first-message contract and lets Studio render inactive child graphs.

### 7. Studio Client performs one projection and one buffering pass

Attachment sends one `Hello`, consumes the root tree journal, encodes each record using its definition registry entry, and appends the resulting fact to one sequence-preserving buffer. Reconnect replays this buffer unchanged; Studio Client does not invent another sequence.

Dispatch handling resolves the session actor and definition path, evaluates definition-scoped quick-event factories or decodes custom JSON, checks acceptance through the tree handle, and routes the event. Attachment shutdown stops projection and transport fibers but does not close the machine tree.

### 8. Studio history stores one timeline plus per-actor indexes

The history reducer stores raw facts and semantic steps in session sequence order. Each step carries `actorId`, `definitionPath`, and relationship depth. Actor indexes retain lifecycle bounds and that actor's state positions.

At a global cursor, Studio determines actor existence from start and terminal sequences and finds each actor's latest state snapshot at or before the cursor. This reconstructs the displayed tree without materializing a full actor-state vector for every step. State diffs search the previous snapshot for the same actor, never the previous global snapshot.

Parent child-lifecycle steps and the child's own steps remain separate causal entries. Correlation by actor ID prevents duplicate machine steps while preserving both the parent's ownership action and the child's internal execution.

**Alternative considered: snapshot every actor at every semantic step.** Lookup would be simpler, but memory grows with timeline length multiplied by actor count and repeats mostly unchanged state.

### 9. The behavior map is one statically composed nested graph

Studio composes the definition registry into a namespaced graph before layout. Node and edge IDs include `definitionPath`. A child invocation node acts as a compound container for the child definition graph, recursively. Initial implementation renders every container expanded, including definitions with no live actor.

Layout uses compound hierarchy so child internals remain visually owned by the invocation site. Actor lifecycle and state indexes provide active overlays: each live actor highlights its state inside its definition path; inactive paths remain visible without an active state. Selection carries definition path plus local node or edge identity so detail cards and schemas cannot resolve against the wrong machine.

Depth filtering, when selected, computes the union of neighborhoods around every active actor state. Show-all remains the default and is the primary supported presentation for this change.

**Alternative considered: create a separate graph canvas per actor.** This avoids compound layout but again fragments the system and prevents seeing cross-machine causality in one view.

## Risks / Trade-offs

- **Shared journal append becomes a cross-actor coordination point** -> Keep append atomic and minimal; schema encoding, wire conversion, and history folding remain downstream.
- **The replayable aggregate journal grows for the root lifetime** -> This matches current retained inspection semantics and aggregates records that would otherwise live in separate logs; preserve bounded wire buffering and document truncation independently.
- **Type erasure could route an event through the wrong schema** -> Bind every live adapter to an immutable actor ID and definition path, decode before routing, and keep the unknown-to-typed cast at the interpreter-owned adapter boundary.
- **Large nested definitions can produce an unreadable or expensive graph** -> Use compound layout and stable structural IDs now; automatic collapse and focus controls are the planned follow-up.
- **Truncated buffers can remove actor lifecycle context** -> Repeat actor ID and definition path on every fact and report exact dropped sequence ranges.
- **Protocol version 2 breaks mixed-version installations** -> Reject incompatible peers explicitly and release core client, relay, and viewer changes together.
- **Parent lifecycle and child-internal facts can appear duplicative** -> Preserve both because they answer different questions, and correlate them by actor ID in semantic history.

## Migration Plan

1. Add the internal tree runtime, actor journal, state records, live registry, and root-handle tree API while preserving existing typed handle behavior.
2. Add actor-tree fixtures covering nested start, forwarding, state commits, completion, cancellation, defect, replay, and targeted dispatch.
3. Introduce protocol version 2 schemas and codecs, then update Studio Client projection, buffering, and dispatch routing.
4. Update relay acceptance and replay for version 2 while keeping actor payloads opaque to relay logic.
5. Replace Studio's single-actor history model with the global timeline and actor indexes.
6. Compose and render nested definition graphs, then connect actor overlays, selection, state diffing, history, and dispatch controls.
7. Remove version 1 protocol fixtures after all packages use version 2. Rollback requires reverting core, Studio Client, relay, and viewer together because mixed protocol versions are intentionally rejected.
