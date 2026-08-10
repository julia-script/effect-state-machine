# studio-ui Specification

## Purpose

The Studio interface: pick a session, see the behavior map and current state, dispatch events, and time-travel through semantic history — following the "Interactive devtools redesign" handoff in structure and interaction (Tailwind-native sizing; not pixel-perfect).

## Requirements

### Requirement: Sessions are pickable and their status visible
The interface SHALL list connected sessions (application × machine) in a persistent top bar, let the viewer switch between them, and show per-session connection status (transport kind, connected/disconnected/completed/defected) plus the current state.

#### Scenario: Second application connects
- **WHEN** a new application announces a session while another is being viewed
- **THEN** the new session appears in the picker without disturbing the current view

### Requirement: Behavior map renders from announcement data
The interface SHALL render the machine graph from the announced serialized graph: the active state emphasized, the just-traversed edge highlighted, an initial-state marker, and invoked/final node kinds distinguished. A depth control SHALL limit the map to N hops around the active state with a show-all default, and a JSON view SHALL show the serializable graph. Zoom with fit-to-view SHALL be available.

#### Scenario: Following a transition
- **WHEN** a state commit arrives while the map is visible
- **THEN** the active-state emphasis moves and the traversed edge is highlighted without manual interaction

### Requirement: Nodes and events explain themselves
Clicking a state node or event edge SHALL open an anchored detail card with its title, kind, description, transition relations, source link, and the announced JSON Schema, one card at a time, legible at any zoom.

#### Scenario: Inspecting an event
- **WHEN** the viewer clicks an event label on the map
- **THEN** a card shows its description, each source → target transition, and its JSON Schema

### Requirement: State panel shows canonical JSON with diff
A state panel SHALL show the selected step's schema-encoded state as JSON with a toggleable diff against the previous state (added/removed lines marked), the triggering event's payload, and the state's source location with a configurable action (open in editor via the server, or copy).

#### Scenario: Diff on transition
- **WHEN** diff is enabled and a step changed two fields
- **THEN** those lines are marked as removed/added while unchanged lines render plainly

### Requirement: Events are dispatchable from the interface
Quick events SHALL render as grouped controls, disabled when the current state does not accept them or while time-traveling. A custom-event editor SHALL offer the machine's event types, validate the JSON draft, dispatch on demand, and surface dispatch failures inline with their reason.

#### Scenario: Failure is explained
- **WHEN** a dispatch fails because the event is not accepted in the current state
- **THEN** the interface shows the failure reason near the control without losing the draft

### Requirement: History is semantic and time-travelable
The interface SHALL fold raw facts into semantic steps (machine start, event with its selected transition, invocation with retries and outcome, child lifecycle, completion, defect) listed with index, title, and resulting state. Selecting a step SHALL move a local cursor: the map and state panel reflect that step, a not-live indicator appears, and new incoming steps SHALL NOT move the cursor. A live control SHALL return to the head, showing how many steps behind the cursor is. The step's underlying raw inspection records SHALL be accessible.

#### Scenario: Inspecting the past during a live run
- **WHEN** the viewer selects an earlier step and three new facts arrive
- **THEN** the view stays on the selected step, the live control shows it is behind, and returning to live shows the newest state

### Requirement: Theming and motion preferences
The interface SHALL provide light and dark themes driven by one token set, persist the choice across reloads, and honor reduced-motion preferences for map animations.

#### Scenario: Reduced motion
- **WHEN** the viewer's system requests reduced motion
- **THEN** edge-flow and zoom animations are disabled while all information remains visible
