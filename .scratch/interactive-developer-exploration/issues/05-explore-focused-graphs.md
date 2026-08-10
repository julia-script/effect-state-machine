# 05 — Explore focused graph projections interactively

**What to build:** Give a developer a stable, navigable graph centered on the snapshot selected by
the history cursor, with one-step, two-step, and full root-machine views.

**Blocked by:** 03 — Navigate history while live execution continues

**Status:** resolved

- [x] A public renderer-independent projection derives focused graphs from the existing graph model
      without running a machine or mutating definition metadata.
- [x] Depth one includes the selected state and its direct outgoing targets.
- [x] Depth two performs one additional outgoing traversal, and full mode returns the complete root
      graph.
- [x] Projection handles cycles with a visited set, preserves visible self-transitions, retains
      authored ordering and stable IDs, and includes only edges whose endpoints remain visible.
- [x] Existing child-invocation nodes remain atomic root-graph nodes; no child definition or runtime
      actor topology is expanded.
- [x] Activity overlay identifies the cursor's active state and visible traversed edges independently
      from topology projection.
- [x] The embedded viewer follows the history cursor when selecting the projection center and active
      overlay.
- [x] The graph canvas provides stable automatic layout, readable edge routing and labels, zoom,
      pointer pan, fit, and depth controls.
- [x] Highlighted paths communicate direction without obscuring labels, and reduced-motion settings
      preserve emphasis without continuous animation.
- [x] Unchanged topology retains stable positions while the cursor moves, protecting the developer's
      spatial memory.
- [x] Public projection tests cover depth modes, cycles, self-transitions, unreachable nodes, edge
      filtering, ordering, identity, and overlays through real machine definitions.

## Answer

The renderer-independent graph now assigns stable edge IDs and exposes pure `focus` and `activity`
projections. Focus uses bounded outgoing BFS for depths one and two, returns the original graph in full
mode, preserves authored ordering and self-transitions, and never expands child definitions. Sessions
center the projection and overlay on the history cursor. The embedded SVG canvas uses full-graph-stable
positions, labeled directed edges, active/traversed emphasis, reduced-motion-aware flow animation,
depth controls, zoom, pan, and fit. Projection and live-session tests cover cycles, unreachable nodes,
identity, filtering, cursor overlays, and all depth modes.
