/** Representative shallow definitions for regions, timers, and declared work. */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Machine from "../src/Machine.js"

const Playback = Schema.TaggedUnion({ Playing: {}, Paused: { position: Schema.Number } })
const Volume = Schema.TaggedUnion({ Audible: {}, Muted: {} })
const PlayerState = Schema.TaggedUnion({
  Idle: {},
  Active: { trackId: Schema.String, playback: Playback, volume: Volume },
  Stopped: {},
})
const PlayerEvent = Schema.TaggedUnion({
  Play: { trackId: Schema.String },
  Pause: { position: Schema.Number },
  Resume: {},
  Mute: {},
  Unmute: {},
  Stop: {},
})
const player = Machine.builder({ input: Schema.Void, state: PlayerState, event: PlayerEvent })

export const playerDefinition = player.define(
  {
    id: "player",
    initial: () => ({ _tag: "Idle" }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Idle: player.state({
      Play: {
        target: "Active",
        reduce: ({ event }) => ({
          trackId: event.trackId,
          playback: { _tag: "Playing" },
          volume: { _tag: "Audible" },
        }),
      },
    }),
    Active: player.regions(
      {
        playback: {
          Playing: {
            Pause: { target: "Paused", reduce: ({ event }) => ({ position: event.position }) },
          },
          Paused: { Resume: { target: "Playing", reduce: () => ({}) } },
        },
        volume: {
          Audible: { Mute: { target: "Muted", reduce: () => ({}) } },
          Muted: { Unmute: { target: "Audible", reduce: () => ({}) } },
        },
      },
      { Stop: { target: "Stopped", reduce: () => ({}) } },
    ),
    Stopped: player.final(),
  },
)

const EditorState = Schema.TaggedUnion({
  Typing: { text: Schema.String },
  Saving: { text: Schema.String },
  Closed: {},
})
const EditorEvent = Schema.TaggedUnion({ Edit: { text: Schema.String }, Close: {} })
const editor = Machine.builder({
  input: Schema.Struct({ text: Schema.String }),
  state: EditorState,
  event: EditorEvent,
})

export const editorDefinition = editor.define(
  {
    id: "editor",
    initial: ({ text }) => ({ _tag: "Typing", text }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Typing: editor.state(
      {
        // A self-target is a real re-entry, so it restarts the debounce timer.
        Edit: { target: "Typing", reduce: ({ event }) => ({ text: event.text }) },
        Close: { target: "Closed", reduce: () => ({}) },
      },
      {
        after: {
          duration: "300 millis",
          target: "Saving",
          reduce: ({ state }) => ({ text: state.text }),
        },
      },
    ),
    Saving: editor.invoke(
      {
        name: "save-document",
        success: Schema.String,
        error: Schema.Never,
        effect: (state) => Effect.succeed(state.text),
        onSuccess: { target: "Typing", reduce: ({ value }) => ({ text: value }) },
        onFailure: { target: "Typing", reduce: ({ state }) => ({ text: state.text }) },
      },
      {
        // A stay updates fields without interrupting the in-flight save.
        Edit: { stay: ({ event }) => ({ text: event.text }) },
        Close: { target: "Closed", reduce: () => ({}) },
      },
    ),
    Closed: editor.final(),
  },
)

const ImportState = Schema.TaggedUnion({
  Fetching: { url: Schema.String },
  Enriching: { raw: Schema.String },
  Ready: { coordinates: Schema.Tuple([Schema.Number, Schema.Number]), preview: Schema.String },
  Failed: { message: Schema.String },
})
const ImportEvent = Schema.TaggedUnion({ Cancel: {} })
const importer = Machine.builder({
  input: Schema.Struct({ url: Schema.String }),
  state: ImportState,
  event: ImportEvent,
})

export const importerDefinition = importer.define(
  {
    id: "importer",
    initial: ({ url }) => ({ _tag: "Fetching", url }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Fetching: importer.invoke.race({
      name: "fetch-fastest",
      tasks: {
        cache: {
          success: Schema.String,
          error: Schema.Never,
          effect: (state) => Effect.succeed(`cache:${state.url}`),
        },
        origin: {
          success: Schema.Struct({ raw: Schema.String }),
          error: Schema.Never,
          effect: (state) => Effect.succeed({ raw: `origin:${state.url}` }),
        },
      },
      onSuccess: {
        target: "Enriching",
        reduce: ({ winner, value }) => ({ raw: winner === "cache" ? value : value.raw }),
      },
      // race waits through typed lane failures and reaches this only when every lane fails.
      onFailure: { target: "Failed", reduce: ({ error }) => ({ message: String(error) }) },
    }),
    Enriching: importer.invoke.all({
      name: "enrich",
      concurrency: 2,
      tasks: {
        geocode: {
          success: Schema.Tuple([Schema.Number, Schema.Number]),
          error: Schema.Never,
          effect: () => Effect.succeed([0, 0] as readonly [number, number]),
        },
        thumbnail: {
          success: Schema.String,
          error: Schema.Never,
          effect: (state) => Effect.succeed(`preview:${state.raw}`),
        },
      },
      onSuccess: {
        target: "Ready",
        reduce: ({ value }) => ({ coordinates: value.geocode, preview: value.thumbnail }),
      },
      onFailure: { target: "Failed", reduce: ({ error }) => ({ message: String(error) }) },
    }),
    Ready: importer.final(),
    Failed: importer.final(),
  },
)

export const Statecharts = {
  playerDefinition,
  editorDefinition,
  importerDefinition,
} as const
