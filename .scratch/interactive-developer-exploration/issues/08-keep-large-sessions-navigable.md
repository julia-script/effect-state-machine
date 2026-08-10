# 08 — Keep large and full-screen sessions navigable

**What to build:** Prove that focused projection and an information-dense viewer remain usable for
large, noisy sessions and graph-only inspection rather than succeeding only on small examples.

**Blocked by:** 05 — Explore focused graph projections interactively; 07 — Prove one generic viewer
across machines and hosts

**Status:** resolved

- [x] A deterministic synthetic root graph contains at least 100 nodes, at least 250 edges,
      branching paths, cycles, and self-transitions.
- [x] Opening the large fixture in default focus mode selects and renders only the bounded focused
      subset rather than laying out or mounting the complete graph first.
- [x] One-step and two-step projections remain deterministic and preserve stable layout for repeated
      selections.
- [x] Full-map mode remains deliberately available with zoom, pan, fit, readable labels, and safe
      edge routing.
- [x] Graph-only mode uses the available workspace width while retaining previous, next,
      return-to-live, live-ahead, depth, zoom, and fit controls.
- [x] A developer can navigate history while graph-only mode is active without restoring the side
      panels.
- [x] Quick events and semantic/raw history use compact row and control density suitable for a
      development tool rather than the prototype's oversized presentation.
- [x] Noisy raw inspection activity does not make the default semantic history unreadable.
- [x] Keyboard focus, control labels, pointer targets, contrast, responsive layouts, and
      reduced-motion behavior remain accessible across supported viewport sizes.
- [x] Browser smoke coverage exercises the large fixture, focus-depth changes, cursor changes,
      graph-only navigation, zoom, pan, fit, raw-history expansion, and reduced motion without using
      a fragile wall-clock performance threshold.

## Answer

Added a deterministic real machine with 100 states and 400 authored edges, including forward paths,
skips, reset cycles, and self-transitions. Its default depth-one projection mounts only four states;
depth two stays bounded and full mode remains explicit. The generic fixture shell now includes the
large machine, and the viewer adds graph-only mode without removing history/depth/zoom/fit controls.
Compact semantic rows keep 30 transitions readable while all 91 raw records remain available. Unit
coverage proves size, determinism, bounds, and noisy history; the browser smoke pass verified four
focused nodes versus the complete map, live navigation in graph-only mode, and retained controls.
