# 05 — Explore focused graph projections interactively

**What to build:** Give a developer a stable, navigable graph centered on the snapshot selected by
the history cursor, with one-step, two-step, and full root-machine views.

**Blocked by:** 03 — Navigate history while live execution continues

**Status:** ready-for-agent

- [ ] A public renderer-independent projection derives focused graphs from the existing graph model
      without running a machine or mutating definition metadata.
- [ ] Depth one includes the selected state and its direct outgoing targets.
- [ ] Depth two performs one additional outgoing traversal, and full mode returns the complete root
      graph.
- [ ] Projection handles cycles with a visited set, preserves visible self-transitions, retains
      authored ordering and stable IDs, and includes only edges whose endpoints remain visible.
- [ ] Existing child-invocation nodes remain atomic root-graph nodes; no child definition or runtime
      actor topology is expanded.
- [ ] Activity overlay identifies the cursor's active state and visible traversed edges independently
      from topology projection.
- [ ] The embedded viewer follows the history cursor when selecting the projection center and active
      overlay.
- [ ] The graph canvas provides stable automatic layout, readable edge routing and labels, zoom,
      pointer pan, fit, and depth controls.
- [ ] Highlighted paths communicate direction without obscuring labels, and reduced-motion settings
      preserve emphasis without continuous animation.
- [ ] Unchanged topology retains stable positions while the cursor moves, protecting the developer's
      spatial memory.
- [ ] Public projection tests cover depth modes, cycles, self-transitions, unreachable nodes, edge
      filtering, ordering, identity, and overlays through real machine definitions.

