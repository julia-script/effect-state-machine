# 09 — Ship the isolated Milestone 2 devtools surfaces

**What to build:** Package and document the completed session and viewer boundaries so an Effect
developer can install the library, attach devtools to a real machine, and verify that production core
imports remain free of development tooling.

**Blocked by:** 02 — Derive semantic history from real machine activity; 03 — Navigate history while
live execution continues; 04 — Dispatch quick events from devtools setup; 05 — Explore focused graph
projections interactively; 06 — Jump automatically from behavior to source code; 07 — Prove one
generic viewer across machines and hosts; 08 — Keep large and full-screen sessions navigable

**Status:** ready-for-agent

- [ ] Public package entry points preserve distinct core, renderer-independent devtools, and optional
      viewer dependency boundaries.
- [ ] Core imports do not evaluate or bundle session, Mermaid, source-map, editor, layout,
      graph-canvas, UI-framework, or viewer modules.
- [ ] Renderer-independent devtools imports do not evaluate or bundle the optional viewer, layout,
      graph-canvas, or UI-framework modules.
- [ ] Generated declarations expose the documented Effect-native session, history, quick-event,
      graph-projection, source-location, and editor-resolver contracts.
- [ ] The package remains ESM and side-effect-free, and source maps and declarations are generated
      for every published library entry point.
- [ ] The throwaway scenario-viewer prototype remains evidence and is excluded from published
      library artifacts.
- [ ] User documentation explains installation, session setup, embedded viewing, quick events,
      history cursor versus live head, state projection, focus depth, source navigation, and
      metadata/privacy defaults.
- [ ] Documentation explicitly distinguishes historical inspection from replay or undo and lists
      named paths, simulations, child topology, transports, persistence, and telemetry as excluded.
- [ ] A clean temporary pnpm consumer installs the packed artifact, runs a real machine, attaches a
      session, dispatches a quick event, observes history, projects a focused graph, and type-checks
      without repository source access.
- [ ] Bundle-metafile inspection proves core and renderer-independent dependency isolation from the
      clean consumer's perspective.
- [ ] Compatibility with the pinned Effect beta and supported TypeScript/toolchain versions is
      explicit and verified.
- [ ] Formatting, type checking, declaration generation, package verification, semantic tests,
      proof-machine tests, large-fixture checks, and browser acceptance all pass from a clean install.
- [ ] Capability documentation and the project roadmap reflect the shipped behavior and retain
      deferred work in later milestones rather than silently expanding Milestone 2.
