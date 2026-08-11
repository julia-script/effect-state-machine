## 1. Core Actor Tree

- [x] 1.1 Define opaque actor IDs, structural definition paths, tree record bodies, sequenced records, lifecycle metadata, and the root tree-handle API.
- [x] 1.2 Add an internal tree runtime with atomic actor allocation, journal append, replay storage, and a live actor registry.
- [x] 1.3 Refactor root and recursive child execution to share the tree runtime while preserving existing typed handle and ownership behavior.
- [x] 1.4 Append actor start, initial and committed state, inspection, completion, cancellation, and defect records in causal order.
- [x] 1.5 Add type-erased live actor adapters and actor-targeted event routing with unknown, ended, and unaccepted failures.
- [x] 1.6 Cover root-only, nested, repeated-child, forwarded-event, completion, cancellation, defect, late-inspection, and targeted-dispatch behavior in core tests.

## 2. Definition Registry and Protocol

- [x] 2.1 Build a recursive structural definition registry containing namespaced graphs, schemas, invocation outcomes, quick-event metadata, and child relationships.
- [x] 2.2 Introduce protocol version 2 announcement schemas for one root session, root actor identity, and the complete definition registry.
- [x] 2.3 Add actor ID, definition path, and tree sequence to fact schemas, including actor lifecycle and encoded state records.
- [x] 2.4 Add actor-targeted dispatch, unknown-actor and ended-actor outcomes, and dropped sequence ranges to protocol schemas.
- [x] 2.5 Update wire encoders, decoders, fixtures, and protocol round-trip tests for nested definitions and actor-addressed messages.

## 3. Studio Client Tree Attachment

- [x] 3.1 Change announcement construction to emit one self-describing root-session hello from the structural definition registry.
- [x] 3.2 Project the root tree journal into encoded protocol facts using each record's definition path and preserve the core sequence unchanged.
- [x] 3.3 Buffer and replay the single tree fact stream across reconnects, reporting dropped sequence ranges when bounded retention truncates history.
- [x] 3.4 Resolve definition-scoped quick events and custom event schemas, then route accepted dispatches to the addressed live actor.
- [x] 3.5 Extend in-memory client tests for late Studio connection, nested fact replay, disconnects with interleaved actors, child dispatch, and attachment release.

## 4. Studio Relay

- [x] 4.1 Update relay protocol acceptance and replay fixtures for version 2 while continuing to isolate and route traffic by root session ID.
- [x] 4.2 Verify actor-addressed dispatches remain opaque to the relay and reach only the application connection that owns the root session.
- [x] 4.3 Cover incompatible-version rejection without disturbing other root sessions.

## 5. Global History and Time Travel

- [x] 5.1 Replace the single-actor history model with a session timeline, actor lifecycle index, per-actor state positions, and relationship depth.
- [x] 5.2 Fold parent lifecycle and descendant inspection facts into actor-qualified semantic steps without duplicating child-internal execution steps.
- [x] 5.3 Reconstruct live actors and each actor's latest state at a global cursor, including cursors before actor start and after actor termination.
- [x] 5.4 Compute state diffs and event details against the selected actor's definition and previous actor-local snapshot.
- [x] 5.5 Update viewer session state so one hello creates one root session and descendant lifecycle changes update that session rather than the picker.
- [x] 5.6 Add reducer tests for interleaved parent/child causality, actor-local diffs, global cursor stability, truncation, and returning to live.

## 6. Expanded System Graph

- [x] 6.1 Compose the definition registry into one graph with structural-path-qualified node and edge IDs and child invocation containers.
- [x] 6.2 Extend graph layout to place nested machine graphs as compound children of their invocation sites with stable positions.
- [x] 6.3 Render every nested definition expanded by default, including inactive definitions and their initial markers.
- [x] 6.4 Overlay every live actor's active state and the selected actor step's traversed edge without clearing highlights in other machines.
- [x] 6.5 Update show-all, bounded-depth, zoom, fit, and JSON views to operate on the composed graph.
- [x] 6.6 Add graph transformation and rendering coverage for repeated tags, reused definitions at different paths, multiple nesting levels, and inactive children.

## 7. Actor-Aware Studio Controls

- [x] 7.1 Carry definition path and actor identity through graph selection, history selection, and displayed cursor state.
- [x] 7.2 Update detail cards and source links to resolve node, event, transition, and schema metadata from the selected definition path.
- [x] 7.3 Update the state panel to show the selected actor's historical state, actor-local diff, event payload, and lifecycle status.
- [x] 7.4 Update quick and custom event controls to use the selected live actor's definition, availability, and actor-targeted dispatch.
- [x] 7.5 Update the session bar and history panel to show root-session status, descendant counts, actor identity, and relationship depth.
- [x] 7.6 Disable actor dispatch while time-traveling or after termination and surface actor-specific failures without losing custom-event drafts.

## 8. End-to-End Integration

- [x] 8.1 Add a representative root, child, and grandchild fixture with forwarded events, child dispatch, completion, cancellation, and defects.
- [x] 8.2 Exercise the fixture through core, Studio Client, relay, and viewer to verify one session, one ordered timeline, and the complete expanded graph.
- [x] 8.3 Verify a root-only machine still behaves as a one-actor tree across announcement, history, state, and dispatch.
- [x] 8.4 Remove version 1-only fixtures and update public Studio Client and protocol documentation for root sessions and actor targeting.
