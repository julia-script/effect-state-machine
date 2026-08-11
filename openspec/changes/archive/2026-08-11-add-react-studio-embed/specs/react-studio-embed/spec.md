## Purpose

Provide a self-contained React component that embeds the interactive Studio beside a live machine without requiring a Studio server, WebSocket connection, or consumer-managed stylesheet.

## ADDED Requirements

### Requirement: React consumers can embed a running machine
The system SHALL publish a browser-oriented React entry point with a `Studio` component that accepts a machine definition's metadata, an already-running machine handle, and optional quick events. The component SHALL observe and control that machine without owning its execution lifetime.

#### Scenario: Component mounts beside a running machine
- **WHEN** a React application renders `Studio` with definition metadata and a live machine handle
- **THEN** the component displays that machine's graph, current state, and subsequent semantic history

#### Scenario: Component unmounts
- **WHEN** the component unmounts while the supplied machine is still running
- **THEN** the embedded devtools session ends and the machine continues running unaffected

### Requirement: Embedded sessions connect directly
The embedded component SHALL exchange announcements, facts, and dispatches with its supplied machine in memory through the Studio protocol. Rendering and using the component SHALL NOT require a Studio server, network listener, or WebSocket connection.

#### Scenario: Playground has no Studio server
- **WHEN** a playground renders the component without launching any external Studio process
- **THEN** state changes, history, quick-event dispatches, and custom-event dispatches remain fully interactive

#### Scenario: Dispatch is rejected
- **WHEN** the component dispatches an event that the live machine cannot accept
- **THEN** the application-facing client rejects it through the normal protocol outcome and the component shows the reason inline

### Requirement: Styling is installed by the component
The component SHALL install every style and font definition required for its interface from JavaScript. Consumers SHALL NOT need to import or copy a CSS file, configure a CSS processor, or include Studio-specific global styles.

#### Scenario: Consumer imports only JavaScript
- **WHEN** a consumer imports the React entry point and renders `Studio` without importing any Studio stylesheet
- **THEN** the complete interface is styled and usable

#### Scenario: Multiple components share a page
- **WHEN** two Studio components render on the same page
- **THEN** required styles are available to both without duplicate visible effects or conflicting component themes

### Requirement: Embed presentation is isolated from its host
The component SHALL scope its tokens, theme, typography, layout, and element normalization to its own root. It SHALL NOT modify the host document element, body, root application element, or unrelated host-page elements.

#### Scenario: Embedded dark theme
- **WHEN** one Studio component uses the dark theme inside a light host page
- **THEN** only that component changes appearance and the host page remains light

#### Scenario: Host page has its own styles
- **WHEN** the host page defines styles for common elements and utility class names
- **THEN** the Studio interface remains legible and the component's styles do not restyle elements outside its root

### Requirement: Embed instances have independent state and lifecycles
Each mounted component SHALL own an independent viewer state, direct connection, attachment scope, selected history cursor, and presentation preferences. Mounting, updating, or unmounting one component SHALL NOT change another component's session or view state.

#### Scenario: Two machines are embedded
- **WHEN** a page renders two Studio components connected to different machine handles
- **THEN** each component shows and dispatches only against its own machine

#### Scenario: React development remount
- **WHEN** React mounts, cleans up, and remounts the component during development checks
- **THEN** abandoned attachments are released and the remounted component establishes one usable live session

### Requirement: Embed-specific host integrations are explicit
The component SHALL support host-provided sizing and theme selection. Source locations SHALL default to a browser-safe copy action, and the host MAY provide a source-opening callback without requiring the standalone Studio editor endpoint.

#### Scenario: Source callback is absent
- **WHEN** a user activates a source location and the host provided no source-opening callback
- **THEN** the component copies or offers to copy the location without requesting a Studio server endpoint

#### Scenario: Source callback is provided
- **WHEN** a user activates a source location and the host provided a source-opening callback
- **THEN** the component passes the selected file, line, and column to that callback

### Requirement: React package stays browser-safe
Importing the React entry point SHALL NOT load the standalone Studio server or Node-only platform modules, and SHALL NOT read browser globals as a module-evaluation side effect.

#### Scenario: Server-side module evaluation
- **WHEN** a build tool evaluates the React entry point in an environment without `document`, `location`, `localStorage`, or `navigator`
- **THEN** the import succeeds without starting a runtime or accessing those globals
