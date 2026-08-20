import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Machine from "effect-state-machine/Machine"

const EmptyInput = Schema.Struct({})

const RunnerState = Machine.taggedUnion({
  Idle: { fields: {} },
  Running: { fields: { speed: Schema.Number } },
})
const RunnerEvent = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number } },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: EmptyInput, state: RunnerState, event: RunnerEvent })

export const runnerDefinition = runner.define(
  {
    id: "docs-studio-demo",
    description: "A small repeatable machine for the embedded Studio demo.",
    initial: () => ({ _tag: "Idle" }),
  },
  {
    Idle: runner.state({
      Start: {
        target: "Running",
        reduce: ({ event }) => ({ speed: event.speed }),
      },
    }),
    Running: runner.state({
      Stop: { target: "Idle", reduce: () => ({}) },
    }),
  },
)

export const runnerStart = Machine.run(runnerDefinition, {})

export const runnerQuickEvents = [
  { id: "start", label: "Start at 7", event: { _tag: "Start", speed: 7 } },
  { id: "stop", label: "Stop", event: { _tag: "Stop" } },
] as const

const CounterInput = Schema.Struct({ initialCount: Schema.Number })
const CounterState = Machine.taggedUnion({
  Ready: { fields: { count: Schema.Number } },
  Counting: { fields: { count: Schema.Number } },
  Done: { fields: { count: Schema.Number } },
})
const CounterEvent = Machine.taggedUnion({
  Start: { fields: {} },
  Increment: { fields: { amount: Schema.Number } },
  Finish: { fields: {} },
})
const counter = Machine.builder({ input: CounterInput, state: CounterState, event: CounterEvent })

export const counterDefinition = counter.define(
  {
    id: "counter",
    description: "The counter from the first-machine tutorial.",
    initial: ({ initialCount }) => ({ _tag: "Ready", count: initialCount }),
  },
  {
    Ready: counter.state({
      Start: {
        target: "Counting",
        reduce: ({ state }) => ({ count: state.count }),
      },
    }),
    Counting: counter.state({
      Increment: {
        stay: ({ state, event }) => ({ count: state.count + event.amount }),
      },
      Finish: {
        target: "Done",
        reduce: ({ state }) => ({ count: state.count }),
      },
    }),
    Done: counter.final(),
  },
)

export const counterStart = Machine.run(counterDefinition, { initialCount: 1 })

export const counterQuickEvents = [
  { id: "start", label: "Start counting", event: { _tag: "Start" } },
  { id: "increment", label: "Increment by 3", event: { _tag: "Increment", amount: 3 } },
  { id: "finish", label: "Finish", event: { _tag: "Finish" } },
] as const

const ClassifierState = Machine.taggedUnion({
  Ready: { fields: {} },
  Positive: { fields: { value: Schema.Number } },
  Even: { fields: { value: Schema.Number } },
  Other: { fields: { value: Schema.Number } },
})
const ClassifierEvent = Machine.taggedUnion({
  Decide: { fields: { value: Schema.Number } },
  Ping: { fields: {} },
  Reset: { fields: {} },
})
const classifier = Machine.builder({
  input: EmptyInput,
  state: ClassifierState,
  event: ClassifierEvent,
})

const resetClassifier = {
  Reset: { target: "Ready", reduce: () => ({}) },
} as const

export const classifierDefinition = classifier.define(
  { id: "guarded-classifier", initial: () => ({ _tag: "Ready" }) },
  {
    Ready: classifier.state({
      Decide: {
        branches: [
          {
            when: {
              name: "is-positive",
              description: "Positive values take precedence.",
              guard: ({ event }) => event.value > 0,
            },
            target: "Positive",
            reduce: ({ event }) => ({ value: event.value }),
          },
          {
            when: {
              name: "is-even",
              description: "Non-positive even values use the Even state.",
              guard: ({ event }) => event.value % 2 === 0,
            },
            target: "Even",
            reduce: ({ event }) => ({ value: event.value }),
          },
          {
            otherwise: true,
            target: "Other",
            reduce: ({ event }) => ({ value: event.value }),
          },
        ],
      },
      Ping: { ignore: { description: "Heartbeats do not affect classification." } },
    }),
    Positive: classifier.state(resetClassifier),
    Even: classifier.state(resetClassifier),
    Other: classifier.state(resetClassifier),
  },
)

export const classifierStart = Machine.run(classifierDefinition, {})

export const classifierQuickEvents = [
  { id: "positive", label: "Decide 5", event: { _tag: "Decide", value: 5 } },
  { id: "even", label: "Decide -4", event: { _tag: "Decide", value: -4 } },
  { id: "other", label: "Decide -3", event: { _tag: "Decide", value: -3 } },
  { id: "ping", label: "Ignore Ping", event: { _tag: "Ping" } },
  { id: "reset", label: "Reset", event: { _tag: "Reset" } },
] as const

class LoadFailed extends Schema.TaggedError<LoadFailed>()("LoadFailed", {
  message: Schema.String,
}) {}

class Profiles extends Context.Service<
  Profiles,
  Readonly<{ load: (id: string) => Effect.Effect<string, LoadFailed> }>
>()("docs/Profiles") {}

const ProfileInput = Schema.Struct({ id: Schema.String })
const ProfileState = Machine.taggedUnion({
  Loading: { fields: { id: Schema.String } },
  Loaded: { fields: { name: Schema.String, id: Schema.String } },
  Failed: { fields: { message: Schema.String, id: Schema.String } },
})
const ProfileEvent = Machine.taggedUnion({
  Cancel: { fields: {} },
  Reload: { fields: {} },
})
const profile = Machine.builder({ input: ProfileInput, state: ProfileState, event: ProfileEvent })

export const profileDefinition = profile.define(
  { id: "profile", initial: ({ id }) => ({ _tag: "Loading", id }) },
  {
    Loading: profile.invoke(
      {
        name: "Profiles.load",
        success: Schema.String,
        error: LoadFailed,
        effect: (state) => Effect.flatMap(Profiles, ({ load }) => load(state.id)),
        onSuccess: {
          target: "Loaded",
          reduce: ({ state, value }) => ({ name: value, id: state.id }),
        },
        onFailure: {
          target: "Failed",
          reduce: ({ state, error }) => ({ message: error.message, id: state.id }),
        },
      },
      {
        Cancel: {
          target: "Failed",
          reduce: ({ state }) => ({ message: "Cancelled by the user", id: state.id }),
        },
      },
    ),
    Loaded: profile.state({
      Reload: { target: "Loading", reduce: ({ state }) => ({ id: state.id }) },
    }),
    Failed: profile.state({
      Reload: { target: "Loading", reduce: ({ state }) => ({ id: state.id }) },
    }),
  },
)

const ProfilesLive = Layer.succeed(
  Profiles,
  Profiles.of({
    load: (id) => Effect.sleep("900 millis").pipe(Effect.as(`profile-${id}`)),
  }),
)

export const profileStart = Machine.run(profileDefinition, { id: "42" }).pipe(
  Effect.provide(ProfilesLive),
)

export const profileQuickEvents = [
  { id: "cancel", label: "Cancel load", event: { _tag: "Cancel" } },
  { id: "reload", label: "Load again", event: { _tag: "Reload" } },
] as const

class PlaceFailed extends Schema.TaggedError<PlaceFailed>()("PlaceFailed", {
  attempt: Schema.Number,
  message: Schema.String,
}) {}

class Orders extends Context.Service<
  Orders,
  Readonly<{
    place: (total: number, shouldSucceed: boolean) => Effect.Effect<string, PlaceFailed>
  }>
>()("docs/Orders") {}

const RetryState = Machine.taggedUnion({
  Ready: { fields: { total: Schema.Number } },
  Attempting: {
    fields: { total: Schema.Number, shouldSucceed: Schema.Boolean },
  },
  Succeeded: { fields: { orderId: Schema.String } },
  Failed: { fields: { message: Schema.String } },
})
const RetryEvent = Machine.taggedUnion({
  RunSuccess: { fields: {} },
  RunFailure: { fields: {} },
  Reset: { fields: {} },
})
const orders = Machine.builder({ input: EmptyInput, state: RetryState, event: RetryEvent })

export const retryDefinition = orders.define(
  { id: "retry-orders", initial: () => ({ _tag: "Ready", total: 25 }) },
  {
    Ready: orders.state({
      RunSuccess: {
        target: "Attempting",
        reduce: ({ state }) => ({ total: state.total, shouldSucceed: true }),
      },
      RunFailure: {
        target: "Attempting",
        reduce: ({ state }) => ({ total: state.total, shouldSucceed: false }),
      },
    }),
    Attempting: orders.invoke({
      name: "Orders.place",
      success: Schema.String,
      error: PlaceFailed,
      effect: (state) =>
        Effect.flatMap(Orders, ({ place }) => place(state.total, state.shouldSucceed)),
      retry: {
        name: "retry-transient-order-failures",
        description: "Retry twice before showing the failure.",
        schedule: Schedule.recurs(2),
      },
      onSuccess: {
        target: "Succeeded",
        reduce: ({ value }) => ({ orderId: value }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ message: error.message }),
      },
    }),
    Succeeded: orders.state({
      Reset: { target: "Ready", reduce: () => ({ total: 25 }) },
    }),
    Failed: orders.state({
      Reset: { target: "Ready", reduce: () => ({ total: 25 }) },
    }),
  },
)

const OrdersLive = Layer.effect(
  Orders,
  Effect.map(Ref.make(0), (attempts) =>
    Orders.of({
      place: (total, shouldSucceed) =>
        Effect.sleep("350 millis").pipe(
          Effect.andThen(Ref.updateAndGet(attempts, (attempt) => attempt + 1)),
          Effect.flatMap((attempt) =>
            shouldSucceed && attempt % 3 === 0
              ? Effect.succeed(`order-${total}-${attempt}`)
              : Effect.fail(
                  new PlaceFailed({
                    attempt,
                    message: `Attempt ${attempt} failed`,
                  }),
                ),
          ),
        ),
    }),
  ),
)

export const retryStart = Machine.run(retryDefinition, {}).pipe(Effect.provide(OrdersLive))

export const retryQuickEvents = [
  { id: "success", label: "Retry, then succeed", event: { _tag: "RunSuccess" } },
  { id: "failure", label: "Exhaust retries", event: { _tag: "RunFailure" } },
  { id: "reset", label: "Reset", event: { _tag: "Reset" } },
] as const

class SaveFailed extends Schema.TaggedError<SaveFailed>()("SaveFailed", {
  message: Schema.String,
}) {}

class ConflictStore extends Context.Service<
  ConflictStore,
  Readonly<{ save: (text: string) => Effect.Effect<string, SaveFailed> }>
>()("docs/ConflictStore") {}

const ConflictInput = Schema.Struct({ documentId: Schema.String })
const ConflictState = Machine.taggedUnion({
  Choosing: { fields: { documentId: Schema.String } },
  Saving: { fields: { text: Schema.String } },
  Chosen: { fields: { text: Schema.String } },
  ChildFailed: { fields: { message: Schema.String } },
})
const ConflictEvent = Machine.taggedUnion({
  Choose: { fields: { text: Schema.String } },
})
const conflict = Machine.builder({
  input: ConflictInput,
  state: ConflictState,
  event: ConflictEvent,
})

const conflictDefinition = conflict.define(
  {
    id: "conflict-resolution",
    initial: ({ documentId }) => ({ _tag: "Choosing", documentId }),
  },
  {
    Choosing: conflict.state({
      Choose: { target: "Saving", reduce: ({ event }) => ({ text: event.text }) },
    }),
    Saving: conflict.invoke({
      name: "ConflictStore.save",
      success: Schema.String,
      error: SaveFailed,
      effect: (state) => Effect.flatMap(ConflictStore, ({ save }) => save(state.text)),
      onSuccess: {
        target: "Chosen",
        reduce: ({ value }) => ({ text: value }),
      },
      onFailure: {
        target: "ChildFailed",
        reduce: ({ error }) => ({ message: error.message }),
      },
    }),
    Chosen: conflict.final(),
    ChildFailed: conflict.final(),
  },
)

const DocumentInput = Schema.Struct({ documentId: Schema.String })
const DocumentState = Machine.taggedUnion({
  Resolving: { fields: { documentId: Schema.String } },
  Resolved: { fields: { text: Schema.String } },
  ResolutionFailed: { fields: { message: Schema.String } },
  Cancelled: { fields: {} },
})
const DocumentEvent = Machine.taggedUnion({
  Resolve: { fields: { text: Schema.String } },
  Cancel: { fields: {} },
})
const document = Machine.builder({
  input: DocumentInput,
  state: DocumentState,
  event: DocumentEvent,
})

export const childDefinition = document.define(
  {
    id: "document-session",
    initial: ({ documentId }) => ({ _tag: "Resolving", documentId }),
  },
  {
    Resolving: document.child(
      {
        name: "resolve-conflict",
        description: "Own the conflict-resolution protocol.",
        definition: conflictDefinition,
        input: (state) => ({ documentId: state.documentId }),
        forward: {
          Resolve: {
            target: "Choose",
            map: ({ event }) => ({ _tag: "Choose", text: event.text }),
          },
        },
        onComplete: {
          branches: [
            {
              when: {
                name: "resolution-succeeded",
                guard: ({ value }) => value._tag === "Chosen",
              },
              target: "Resolved",
              reduce: ({ value }) => ({
                text: value._tag === "Chosen" ? value.text : "",
              }),
            },
            {
              otherwise: true,
              target: "ResolutionFailed",
              reduce: ({ value }) => ({
                message: value._tag === "ChildFailed" ? value.message : "unknown",
              }),
            },
          ],
        },
      },
      {
        Cancel: { target: "Cancelled", reduce: () => ({}) },
      },
    ),
    Resolved: document.final(),
    ResolutionFailed: document.final(),
    Cancelled: document.final(),
  },
)

const ConflictStoreLive = Layer.succeed(
  ConflictStore,
  ConflictStore.of({
    save: (text) => Effect.sleep("650 millis").pipe(Effect.as(text)),
  }),
)

export const childStart = Machine.run(childDefinition, { documentId: "doc-42" }).pipe(
  Effect.provide(ConflictStoreLive),
)

export const childQuickEvents = [
  {
    id: "resolve",
    label: "Resolve with local text",
    event: { _tag: "Resolve", text: "local text" },
  },
  { id: "cancel", label: "Cancel", event: { _tag: "Cancel" } },
] as const

const Playback = Schema.TaggedUnion({
  Playing: {},
  Paused: { position: Schema.Number },
})
const Volume = Schema.TaggedUnion({ Audible: {}, Muted: {} })
const PlayerState = Machine.taggedUnion({
  Idle: { fields: {} },
  Active: {
    fields: {
      trackId: Schema.String,
      playback: Playback,
      volume: Volume,
    },
  },
  Stopped: { fields: {} },
})
const PlayerEvent = Machine.taggedUnion({
  Play: { fields: { trackId: Schema.String } },
  Pause: { fields: { position: Schema.Number } },
  Resume: { fields: {} },
  Mute: { fields: {} },
  Unmute: { fields: {} },
  ToggleAll: { fields: {} },
  Stop: { fields: {} },
  Reset: { fields: {} },
})
const player = Machine.builder({ input: EmptyInput, state: PlayerState, event: PlayerEvent })

export const parallelDefinition = player.define(
  { id: "parallel-player", initial: () => ({ _tag: "Idle" }) },
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
            Pause: {
              target: "Paused",
              reduce: ({ event }) => ({ position: event.position }),
            },
            ToggleAll: { target: "Paused", reduce: () => ({ position: 12 }) },
          },
          Paused: {
            Resume: { target: "Playing", reduce: () => ({}) },
            ToggleAll: { target: "Playing", reduce: () => ({}) },
          },
        },
        volume: {
          Audible: {
            Mute: { target: "Muted", reduce: () => ({}) },
            ToggleAll: { target: "Muted", reduce: () => ({}) },
          },
          Muted: {
            Unmute: { target: "Audible", reduce: () => ({}) },
            ToggleAll: { target: "Audible", reduce: () => ({}) },
          },
        },
      },
      {
        Stop: { target: "Stopped", reduce: () => ({}) },
      },
    ),
    Stopped: player.state({
      Reset: { target: "Idle", reduce: () => ({}) },
    }),
  },
)

export const parallelStart = Machine.run(parallelDefinition, {})

export const parallelQuickEvents = [
  { id: "play", label: "Play track-42", event: { _tag: "Play", trackId: "track-42" } },
  { id: "toggle", label: "Toggle both regions", event: { _tag: "ToggleAll" } },
  { id: "pause", label: "Pause at 12", event: { _tag: "Pause", position: 12 } },
  { id: "resume", label: "Resume", event: { _tag: "Resume" } },
  { id: "mute", label: "Mute", event: { _tag: "Mute" } },
  { id: "unmute", label: "Unmute", event: { _tag: "Unmute" } },
  { id: "stop", label: "Stop", event: { _tag: "Stop" } },
  { id: "reset", label: "Reset", event: { _tag: "Reset" } },
] as const
