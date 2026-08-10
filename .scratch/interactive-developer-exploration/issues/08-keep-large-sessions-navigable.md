# 08 — Keep large and full-screen sessions navigable

**What to build:** Prove that focused projection and an information-dense viewer remain usable for
large, noisy sessions and graph-only inspection rather than succeeding only on small examples.

**Blocked by:** 05 — Explore focused graph projections interactively; 07 — Prove one generic viewer
across machines and hosts

**Status:** ready-for-agent

- [ ] A deterministic synthetic root graph contains at least 100 nodes, at least 250 edges,
      branching paths, cycles, and self-transitions.
- [ ] Opening the large fixture in default focus mode selects and renders only the bounded focused
      subset rather than laying out or mounting the complete graph first.
- [ ] One-step and two-step projections remain deterministic and preserve stable layout for repeated
      selections.
- [ ] Full-map mode remains deliberately available with zoom, pan, fit, readable labels, and safe
      edge routing.
- [ ] Graph-only mode uses the available workspace width while retaining previous, next,
      return-to-live, live-ahead, depth, zoom, and fit controls.
- [ ] A developer can navigate history while graph-only mode is active without restoring the side
      panels.
- [ ] Quick events and semantic/raw history use compact row and control density suitable for a
      development tool rather than the prototype's oversized presentation.
- [ ] Noisy raw inspection activity does not make the default semantic history unreadable.
- [ ] Keyboard focus, control labels, pointer targets, contrast, responsive layouts, and
      reduced-motion behavior remain accessible across supported viewport sizes.
- [ ] Browser smoke coverage exercises the large fixture, focus-depth changes, cursor changes,
      graph-only navigation, zoom, pan, fit, raw-history expansion, and reduced motion without using
      a fragile wall-clock performance threshold.

