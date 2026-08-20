import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {} },
  Running: { fields: { speed: Schema.Number } },
  Done: { fields: {} },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number } },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: Input, state: State, event: Event })

export const definition = runner.define(
  {
    id: "embedded-runner",
    idempotencyKey: () => "runner",
    initial: () => ({ _tag: "Idle" }),
  },
  {
    Idle: runner.state({
      Start: {
        target: "Running",
        reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
      },
    }),
    Running: runner.state({
      Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) },
    }),
    Done: runner.final(),
  },
)

const Playback = Schema.TaggedUnion({ Playing: {}, Paused: {} })
const Volume = Schema.TaggedUnion({ Audible: {}, Muted: {} })
const RegionState = Machine.taggedUnion({
  Active: { fields: { playback: Playback, volume: Volume } },
})
const RegionEvent = Machine.taggedUnion({ Toggle: { fields: {} } })
const regions = Machine.builder({ input: Schema.Void, state: RegionState, event: RegionEvent })

export const regionDefinition = regions.define(
  {
    id: "embedded-regions",
    idempotencyKey: () => "regions",
    initial: () => ({
      _tag: "Active",
      playback: { _tag: "Playing" },
      volume: { _tag: "Audible" },
    }),
  },
  {
    Active: regions.regions({
      playback: {
        Playing: { Toggle: { target: "Paused", reduce: () => ({}) } },
        Paused: { Toggle: { target: "Playing", reduce: () => ({}) } },
      },
      volume: {
        Audible: { Toggle: { target: "Muted", reduce: () => ({}) } },
        Muted: { Toggle: { target: "Audible", reduce: () => ({}) } },
      },
    }),
  },
)
