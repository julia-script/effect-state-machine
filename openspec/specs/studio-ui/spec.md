# studio-ui Specification

## Purpose

The Studio interface: pick a session, see the behavior map and current state, dispatch events, and time-travel through semantic history — following the "Interactive devtools redesign" handoff in structure and interaction (Tailwind-native sizing; not pixel-perfect).
## Requirements
### Requirement: Sessions are pickable and their status visible
The interface SHALL list connected root-execution sessions in a persistent top bar, let the viewer switch between them, and show per-session connection status, root-machine status and state, and the number and status of descendant actors. Child actors SHALL be presented as members of their root session rather than as separately pickable sessions.

#### Scenario: Second root execution connects
- **WHEN** a new root execution announces a session while another is being viewed
- **THEN** the new session appears in the picker without disturbing the current view

#### Scenario: Child actor starts
- **WHEN** the viewed root session starts a child actor
- **THEN** the session remains selected and its descendant status updates without adding another top-level session

### Requirement: Behavior map renders from announcement data
The interface SHALL compose the root graph and every nested machine graph from the session announcement into one behavior map. Every child graph SHALL initially render expanded at its invocation site, including inactive child definitions, with node identities namespaced by their structural machine path. Statechart region slots SHALL render as labeled boundaries, and their active child nodes SHALL be derived from the committed parent state. The map SHALL emphasize every active top-level and region node, highlight every edge selected by the chosen history step including parallel siblings from one macrostep, show initial-state markers, distinguish node kinds, and retain zoom and fit-to-view. Show-all SHALL be the default; when bounded depth is selected, visibility SHALL be computed around the union of active actor states.

#### Scenario: Unknown nested system is rendered
- **WHEN** Studio receives a self-describing session with multiple levels of child definitions
- **THEN** the map shows every level expanded without requiring the viewer to activate or manually open a child

#### Scenario: Child follows a transition
- **WHEN** a child actor commits state while the complete map is visible
- **THEN** active-state emphasis moves within that child's graph and the corresponding traversed edge is highlighted without changing the root actor's emphasis

#### Scenario: Parallel regions handle one event
- **WHEN** one event atomically transitions active children in two region slots
- **THEN** both region boundaries remain visible, active emphasis moves to both destination children, and selecting the history step highlights both traversed edges

### Requirement: Nodes and events explain themselves
Clicking a state node or event edge anywhere in the composed machine tree SHALL open one anchored detail card with its owning machine definition, structural path, title, kind, description, transition relations, source link, and the JSON Schema announced for that definition. Region nodes SHALL identify their parent and slot. Invoked nodes SHALL show their work kind, name, lanes, concurrency, and retry policy when declared; timed nodes SHALL show their duration and target. Repeated node or event tags in different machines SHALL resolve to the selected machine's metadata.

#### Scenario: Inspecting a child event
- **WHEN** the viewer clicks an event label inside a child graph whose tag also exists in the parent
- **THEN** the card shows the child definition's description, transitions, source location, and JSON Schema

### Requirement: State panel shows canonical JSON with diff
The state panel SHALL show the selected history step's actor and that actor's schema-encoded state as JSON, with a toggleable diff against the same actor's previous state snapshot. It SHALL also show the triggering event payload and source location using the selected actor's definition. Selecting a graph actor without selecting a step SHALL show that actor's state at the current history cursor.

#### Scenario: Diff on child transition
- **WHEN** a selected child step changed two fields
- **THEN** those lines are marked as removed or added against the child's previous snapshot while unchanged lines render plainly

#### Scenario: Parent did not transition
- **WHEN** a child transition is selected while the parent remains in its current state
- **THEN** the state panel shows the child's state rather than diffing against the parent's state

### Requirement: Events are dispatchable from the interface
Quick events and the custom-event editor SHALL target a selected live actor in the current session. Controls SHALL use that actor's machine definition and current state, and SHALL be disabled when the actor does not accept the event, has terminated, or the viewer is time-traveling. Dispatch failures SHALL remain visible near the originating control with their reason.

#### Scenario: Dispatch to child actor
- **WHEN** the viewer selects a live child actor and dispatches an available event
- **THEN** Studio addresses the dispatch to that child actor without delivering it to the root or sibling actors

#### Scenario: Failure is explained
- **WHEN** a dispatch fails because the selected actor no longer exists or does not accept the event
- **THEN** the interface shows the failure reason near the control without losing the draft

### Requirement: History is semantic and time-travelable
The interface SHALL fold the session's globally sequenced facts into one semantic history containing root and descendant machine starts, events and every transition selected in their macrostep, invocations and retries, timer starts/fires/cancellations, stale outcomes, child ownership boundaries, state commits, completions, cancellations, and defects. Every step SHALL identify its actor and relationship depth. Parallel sibling transitions selected for one event SHALL remain one semantic step. Selecting a step SHALL move one local session cursor: the map and state panels SHALL reconstruct every actor's existence and latest state at that sequence, a not-live indicator SHALL appear, and new steps SHALL NOT move the cursor. The selected step's raw inspection records SHALL remain accessible.

#### Scenario: Following parent and child causality
- **WHEN** a parent starts a child, forwards an event, the child transitions, and the parent handles its completion
- **THEN** history shows those steps once in session sequence order with their actor identities and parent-child depth

#### Scenario: Inspecting the past during a live run
- **WHEN** the viewer selects an earlier step and facts from multiple actors arrive
- **THEN** every actor remains displayed at its selected historical position, the live control shows how many session steps behind the cursor is, and returning to live reconstructs the newest tree state

#### Scenario: Time before child start
- **WHEN** the viewer selects a sequence before a child actor started
- **THEN** that child definition remains visible in the expanded map but has no live actor or active-state emphasis at that cursor

### Requirement: Theming and motion preferences
The interface SHALL provide light and dark themes driven by one token set, persist the choice across reloads, and honor reduced-motion preferences for map animations.

#### Scenario: Reduced motion
- **WHEN** the viewer's system requests reduced motion
- **THEN** edge-flow and zoom animations are disabled while all information remains visible

### Requirement: Non-live sessions can be dismissed
The interface SHALL offer a dismiss control on sessions whose connection status is disconnected or ended, and SHALL NOT offer it on connected sessions. Dismissing sends the removal request; the session leaves the picker only when the removal notification arrives. When the removed session was the one being viewed, the interface SHALL fall back to another session or the empty state without an error.

#### Scenario: Dismissing a stale session
- **WHEN** the viewer activates the dismiss control on a disconnected session
- **THEN** the session disappears from the picker for every connected viewer

#### Scenario: Viewed session is removed
- **WHEN** the session currently being viewed is removed (by this viewer, another viewer, or supersession)
- **THEN** the interface switches to another available session or its empty state, without stale panels for the removed session

