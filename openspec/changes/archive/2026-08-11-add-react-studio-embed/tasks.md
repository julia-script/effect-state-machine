## 1. Direct Transport Foundation

- [x] 1.1 Add a scoped bidirectional in-memory transport pair whose application and viewer endpoints both satisfy the Studio transport contract.
- [x] 1.2 Test delivery in both directions, either-peer-first startup, ordered buffering, endpoint closure, reconnection, and scope cleanup.
- [x] 1.3 Preserve the existing `MemoryTransport` public behavior by implementing it over the pair or retaining a tested compatibility facade.

## 2. React Package and Viewer Host Seams

- [x] 2.1 Create the browser-only `@effect-state-machine/studio-react` workspace package with library build, type declarations, public export map, React peer dependencies, and no Node platform dependency.
- [x] 2.2 Move the protocol-folding viewer client into the React package and inject its viewer transport instead of constructing a WebSocket from browser location.
- [x] 2.3 Replace the viewer client's hardcoded editor HTTP request with an injected source-opening operation and test success and visible failure outcomes.
- [x] 2.4 Add standalone WebSocket and HTTP-editor providers that satisfy the new viewer host seams without changing the existing protocol behavior.

## 3. Instance-Scoped Studio Model

- [x] 3.1 Replace the hardcoded viewer and persistence layers with stable module-scope atoms whose runtime layer and initial presentation values are injected through each host registry.
- [x] 3.2 Add React context for composition-scoped host controls, then migrate shared components away from document-global theme and source behavior.
- [x] 3.3 Move the reusable Studio surface, components, graph layout, and presentation modules into `studio-react` while keeping one implementation for embedded and standalone hosts.
- [x] 3.4 Test that separate registries and models maintain independent worlds, selections, history cursors, dispatch state, and themes.

## 4. Embeddable Component Lifecycle and API

- [x] 4.1 Define and export generic `Studio` props for the grouped machine attachment inputs, controlled/uncontrolled theme, source callback, host `className`, and host `style`.
- [x] 4.2 Implement one component-owned Effect scope that connects the machine attachment and viewer through the direct transport, without acquiring or releasing the supplied machine handle.
- [x] 4.3 Rebuild the attachment cleanly when machine identity changes and make unmount cleanup idempotent under React development remounts.
- [x] 4.4 Adapt the shared top bar and empty/loading states for a direct single-session host, including direct connection labeling and copy-first source behavior.
- [x] 4.5 Test live state observation, semantic history, quick and custom dispatch, rejection display, unmount behavior, handle replacement, and two simultaneous embeds.

## 5. Self-Contained Style Delivery

- [x] 5.1 Add a build step that compiles the Studio theme, used utilities, graph rules, reduced-motion rules, and font declarations into a JavaScript-exported style string with no public CSS entry point.
- [x] 5.2 Implement the component's shadow-root host and React portal, inserting exactly one style element and one themed Studio surface per mounted instance.
- [x] 5.3 Remove document-element, body, root-element, and global-storage presentation mutations from the reusable UI; keep all tokens and normalization inside the shadow surface.
- [x] 5.4 Verify in a host fixture that rendering requires only a JavaScript import, host element and utility styles do not alter Studio internals, Studio styles do not escape, and two embeds can use different themes.
- [x] 5.5 Measure the production JavaScript and font-asset output and keep the style payload limited to rules used by Studio.

## 6. Standalone Studio Migration

- [x] 6.1 Update standalone Studio to render the shared React package with WebSocket viewer and HTTP editor providers.
- [x] 6.2 Keep standalone theme and source-action persistence at its application composition root rather than inside the reusable model.
- [x] 6.3 Remove superseded standalone UI sources and adjust Vite, TypeScript, package, and publish configuration to consume the shared package.
- [x] 6.4 Run the existing standalone server, retained-history, session-picker, editor-opening, and UI behavior tests against the migrated surface.

## 7. Packaging, Compatibility, and Documentation

- [x] 7.1 Add a server-render/import test proving the React entry point evaluates without browser globals, starts no runtime, and resolves no Node-only Studio modules.
- [x] 7.2 Add a packed-consumer fixture that imports and renders `Studio` without a CSS import or CSS processor and verifies the published JavaScript, declarations, font assets, and export map.
- [x] 7.3 Add a real-browser smoke test for shadow-root graph layout, controls, keyboard/focus behavior, source actions, reduced motion, and light/dark themes.
- [x] 7.4 Document installation, the handle-based component example, sizing and theme props, source callbacks, lifecycle ownership, and the absence of a stylesheet/server requirement.
- [x] 7.5 Run package type checks, unit and integration tests, production builds, formatting, linting, and strict OpenSpec validation.
