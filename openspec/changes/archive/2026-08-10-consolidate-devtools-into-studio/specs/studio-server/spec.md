## Purpose

The CLI-launched local hub: accepts application connections, retains session history, serves the Studio interface, and relays dispatches between viewers and applications.

## ADDED Requirements

### Requirement: One command starts Studio
A single CLI command SHALL start the Studio server on a default port (overridable by flag or environment) and print the URL where the interface is reachable. The same server endpoint SHALL accept application connections.

#### Scenario: Default launch
- **WHEN** the studio command runs with no arguments
- **THEN** the server listens on the default port, prints the interface URL, and is immediately ready for application connections

### Requirement: Sessions survive disconnects as history
The server SHALL track every announced session. When an application disconnects, its sessions SHALL be marked disconnected but remain listed with their retained history until the server stops, so a crash's trail stays inspectable.

#### Scenario: Application crashes
- **WHEN** an application's connection drops mid-run
- **THEN** the interface shows the session as disconnected and its full retained history remains navigable

### Requirement: History replays to late viewers
The server SHALL retain each session's ordered facts and deliver the retained history to any viewer that connects or reloads after the session started. Retention MAY be bounded per session; truncation SHALL be indicated to viewers.

#### Scenario: Browser refresh
- **WHEN** a viewer reloads the interface mid-session
- **THEN** it receives the retained history and reaches the same live state as before the reload

### Requirement: Dispatches are relayed with honest failures
The server SHALL forward viewer dispatches to the owning application connection and return the application's outcome to the viewer. Dispatching to a disconnected session SHALL fail immediately with a reason, not hang.

#### Scenario: Dispatch to a dead session
- **WHEN** a viewer dispatches an event to a session whose application has disconnected
- **THEN** the viewer promptly receives a failure indicating the session is disconnected

### Requirement: Source locations open in the editor
The server SHALL execute a configured editor command (or a sensible default) to open a fact's source location at file and line when a viewer requests it, and report failure so the viewer can fall back to copying the location.

#### Scenario: Editor not available
- **WHEN** opening the editor fails
- **THEN** the viewer is informed and can copy the file:line reference instead
