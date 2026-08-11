## Context

See `proposal.md` for motivation and `specs/react-studio-embed/spec.md` for the observable contract.

Studio currently combines three concerns in `@effect-state-machine/studio`: a Node CLI/server, a browser viewer that hardcodes a WebSocket connection and editor HTTP endpoint, and the React UI. The UI's Atom runtime is constructed at module scope with the WebSocket layer, presentation preferences use browser-global storage, the application sets its theme on `document.documentElement`, and the compiled stylesheet contains document-level selectors. Those choices are appropriate for a standalone page but prevent independent, serverless component instances.

The existing application-side `Attach` API and versioned protocol are already the correct boundary for observing a machine and dispatching events. The embed should preserve that boundary rather than introducing a second history or inspection implementation.

## Goals / Non-Goals

**Goals:**

- Keep the embedded and standalone viewers on one protocol fold, history projection, and React UI implementation.
- Make every Effect resource created by an embed scoped to that component's mounted lifetime.
- Support multiple component instances with no shared connection or viewer state.
- Deliver a fully styled component from the JavaScript entry point with strong host-page isolation.
- Keep the React distribution free of Node-only modules and module-evaluation browser side effects.

**Non-Goals:**

- Running a machine from its definition and input inside the React component.
- Owning, restarting, pausing, or disposing the supplied machine handle.
- Replacing the standalone server, its retained disconnected sessions, or remote application connections.
- Reconstructing machine history that occurred before the component attached.
- Adding visual machine authoring or mutating the machine definition.
- Supporting several supplied machine handles inside one embed in the first version; consumers can render several independent components.

## Decisions

### Add a browser-only `@effect-state-machine/studio-react` package

The reusable viewer and UI will move into a React-specific package. It will expose the public `Studio` component while keeping React and React DOM as peer dependencies. Browser dependencies such as the Atom React binding, graph renderer, and layout engine stay on this side of the package boundary. The package will not depend on the Node platform package or import the standalone server.

The standalone `@effect-state-machine/studio` package will depend on this package and provide a WebSocket-backed viewer host. This direction avoids duplicating UI while preventing React consumers from crossing the CLI/server boundary.

Alternatives considered:

- Exporting `@effect-state-machine/studio/react` would be more discoverable but leaves a browser entry point inside a package that owns Node dependencies and makes accidental server imports easier.
- Copying the UI into a new package would reduce initial refactoring but would immediately create two Studio implementations.

### Accept an already-running handle through a grouped machine prop

The initial public shape will group machine attachment inputs while leaving presentation inputs at the component level:

```tsx
<Studio
  machine={{
    definition,
    handle,
    quickEvents,
    appName,
    mapSource,
  }}
  theme={theme}
  onThemeChange={setTheme}
  onOpenSource={openSource}
  className="demo-studio"
  style={{ height: 640 }}
/>
```

The machine prop uses the same definition metadata, handle, quick-event, naming, and source-mapping concepts as `Attach.attach`. The component owns only the attachment scope. Its host element accepts `className` and `style`, with a usable default height and full available width.

Theme follows the ordinary controlled/uncontrolled React pattern: `theme` plus `onThemeChange` when controlled, `defaultTheme` when component-owned, and light as the final default. Embed-owned preferences are not written to global storage. The standalone host remains responsible for its existing persistence.

Alternatives considered:

- Accepting definition, input, and an Effect layer would make demos shorter, but it would move machine execution and application dependency composition into a UI component.
- Accepting only a prebuilt Studio session would expose transport and lifecycle machinery that the component can safely own.

### Preserve the protocol with a bidirectional in-memory transport pair

`studio-client` will expose a general in-memory duplex pair whose two endpoints implement the existing transport contract. One endpoint is provided to `Attach.attach`; the viewer consumes the other. Sending on either connection delivers the same protocol message to its peer's inbound queue. Endpoint acquisition and release are scoped, and closure is observable as the existing typed transport failure.

The current test-oriented memory transport can be implemented in terms of this pair or retained as a compatibility facade. The pair must support either peer connecting first without losing its initial announcement, because React and Effect resource startup order should not be observable.

This retains announcement serialization, fact buffering, history folding, custom-event decoding, quick-event factories, dispatch outcomes, and session termination exactly once across both hosting modes.

Alternatives considered:

- Passing the machine handle directly into UI atoms would remove protocol serialization overhead but create a separate embedded behavior path and weaken protocol tests.
- Reusing a loopback WebSocket would preserve protocol behavior but still require a server or browser listener.

### Separate the viewer model from its host transport and source action

The viewer client will depend on a viewer-side transport service rather than constructing a WebSocket from `location`. Opening a source location will likewise be an injected operation. The shared model continues to expose the world stream, dispatch operation, and source operation consumed by the UI.

The standalone host supplies WebSocket transport and its HTTP editor operation. The embed supplies the direct endpoint and either a wrapped host callback or a copy-oriented fallback. Host callback defects or expected failures are converted to a viewer-visible failure instead of escaping through React event handling.

### Keep atom identities module-scoped and inject each host layer through its registry

The shared UI's runtime, atoms, derived atoms, and families will remain stable module-scope definitions. The runtime has an inert default viewer layer, while each Studio host supplies its concrete viewer layer through `Atom.initialValue(runtime.layer, hostLayer)` on the host's `RegistryProvider`. Registry-scoped layer memoization gives every embed an independent viewer service and disposes it with that registry without manufacturing atom identities during React rendering.

Composition-scoped values such as controlled theme behavior, source actions, and connection labeling use React context rather than dynamically-created atoms. Embed presentation atoms remain ordinary module-scope atoms whose values are isolated by the embed registry. No local-storage layer or viewer connection is created at module evaluation. This makes multiple embeds independent and lets the standalone host use the same UI with different providers.

Alternatives considered:

- Keeping the current hardcoded runtime layer would isolate values but still force every registry to construct the WebSocket viewer.
- Passing every state value and callback through component props would discard the existing Atom architecture and create a wide, shallow UI interface.

### Render the UI in a shadow root with bundled style text

The `Studio` component will render a host element in the caller's React tree, create an open shadow root after mount, and portal the Studio surface into it. The package build will compile the authored Studio theme, Tailwind utilities used by the UI, graph-renderer rules, reduced-motion rules, and font declarations into a JavaScript string. The portal inserts that string in a `style` element inside the shadow root before rendering the interface.

Consumers therefore import only JavaScript. Shadow DOM prevents Studio selectors from affecting the host and prevents common host element or utility selectors from changing Studio internals. Theme tokens live on the shadow-root surface rather than `document.documentElement`. Each shadow root receives one style element; no document-level style registry or cleanup coordination is required. Font assets may remain emitted package assets referenced by the embedded declarations, but no CSS asset is part of the consumer contract.

The standalone host will use the same styled surface. It may render through the same shadow-root boundary, which exercises the distributed component in normal Studio development, or through an internal light-DOM host only if a concrete browser incompatibility requires it.

Alternatives considered:

- Runtime inline style objects cannot express the existing pseudo states, media queries, keyframes, and graph-library selectors without a large UI rewrite.
- Injecting scoped CSS into `document.head` avoids a portal but remains vulnerable to host selectors and requires global deduplication across component versions.
- Requiring a stylesheet import is conventional but directly contradicts the consumer experience required by this change.

### Couple React lifetime to one Effect scope

After the shadow host mounts, the component creates one Effect scope containing the in-memory pair, application attachment, viewer client, Atom runtime resources, and their fibers. Cleanup closes that scope before discarding the model. A changed machine identity is treated as teardown followed by a new attachment.

Initialization exposes a neutral loading surface; cleanup is idempotent. Development Strict Mode's mount-cleanup-remount sequence must not leave a connection, attachment fiber, style mutation, or delayed state update behind. Session identifiers may differ after a genuine remount, but only the live scope can receive or dispatch messages.

### Keep module import and server rendering inert

The package entry point will export types and component definitions without reading `document`, `location`, `localStorage`, `navigator`, or `crypto`. Browser-only work occurs from the mounted lifecycle or an invoked event handler. Server rendering produces only the empty host element; the client creates and populates its shadow root after hydration.

The library build and export map will be tested from a consumer fixture to ensure that importing the React entry point does not resolve Node-only Studio modules and that no separate CSS import appears in the usage path.

## Risks / Trade-offs

- **[Shadow DOM compatibility]** Graph-library selectors, focus handling, portals, and font loading can behave differently in a shadow root. → Add a real-browser component fixture covering graph layout, controls, focus, source action, and both themes before switching standalone Studio to the shared surface.
- **[JavaScript and font payload]** Embedding compiled styles and possibly font data increases the JavaScript transfer size. → Measure the production package, keep the stylesheet tree-shaken to Studio sources, emit cacheable font assets when preferable to inlining, and document the size in the package check.
- **[Protocol serialization overhead]** Direct embeds still encode and fold protocol messages. → Accept the modest development-only overhead in exchange for one observable behavior path; use unbounded in-memory queues only within the component scope and retain existing fact-buffer limits.
- **[Lifecycle races]** React teardown can overlap Effect startup or dispatch. → Make resource acquisition scoped and cleanup idempotent, support either transport peer connecting first, and cover rapid mount/unmount and handle replacement.
- **[Standalone regression]** Moving the UI and injecting host services can change current server-backed behavior. → Keep viewer protocol tests, add shared UI integration coverage, and migrate the standalone entry point only after parity tests pass.
- **[Shadow-root theming limits]** Host CSS variables and fonts no longer cascade implicitly. → Treat Studio as deliberately self-contained and expose explicit theme and host-element sizing props.

## Migration Plan

1. Add the duplex transport and viewer-host seams with compatibility tests while leaving standalone Studio unchanged.
2. Create `studio-react`, move the shared viewer/UI behind its model and styled surface, and verify the direct component in a browser fixture.
3. Switch standalone Studio to the shared package with its WebSocket and editor providers, then run existing server and UI checks.
4. Publish the new package alongside the existing packages. No existing application or CLI API requires migration.

Rollback is package-local: the standalone entry point can temporarily return to its previous internal UI while the new React package remains unpublished or experimental. Protocol and `Attach` APIs remain compatible throughout.
