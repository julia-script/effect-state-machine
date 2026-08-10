# 07 — Prove one generic viewer across machines and hosts

**What to build:** Demonstrate that the production session and viewer explain two meaningfully
different real machines through the same rendering and control code, both inside an application and
inside a standalone fixture shell.

**Blocked by:** 03 — Navigate history while live execution continues; 04 — Dispatch quick events
from devtools setup; 05 — Explore focused graph projections interactively; 06 — Jump automatically
from behavior to source code

**Status:** ready-for-agent

- [ ] The existing local-first document workflow runs through the generic public devtools session
      and viewer without workflow-specific rendering code.
- [ ] A real checkout-style machine built with the public library replaces the prototype's pure
      facsimile and covers browsing, cart updates, checkout, invoked order placement, expected
      payment failure, retry, and terminal success.
- [ ] Ordinary controls in each host application visibly advance the same graph and history observed
      by devtools.
- [ ] Both applications configure useful predefined and factory-backed quick events beside session
      setup.
- [ ] The same viewer components and session view model render both machines without branching on
      machine identity, event names, state names, or payload shapes.
- [ ] The viewer can be hosted as an embedded dock beside the live application.
- [ ] The same viewer can be hosted in a standalone development shell against a direct fixture
      session.
- [ ] The standalone shell does not introduce cross-tab, browser, Node, WebSocket, or remote
      transport semantics.
- [ ] Focus depth, semantic/raw history, cursor navigation, return to live, quick events, state
      projection, and source navigation work in both proof machines where applicable.
- [ ] Browser acceptance tests exercise both machines only through visible application and devtools
      controls and reject machine-specific viewer branches.

