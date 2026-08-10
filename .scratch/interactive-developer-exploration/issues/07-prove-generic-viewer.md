# 07 — Prove one generic viewer across machines and hosts

**What to build:** Demonstrate that the production session and viewer explain two meaningfully
different real machines through the same rendering and control code, both inside an application and
inside a standalone fixture shell.

**Blocked by:** 03 — Navigate history while live execution continues; 04 — Dispatch quick events
from devtools setup; 05 — Explore focused graph projections interactively; 06 — Jump automatically
from behavior to source code

**Status:** resolved

- [x] The existing local-first document workflow runs through the generic public devtools session
      and viewer without workflow-specific rendering code.
- [x] A real checkout-style machine built with the public library replaces the prototype's pure
      facsimile and covers browsing, cart updates, checkout, invoked order placement, expected
      payment failure, retry, and terminal success.
- [x] Ordinary controls in each host application visibly advance the same graph and history observed
      by devtools.
- [x] Both applications configure useful predefined and factory-backed quick events beside session
      setup.
- [x] The same viewer components and session view model render both machines without branching on
      machine identity, event names, state names, or payload shapes.
- [x] The viewer can be hosted as an embedded dock beside the live application.
- [x] The same viewer can be hosted in a standalone development shell against a direct fixture
      session.
- [x] The standalone shell does not introduce cross-tab, browser, Node, WebSocket, or remote
      transport semantics.
- [x] Focus depth, semantic/raw history, cursor navigation, return to live, quick events, state
      projection, and source navigation work in both proof machines where applicable.
- [x] Browser acceptance tests exercise both machines only through visible application and devtools
      controls and reject machine-specific viewer branches.

## Answer

Added a real Schema-first checkout machine with an injected `Orders` service, expected
`PaymentDeclined` failure, explicit retry, and terminal success. A compact production proof page now
hosts either checkout or the existing local-first document machine while mounting exactly the same
generic session/viewer code. Both hosts expose ordinary application controls and configure fixed and
factory quick events; `?mode=standalone` removes the host panel without introducing transport. Public
acceptance tests cover the checkout lifecycle, and an in-browser acceptance pass exercised both
fixtures, host controls, quick controls, semantic history, historical navigation, and terminal state.
