# Handoff: State-machine DevTools redesign

## Overview
A redesign of the browser devtools viewer for the `statemachine` library (repo: `julia-script/statemachine`). It fixes the original viewer's information hierarchy and space efficiency: compact IDE-like controls, time-travel merged into History, a persistent top bar, a collapsible side rail, in-graph node/event detail cards with JSON Schema, a state diff view, a raw-JSON graph view, and a dark theme.

## About the Design Files
`DevTools Redesign.dc.html` is a **design reference / interactive prototype built in HTML** — not production code. It simulates the `Checkout` example machine (`examples/Checkout.ts`) so every interaction is testable. The task is to **recreate this design inside the existing codebase**, i.e. `src/DevToolsViewer.ts` (vanilla TypeScript DOM rendering, no framework) and `examples/interactive-devtools-page.css`, keeping the existing `tokens.css` variable system and BEM-ish `machine-devtools__*` class conventions.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interactions are final and derived from the repo's own `tokens.css`. Recreate pixel-perfectly.

## Layout (single panel, top → bottom)
```
┌──────────────────────────────────────────────────────────┐
│ Top bar (38px, --color-pear bg, 2px ink bottom border)   │
├───────────────────────────────────────────┬──────────────┤
│ Behavior map (flex:1, dotted canvas)      │ Side rail    │
│  ├ toolbar (top-left, floating pill)      │ 300px        │
│  ├ zoom cluster (bottom-left, floating)   │  ├ STATE     │
│  ├ node detail card (anchored popover)    │  ├ EVENTS    │
│  └ "⟨ Panels" pill (top-right, only when  │  ├ HISTORY   │
│     rail is collapsed)                    │  (flex:1)    │
└───────────────────────────────────────────┴──────────────┘
```

### Top bar — always visible (this fixes "nav disappears in full-map mode")
- Height 38px, padding 0 10px, gap 9px, background `--color-pear`, border-bottom `2px solid --color-ink`.
- Contents, left→right: title "Machine devtools" (Bricolage Grotesque 800 13px) · machine `<select>` (24px tall, mono 11px — this is the placeholder for **nested-machine navigation**; picking a child currently flashes a "pattern TBD" notice) · status dot (8px circle, `--color-success` fill, 1px ink border) + "browser · direct" (mono 600 10px, muted) · current-state pill (mono 600 10px, `--color-surface` bg, `--radius-pill`) · spacer · transient notice text (danger color) · theme toggle button "◐" (24×24) · source-action `<select>` (Cursor / VS Code / Copy) · close "×" (24×24).
- Close collapses the whole panel to a floating launcher pill bottom-right ("● Inspect checkout", pear bg, 2px ink border, `0 3px 0` ink hard shadow).

### Behavior map
- Canvas: `--color-surface` bg + dot grid `radial-gradient(--dt-dot 1px, transparent 1px)` 18×18px.
- Scene: fixed 980×420 coordinate space, scaled with `transform: scale(zoom)`; **auto-fit on mount, container resize, and rail toggle**: `zoom = clamp(min((w-60)/980, (h-60)/420, 1.15), 0.35)`. "Fit" re-runs this (never just scale=1).
- Nodes: 148×46px rounded (10px) cards, 1.5px ink border; active node: 2.5px border, pear bg, `0 3px 0` ink shadow; final states: `border-style: double`, 3.5px. Two lines: title (Bricolage 800 12.5px) + sub-caption (mono 600 9px muted — description, `invoke · Orders.place`, or `final · …`).
- INITIAL marker: dot + arrow + "INITIAL" label (mono 700 8px) left of the initial node. Use `style="fill: var(...)"` on SVG parts — presentation attributes don't accept `var()`.
- Edges: SVG orthogonal paths, `--color-rule-strong` 1.6px at 0.55 opacity; the edge just traversed: `--color-focus` 3px, `stroke-dasharray: 9 7` with a 1s linear `stroke-dashoffset` flow animation. Arrowheads: shared `<marker>` with `fill="context-stroke"`.
- Edge labels: **HTML pills absolutely positioned over the SVG** (not SVG `<text>`): `--color-accent` bg, 1px accent-ink border, mono 700 10px, `--radius-pill`; traversed → focus bg + surface text.
- Map toolbar (floating pill, top-left, surface bg, 1px ink border, `0 2px 0` ink shadow):
  `DEPTH` label · − / value / + stepper (depth 1–9 hops, BFS from active node, undirected) · divider · `All` toggle (default ON, shows whole machine; touching −/+ turns it off) · divider · `{ } JSON` toggle → swaps the canvas for a scrollable `<pre>` of the serializable graph (id, description, initial, states with `fields` + `invoke`/`final` flags, events with descriptions + fields, transitions). Zoom cluster hides in JSON view.
- Zoom cluster (floating, bottom-left): − / percentage / + / Fit. Wheel/drag panning not in prototype; keep the library's existing pointer pan/zoom.

### Node / event detail cards (in-graph popovers)
- Click a state box or event pill → card anchored to it inside the scene (click again or × to close; one at a time).
- 258px wide, surface bg, 2px ink border, radius 10, `0 3px 0` ink hard shadow. Placed below the anchor, or above when the anchor is low (y > 230 in scene coords).
- **Counter-scaled against zoom**: `transform: scale(1/zoom)` with `transform-origin: top|bottom left` matching placement, so it stays readable at any zoom.
- Contents: title (Bricolage 800 12.5px) + kind badge (`state` / `invoke` / `final state` / `event` / `outcome`; pear bg pill, mono 700 8.5px) + × · description (10px, muted) · relation lines (mono 600 9.5px, cyan-ink): outgoing `on Event → Target` for states, `Source → Target` per transition for events, invoke success/failure targets · collapsible **JSON SCHEMA** `<details>` with the schema serialized as standard JSON Schema:
  `{"type":"object","properties":{"_tag":{"const":"…"},…},"required":[…],"additionalProperties":false}`. Invoke success outcome: the value schema (e.g. `{"type":"string","description":"orderId"}`); failure: the tagged error's schema.
- In the real implementation derive these from the machine's Effect Schema definitions (e.g. `JSONSchema.make` from `effect/JSONSchema`), not hardcoded data.

### Side rail (300px, collapsible)
Order reflects importance: **STATE first** (it's the primary information), then EVENTS, then HISTORY.

1. **STATE** (surface bg, 2px ink bottom border):
   - Header row: `STATE` micro-label (mono 700 10px, letter-spacing 0.1em, muted) · state tag in Bricolage 800 14px · spacer · `± diff` toggle pill (pressed = pear bg; default ON) · source link `Checkout.ts:41` (focus color, underlined, truncates with ellipsis, `min-width:0`; click = copy full reference, flash "Copied" notice).
   - State JSON `<pre>` (mono 500 11px, max-height 190px). With diff ON and a previous step: full JSON with changed lines highlighted full-bleed — removed: danger text on danger-soft bg prefixed `-`; added: success text on success-soft bg prefixed `+`; unchanged lines plain.
   - Collapsed `<details>` "EVENT PAYLOAD · <tag>" with the selected step's event JSON.
2. **EVENTS**: `EVENTS` micro-label + "time-traveling" chip (danger-soft) when not live + collapse button `⟩` (22×22). Quick events as 24px accent chips grouped under micro-labels (CART / PAYMENT), disabled (35% opacity) when unavailable in the current state or when time-traveling. Collapsed `<details>` "CUSTOM EVENT": event-type `<select>` (syncs the JSON draft), JSON `<textarea>` (mono 10.5px), `Dispatch` primary button (ink bg, paper text), inline help/error line (validation: JSON parse + `_tag` check + ignored-event message).
3. **HISTORY** (flex:1): header holds `HISTORY` + step count **and the time-travel controls** (◀ position `n/m` ▶ + Live pill — accent bg with `Live +N` when behind, pear when live). Entries: grid `22px 1fr auto` — index (mono 10px) · title + meta `From → To` (9.5px mono muted, ellipsis) · state tag (mono 9.5px cyan-ink). Selected entry: `--color-cyan` bg. Click = time-travel to that step. Auto-scroll to bottom while live. Invoke steps appear as `Orders.place → failure/success`.
- Collapse: `⟩` hides the rail (map re-fits); floating `⟨ Panels` pill top-right restores it.

## Interactions & behavior summary
- Firing an event appends a history step and animates the traversed edge; entering `PlacingOrder` auto-resolves after ~850ms (first attempt fails → `PaymentFailed`, retry succeeds → `Ordered`).
- Time-traveling disables dispatch (chips dim, "time-traveling" chip shows); Live returns to head. New steps arriving while inspecting history do NOT move the cursor.
- Depth/All/JSON/zoom are view-only state; theme toggle flips a class that swaps CSS variables.
- Transitions: 120ms on zoom transform; edge-flow keyframes 1s linear infinite; honor `prefers-reduced-motion`.

## Design tokens
Reuse `tokens.css` for the light theme (paper/surface/ink/muted/rule/accent/pear/cyan/danger/success/focus, spacing, radii, `--font-display/body/mono`). New in this design:
- Control scale (replaces `--control-height: 2.75rem` inside the devtools): controls 22–24px tall, icon buttons 22–24px square, micro-labels mono 700 9–10px with 0.1em tracking, body text 10–11.5px.
- Hard shadows: `0 2px 0 ink` (floating toolbars), `0 3px 0 ink` (cards/launcher/active node).
- **Dark theme** (class on the root swaps the variables):
  paper `oklch(24% 0.02 284)` · paper2 `oklch(29% 0.025 284)` · surface `oklch(20% 0.02 284)` · ink `oklch(92% 0.02 92)` · muted `oklch(68% 0.025 284)` · rule `oklch(38% 0.03 284)` · rule-strong `oklch(52% 0.03 284)` · highlight ("pear" slot) `oklch(34% 0.07 285)` **deep indigo — deliberately not the light theme's pear/yellow** · cyan `oklch(36% 0.06 220)` · cyan-ink `oklch(80% 0.08 205)` · danger `oklch(72% 0.17 25)` / soft `oklch(32% 0.07 25)` · success `oklch(70% 0.13 154)` / soft `oklch(32% 0.06 154)` · focus `oklch(72% 0.15 285)` · dot-grid `oklch(32% 0.03 284)`. Accent orange `oklch(67% 0.2 34)` and accent-ink stay the same in both themes.

## Typography
- Display (titles, state names, node titles): Bricolage Grotesque 800 (12.5–14px in-tool).
- UI text/buttons: IBM Plex Sans 600 (10–11.5px).
- Data (tags, JSON, indices, micro-labels): IBM Plex Mono 500–700 (8.5–11px).

## Assets
None — everything is CSS/SVG. Google Fonts: Bricolage Grotesque 600/800, IBM Plex Mono 400–700, IBM Plex Sans 400–600.

## Removed from the original design (intentional)
- The "Focus / Nearby / Full map" segmented control → replaced by the depth stepper + All toggle.
- The "Map only" / graph-only mode → replaced by the collapsible rail.
- The separate focus-graph card layout (depth 1) → the single SVG graph handles all depths.
- Time-travel controls in the panel header → moved into the History header.
- The 2-column payload inspectors at the bottom of History → replaced by the STATE panel + EVENT PAYLOAD details + in-graph schema cards.

## Files
- `DevTools Redesign.dc.html` — the interactive prototype (single file; template markup + a `Component` logic class with the simulated machine, all styles inline). Open in a browser to explore every behavior described above.

## Implementation pointers (target codebase)
- `src/DevToolsViewer.ts`: restructure `render()` → top bar, map pane (toolbar, zoom, detail cards), rail (state / events / history). Keep the existing `DevToolsSession` API (`setFocusDepth`, `selectStep`, `previous/next/returnToLive`, `dispatchQuickEvent`, `dispatchEvent`).
- `examples/interactive-devtools-page.css`: update `machine-devtools__*` rules to these measurements; add the dark-theme variable block keyed off a `data-theme="dark"` attribute.
- Graph JSON view and schema cards should serialize from `Graph.ts` nodes/edges + Effect Schema (`JSONSchema.make`) rather than fixture data.
