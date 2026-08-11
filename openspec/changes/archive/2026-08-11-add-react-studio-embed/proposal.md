## Why

Playgrounds and demo pages need to show the live Studio experience beside the application they demonstrate, without starting a Studio server or routing through WebSockets. Requiring consumers to reproduce Studio setup, import a global stylesheet, or manage a second process makes interactive examples unnecessarily fragile.

## What Changes

- Add a React-specific Studio package exposing an embeddable `Studio` component.
- Let the component observe an already-running machine through its definition metadata and machine handle, using the same quick-event configuration as the existing Studio client.
- Connect the machine attachment and viewer directly through an in-memory, protocol-compatible channel with no server or WebSocket dependency.
- Package all Studio styling with the component and install it from JavaScript so consumers do not import a CSS file.
- Isolate each component's viewer state, transport lifecycle, theme, and styles so multiple embeds can coexist without changing the host document.
- Keep the standalone Studio on the same shared viewer and UI implementation while retaining its server-backed behavior.
- Make source navigation host-configurable for embeds, with a safe copy-oriented default when no Studio editor endpoint exists.

## Capabilities

### New Capabilities

- `react-studio-embed`: Embedding a live, interactive Studio viewer as a self-contained React component connected directly to an existing machine handle.

### Modified Capabilities

None.

## Impact

- Adds a browser-only React package and public component API.
- Refactors the current Studio viewer, Atom state, and UI into reusable instance-scoped pieces shared by standalone and embedded hosts.
- Extends the in-memory transport boundary so application and viewer peers can communicate directly through the existing Studio protocol.
- Changes Studio UI style packaging to support JavaScript installation and host-page isolation while preserving the standalone build.
- Affects `packages/studio`, `packages/studio-client`, workspace packaging/build configuration, and new component/integration tests.
