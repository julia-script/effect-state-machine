/**
 * Throwaway authoring evidence for the statechart-syntax prototype.
 *
 * Three small machines, each exercising one cluster of the proposal:
 *
 * - `player`: region slots (parallel), node-level handlers, history as data,
 *   a region invoke, and `after` as a timeout.
 * - `editor`: the debounce pattern (self-target restarts `after`), the stay
 *   shorthand, and a single invoke with a retry policy.
 * - `importer`: `race` and `all` work combinators, and guarded transitions
 *   under auto-tagging.
 *
 * Compile-checked only; there is no interpreter behind these definitions.
 */
import { Context, Effect, Schedule, Schema } from "effect"
import {
  Machine,
  type MachineCompletion,
  type MachineRequirements,
  type MachineState,
} from "./machine"

type IsMutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition

// ---------------------------------------------------------------------------
// Services and errors
// ---------------------------------------------------------------------------

class LoadFailed extends Schema.TaggedError<LoadFailed>()("LoadFailed", {
  message: Schema.String,
}) {}

class SaveFailed extends Schema.TaggedError<SaveFailed>()("SaveFailed", {
  message: Schema.String,
}) {}

class FetchFailed extends Schema.TaggedError<FetchFailed>()("FetchFailed", {
  message: Schema.String,
}) {}

class MediaSource extends Context.Service<
  MediaSource,
  Readonly<{ load: (trackId: string) => Effect.Effect<number, LoadFailed> }>
>()("prototype/MediaSource") {}

class Documents extends Context.Service<
  Documents,
  Readonly<{ save: (text: string) => Effect.Effect<number, SaveFailed> }>
>()("prototype/Documents") {}

class Listings extends Context.Service<
  Listings,
  Readonly<{
    fetch: (source: string, url: string) => Effect.Effect<string, FetchFailed>
    geocode: (raw: string) => Effect.Effect<readonly [number, number], FetchFailed>
    thumbnail: (raw: string) => Effect.Effect<string, FetchFailed>
  }>
>()("prototype/Listings") {}

// ---------------------------------------------------------------------------
// Machine 1: player — regions, history as data, region invoke, after
// ---------------------------------------------------------------------------

const Playback = Schema.TaggedUnion({
  Buffering: {},
  Running: {},
  Paused: { at: Schema.Number },
})

const Volume = Schema.TaggedUnion({
  Normal: {},
  Muted: { previousVolume: Schema.Number },
})

const PlayerState = Schema.TaggedUnion({
  Idle: {},
  // Two region slots on one state: XState's `type: 'parallel'`.
  Active: { trackId: Schema.String, playback: Playback, volume: Volume },
  // `resume` is the SAME union as the playback slot, but it is not declared a
  // region here, so it is inert data: history without a history pseudo-state.
  Reconnecting: { trackId: Schema.String, resume: Playback },
  Stopped: {},
})

const PlayerEvent = Schema.TaggedUnion({
  Play: { trackId: Schema.String },
  Pause: { position: Schema.Number },
  Resume: {},
  Mute: { volume: Schema.Number },
  Unmute: {},
  Dropped: {},
  Recovered: {},
  Stop: {},
})

const player = Machine.builder({
  input: Schema.Struct({}),
  state: PlayerState,
  event: PlayerEvent,
})

export const playerDefinition = player.make({
  id: "player",
  initial: () => ({ _tag: "Idle" }),
  states: {
    Idle: {
      on: {
        Play: {
          target: "Active",
          // Auto-tagging: no `_tag` here; slots are supplied explicitly (v1 —
          // see NOTES.md for the auto-fill question).
          reduce: ({ event }) => ({
            trackId: event.trackId,
            playback: { _tag: "Buffering" },
            volume: { _tag: "Normal" },
          }),
        },
      },
    },

    Active: {
      regions: {
        playback: {
          states: {
            Buffering: {
              // A region owns work: interrupted when the region leaves the
              // state or the parent exits entirely.
              invoke: ($) =>
                $({
                  name: "MediaSource.load",
                  effect: (_state, parent) =>
                    Effect.flatMap(MediaSource, ({ load }) => load(parent.trackId)),
                  onSuccess: { target: "Running", reduce: () => ({}) },
                  onFailure: {
                    target: "Paused",
                    reduce: () => ({ at: 0 }),
                  },
                }),
            },
            Running: {
              on: {
                Pause: { target: "Paused", reduce: ({ event }) => ({ at: event.position }) },
              },
            },
            Paused: {
              on: {
                Resume: { target: "Running", reduce: () => ({}) },
              },
            },
          },
        },
        volume: {
          states: {
            Normal: {
              on: {
                Mute: {
                  target: "Muted",
                  reduce: ({ event }) => ({ previousVolume: event.volume }),
                },
              },
            },
            Muted: {
              on: {
                Unmute: { target: "Normal", reduce: () => ({}) },
              },
            },
          },
        },
      },
      // Node-level handlers apply in every region configuration ("stop
      // applies to every child"); a region handler for the same event would
      // win (innermost-first).
      on: {
        Stop: { target: "Stopped", reduce: () => ({}) },
        Dropped: {
          target: "Reconnecting",
          // History as data: carry the live region value out as a plain field.
          reduce: ({ state }) => ({ trackId: state.trackId, resume: state.playback }),
        },
      },
    },

    Reconnecting: {
      on: {
        Recovered: {
          target: "Active",
          // Restoring history is an ordinary reduce supplying the slot.
          reduce: ({ state }) => ({
            trackId: state.trackId,
            playback: state.resume,
            volume: { _tag: "Normal" },
          }),
        },
      },
      // The declared timer: give up on reconnecting after a while.
      after: { duration: "30 seconds", target: "Stopped", reduce: () => ({}) },
    },

    Stopped: { final: true },
  },
})

type PlayerChecks = [
  Assert<IsMutual<MachineCompletion<typeof playerDefinition>, { readonly _tag: "Stopped" }>>,
  Assert<IsMutual<MachineRequirements<typeof playerDefinition>, MediaSource>>,
]

// ---------------------------------------------------------------------------
// Machine 2: editor — debounce via `after`, stay shorthand, retry
// ---------------------------------------------------------------------------

const EditorState = Schema.TaggedUnion({
  Typing: { text: Schema.String, revision: Schema.Number },
  Saving: { text: Schema.String, revision: Schema.Number },
  Closed: { revision: Schema.Number },
})

const EditorEvent = Schema.TaggedUnion({
  Edit: { text: Schema.String },
  Close: {},
})

const editor = Machine.builder({
  input: Schema.Struct({ text: Schema.String }),
  state: EditorState,
  event: EditorEvent,
})

const saveRetry = Schedule.recurs(2).pipe(Schedule.addDelay(() => Effect.succeed("1 second")))

export const editorDefinition = editor.make({
  id: "editor",
  initial: (input) => ({ _tag: "Typing", text: input.text, revision: 0 }),
  states: {
    Typing: {
      on: {
        // Explicit self-target: re-enters the node and restarts its `after`
        // timer. This restart is the entire debounce mechanism.
        Edit: {
          target: "Typing",
          reduce: ({ state, event }) => ({ text: event.text, revision: state.revision }),
        },
        Close: { target: "Closed", reduce: ({ state }) => ({ revision: state.revision }) },
      },
      after: {
        duration: "300 millis",
        description: "Save once the text has been quiet for 300ms.",
        target: "Saving",
        reduce: ({ state }) => ({ text: state.text, revision: state.revision }),
      },
    },

    Saving: {
      invoke: ($) =>
        $({
          name: "Documents.save",
          effect: (state) => Effect.flatMap(Documents, ({ save }) => save(state.text)),
          retry: { name: "retry-save", schedule: saveRetry },
          onSuccess: {
            target: "Typing",
            reduce: ({ state, value }) => ({ text: state.text, revision: value }),
          },
          onFailure: {
            target: "Typing",
            reduce: ({ state }) => ({ text: state.text, revision: state.revision }),
          },
        }),
      on: {
        // Stay shorthand: a bare function updates fields without re-entering,
        // so the running save is NOT interrupted.
        Edit: ({ state, event }) => ({ text: event.text, revision: state.revision }),
      },
    },

    Closed: { final: true },
  },
})

type EditorChecks = [
  Assert<IsMutual<MachineRequirements<typeof editorDefinition>, Documents>>,
  Assert<
    IsMutual<
      MachineState<typeof editorDefinition>,
      Schema.Schema.Type<typeof EditorState>
    >
  >,
]

// ---------------------------------------------------------------------------
// Machine 3: importer — race, all, guarded transitions
// ---------------------------------------------------------------------------

const ImporterState = Schema.TaggedUnion({
  Fetching: { url: Schema.String, attempts: Schema.Number },
  Enriching: { raw: Schema.String },
  Ready: {
    coordinates: Schema.Tuple([Schema.Number, Schema.Number]),
    preview: Schema.String,
  },
  Failed: { url: Schema.String, attempts: Schema.Number, message: Schema.String },
  Aborted: {},
})

const ImporterEvent = Schema.TaggedUnion({
  Retry: {},
  Abort: {},
})

const importer = Machine.builder({
  input: Schema.Struct({ url: Schema.String }),
  state: ImporterState,
  event: ImporterEvent,
})

export const importerDefinition = importer.make({
  id: "importer",
  initial: (input) => ({ _tag: "Fetching", url: input.url, attempts: 1 }),
  states: {
    Fetching: {
      // `race` joins a sum: value is the union of task outputs, winner names
      // the lane. Both lanes here return string, so the union collapses.
      invoke: ($) =>
        $.race({
          name: "Listings.fetch-fastest",
          tasks: {
            cdn: {
              effect: (state) =>
                Effect.flatMap(Listings, ({ fetch }) => fetch("cdn", state.url)),
            },
            origin: {
              effect: (state) =>
                Effect.flatMap(Listings, ({ fetch }) => fetch("origin", state.url)),
            },
          },
          onSuccess: {
            target: "Enriching",
            reduce: ({ value, winner: _winner }) => ({ raw: value }),
          },
          onFailure: {
            target: "Failed",
            reduce: ({ state, error }) => ({
              url: state.url,
              attempts: state.attempts,
              message: error.message,
            }),
          },
        }),
      on: {
        Abort: { target: "Aborted", reduce: () => ({}) },
      },
    },

    Enriching: {
      // `all` joins a product: value is keyed by task name.
      invoke: ($) =>
        $.all({
          name: "Listings.enrich",
          concurrency: 2,
          tasks: {
            geocode: {
              effect: (state) =>
                Effect.flatMap(Listings, ({ geocode }) => geocode(state.raw)),
            },
            thumbnail: {
              effect: (state) =>
                Effect.flatMap(Listings, ({ thumbnail }) => thumbnail(state.raw)),
            },
          },
          onSuccess: {
            target: "Ready",
            reduce: ({ value }) => ({
              coordinates: value.geocode,
              preview: value.thumbnail,
            }),
          },
          onFailure: {
            target: "Failed",
            reduce: ({ error }) => ({ url: "", attempts: 0, message: error.message }),
          },
        }),
      on: {
        Abort: { target: "Aborted", reduce: () => ({}) },
      },
    },

    Failed: {
      on: {
        // Guarded transitions under auto-tagging: branches keep named guards
        // (they stay visible in the graph), reducers drop `_tag`.
        Retry: {
          branches: [
            {
              when: {
                name: "retries-remaining",
                guard: ({ state }) => state.attempts < 3,
              },
              target: "Fetching",
              reduce: ({ state }) => ({ url: state.url, attempts: state.attempts + 1 }),
            },
            {
              otherwise: true,
              target: "Aborted",
              reduce: () => ({}),
            },
          ],
        },
        Abort: { target: "Aborted", reduce: () => ({}) },
      },
    },

    Ready: { final: true },
    Aborted: { final: true },
  },
})

type ImporterChecks = [
  Assert<IsMutual<MachineRequirements<typeof importerDefinition>, Listings>>,
  Assert<
    IsMutual<
      MachineCompletion<typeof importerDefinition>["_tag"],
      "Ready" | "Aborted"
    >
  >,
]

// Keep the assertion tuples referenced so `noUnusedLocals`-style tooling and
// reviewers see them as intentional.
export type PrototypeChecks = [PlayerChecks, EditorChecks, ImporterChecks]

