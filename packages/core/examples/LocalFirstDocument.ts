import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Machine from "../src/Machine.js"

export interface Document {
  readonly id: string
  readonly text: string
  readonly revision: number
}

export interface SaveRequest extends Document {}

const DocumentOutcome = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  revision: Schema.Number,
})

export class OpenFailed extends Schema.TaggedError<OpenFailed>()("OpenFailed", {
  message: Schema.String,
}) {}

export class SaveFailed extends Schema.TaggedError<SaveFailed>()("SaveFailed", {
  message: Schema.String,
}) {}

export class SyncOffline extends Schema.TaggedError<SyncOffline>()("SyncOffline", {
  message: Schema.String,
}) {}

export class SyncConflict extends Schema.TaggedError<SyncConflict>()("SyncConflict", {
  remoteText: Schema.String,
}) {}

export type SyncFailure = SyncOffline | SyncConflict
const SyncError = Schema.Union([SyncOffline, SyncConflict])

export class Documents extends Context.Service<
  Documents,
  Readonly<{
    open: (documentId: string) => Effect.Effect<Document, OpenFailed>
    save: (request: SaveRequest) => Effect.Effect<number, SaveFailed>
  }>
>()("examples/Documents") {}

export class Synchronizer extends Context.Service<
  Synchronizer,
  Readonly<{
    sync: (document: Document) => Effect.Effect<number, SyncFailure>
  }>
>()("examples/Synchronizer") {}

const ConflictInput = Schema.Struct({
  localText: Schema.String,
  remoteText: Schema.String,
})
const ConflictState = Machine.taggedUnion({
  ChoosingResolution: {
    fields: {
      localText: Schema.String,
      remoteText: Schema.String,
    },
    description: "Wait for the application to choose a merged document.",
  },
  ConflictResolved: {
    fields: { text: Schema.String },
    description: "Return the chosen merged text to the document session.",
  },
  ConflictAborted: {
    fields: {},
    description: "Return without replacing the local document.",
  },
})
const ConflictEvent = Machine.taggedUnion({
  ChooseResolution: {
    fields: { text: Schema.String },
    description: "Accept a merged version of the document.",
  },
  AbortResolution: {
    fields: {},
    description: "Keep the local version and leave conflict resolution.",
  },
})

const conflict = Machine.builder({
  input: ConflictInput,
  state: ConflictState,
  event: ConflictEvent,
})

export const ConflictResolution = conflict.define(
  {
    id: "local-first-conflict-resolution",
    description: "An interactive, state-owned conflict-resolution protocol.",
    initial: (input) => ({
      _tag: "ChoosingResolution",
      localText: input.localText,
      remoteText: input.remoteText,
    }),
  },
  {
    ChoosingResolution: conflict.state({
      ChooseResolution: {
        target: "ConflictResolved",
        reduce: ({ event }) => ({ _tag: "ConflictResolved", text: event.text }),
      },
      AbortResolution: {
        target: "ConflictAborted",
        reduce: () => ({ _tag: "ConflictAborted" }),
      },
    }),
    ConflictResolved: conflict.final(),
    ConflictAborted: conflict.final(),
  },
)

const Input = Schema.Struct({ documentId: Schema.String }).annotate({
  description: "Select the one document owned by this session.",
})
const State = Machine.taggedUnion({
  Opening: {
    fields: { documentId: Schema.String },
    description: "Load the local document through the injected Documents service.",
  },
  Editing: {
    fields: {
      documentId: Schema.String,
      text: Schema.String,
      revision: Schema.Number,
      dirty: Schema.Boolean,
    },
    description: "Accept local edits and choose when to save or go offline.",
  },
  Saving: {
    fields: {
      documentId: Schema.String,
      text: Schema.String,
      revision: Schema.Number,
      online: Schema.Boolean,
    },
    description: "Persist the current text to local storage.",
  },
  Syncing: {
    fields: {
      documentId: Schema.String,
      text: Schema.String,
      revision: Schema.Number,
    },
    description: "Synchronize a locally saved revision with the remote service.",
  },
  Offline: {
    fields: {
      documentId: Schema.String,
      text: Schema.String,
      revision: Schema.Number,
      dirty: Schema.Boolean,
      pendingSync: Schema.Boolean,
    },
    description: "Continue local work while remote synchronization is unavailable.",
  },
  ResolvingConflict: {
    fields: {
      documentId: Schema.String,
      localText: Schema.String,
      remoteText: Schema.String,
      revision: Schema.Number,
    },
    description: "Own one scoped conflict-resolution child machine.",
  },
  OpeningFailed: {
    fields: {
      documentId: Schema.String,
      message: Schema.String,
    },
    description: "Finish after an expected local open failure.",
  },
  SavingFailed: {
    fields: {
      documentId: Schema.String,
      message: Schema.String,
    },
    description: "Finish after an expected local save failure.",
  },
  Closed: {
    fields: { documentId: Schema.String },
    description: "Finish the document session and release all owned work.",
  },
})

const Event = Machine.taggedUnion({
  Edit: {
    fields: { text: Schema.String },
    description: "Replace the current local text.",
  },
  Save: {
    fields: {},
    description: "Persist local edits and synchronize when online.",
  },
  GoOffline: {
    fields: {},
    description: "Stop remote work and continue locally.",
  },
  GoOnline: {
    fields: {},
    description: "Resume remote synchronization when needed.",
  },
  Cancel: {
    fields: {},
    description: "Cancel work owned by the current state.",
  },
  ResolveConflict: {
    fields: { text: Schema.String },
    description: "Forward a merged document to the conflict child.",
  },
  AbortConflict: {
    fields: {},
    description: "Forward an abort decision to the conflict child.",
  },
  Close: {
    fields: {},
    description: "Finish the document session.",
  },
})

const syncRetry = Schedule.recurs(2).pipe(
  Schedule.addDelay(() => Effect.succeed("1 minute")),
  Schedule.while(
    (metadata: Schedule.Metadata<number, SyncFailure>) => metadata.input._tag === "SyncOffline",
  ),
)

const document = Machine.builder({ input: Input, state: State, event: Event })

export const definition = document.define(
  {
    id: "local-first-document",
    description: "A headless single-document local-first editing and synchronization session.",
    initial: (input) => ({ _tag: "Opening", documentId: input.documentId }),
  },
  {
    Opening: document.invoke(
      {
        name: "Documents.open",
        description: "Load the local snapshot using the application-provided Documents service.",
        success: DocumentOutcome,
        error: OpenFailed,
        effect: (state) => Effect.flatMap(Documents, ({ open }) => open(state.documentId)),
        onSuccess: {
          target: "Editing",
          reduce: ({ value }) => ({
            _tag: "Editing",
            documentId: value.id,
            text: value.text,
            revision: value.revision,
            dirty: false,
          }),
        },
        onFailure: {
          target: "OpeningFailed",
          reduce: ({ state, error }) => ({
            _tag: "OpeningFailed",
            documentId: state.documentId,
            message: error.message,
          }),
        },
      },
      {
        Close: {
          target: "Closed",
          reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
        },
      },
    ),
    Editing: document.state({
      Edit: {
        target: "Editing",
        reduce: ({ state, event }) => ({ ...state, text: event.text, dirty: true }),
      },
      Save: {
        target: "Saving",
        reduce: ({ state }) => ({
          _tag: "Saving",
          documentId: state.documentId,
          text: state.text,
          revision: state.revision,
          online: true,
        }),
      },
      GoOffline: {
        target: "Offline",
        reduce: ({ state }) => ({
          _tag: "Offline",
          documentId: state.documentId,
          text: state.text,
          revision: state.revision,
          dirty: state.dirty,
          pendingSync: false,
        }),
      },
      Close: {
        target: "Closed",
        reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
      },
    }),
    Saving: document.invoke(
      {
        name: "Documents.save",
        description: "Persist the current text locally before any remote synchronization.",
        success: Schema.Number,
        error: SaveFailed,
        effect: (state) =>
          Effect.flatMap(Documents, ({ save }) =>
            save({ id: state.documentId, text: state.text, revision: state.revision }),
          ),
        onSuccess: {
          branches: [
            {
              when: {
                name: "still-online",
                description: "Continue into remote synchronization only while online.",
                guard: ({ state }) => state.online,
              },
              target: "Syncing",
              reduce: ({ state, value }) => ({
                _tag: "Syncing",
                documentId: state.documentId,
                text: state.text,
                revision: value,
              }),
            },
            {
              otherwise: true,
              target: "Offline",
              reduce: ({ state, value }) => ({
                _tag: "Offline",
                documentId: state.documentId,
                text: state.text,
                revision: value,
                dirty: false,
                pendingSync: true,
              }),
            },
          ],
        },
        onFailure: {
          target: "SavingFailed",
          reduce: ({ state, error }) => ({
            _tag: "SavingFailed",
            documentId: state.documentId,
            message: error.message,
          }),
        },
      },
      {
        GoOffline: {
          target: "Offline",
          reduce: ({ state }) => ({
            _tag: "Offline",
            documentId: state.documentId,
            text: state.text,
            revision: state.revision,
            dirty: true,
            pendingSync: false,
          }),
        },
        Cancel: {
          target: "Editing",
          reduce: ({ state }) => ({
            _tag: "Editing",
            documentId: state.documentId,
            text: state.text,
            revision: state.revision,
            dirty: true,
          }),
        },
        Close: {
          target: "Closed",
          reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
        },
      },
    ),
    Syncing: document.invoke(
      {
        name: "Synchronizer.sync",
        description: "Push the locally saved revision through the injected remote service.",
        success: Schema.Number,
        error: SyncError,
        effect: (state) =>
          Effect.flatMap(Synchronizer, ({ sync }) =>
            sync({ id: state.documentId, text: state.text, revision: state.revision }),
          ),
        retry: {
          name: "retry-while-offline",
          description:
            "Retry offline failures twice at one-minute intervals; never retry conflicts.",
          schedule: syncRetry,
        },
        onSuccess: {
          target: "Editing",
          reduce: ({ state, value }) => ({
            _tag: "Editing",
            documentId: state.documentId,
            text: state.text,
            revision: value,
            dirty: false,
          }),
        },
        onFailure: {
          branches: [
            {
              when: {
                name: "remote-conflict",
                description: "Open the interactive conflict child for remote conflicts.",
                guard: ({ error }) => error._tag === "SyncConflict",
              },
              target: "ResolvingConflict",
              reduce: ({ state, error }) => ({
                _tag: "ResolvingConflict",
                documentId: state.documentId,
                localText: state.text,
                remoteText: error._tag === "SyncConflict" ? error.remoteText : "",
                revision: state.revision,
              }),
            },
            {
              otherwise: true,
              target: "Offline",
              reduce: ({ state }) => ({
                _tag: "Offline",
                documentId: state.documentId,
                text: state.text,
                revision: state.revision,
                dirty: false,
                pendingSync: true,
              }),
            },
          ],
        },
      },
      {
        GoOffline: {
          target: "Offline",
          reduce: ({ state }) => ({
            _tag: "Offline",
            documentId: state.documentId,
            text: state.text,
            revision: state.revision,
            dirty: false,
            pendingSync: true,
          }),
        },
        Cancel: {
          target: "Editing",
          reduce: ({ state }) => ({
            _tag: "Editing",
            documentId: state.documentId,
            text: state.text,
            revision: state.revision,
            dirty: false,
          }),
        },
        Close: {
          target: "Closed",
          reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
        },
      },
    ),
    Offline: document.state({
      Edit: {
        target: "Offline",
        reduce: ({ state, event }) => ({ ...state, text: event.text, dirty: true }),
      },
      Save: {
        target: "Saving",
        reduce: ({ state }) => ({
          _tag: "Saving",
          documentId: state.documentId,
          text: state.text,
          revision: state.revision,
          online: false,
        }),
      },
      GoOnline: {
        branches: [
          {
            when: {
              name: "has-pending-sync",
              guard: ({ state }) => state.pendingSync,
            },
            target: "Syncing",
            reduce: ({ state }) => ({
              _tag: "Syncing",
              documentId: state.documentId,
              text: state.text,
              revision: state.revision,
            }),
          },
          {
            otherwise: true,
            target: "Editing",
            reduce: ({ state }) => ({
              _tag: "Editing",
              documentId: state.documentId,
              text: state.text,
              revision: state.revision,
              dirty: state.dirty,
            }),
          },
        ],
      },
      Close: {
        target: "Closed",
        reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
      },
    }),
    ResolvingConflict: document.child(
      {
        name: "resolve-conflict",
        description: "Run the interactive conflict protocol only while conflict state is visible.",
        definition: ConflictResolution,
        input: (state) => ({ localText: state.localText, remoteText: state.remoteText }),
        forward: {
          ResolveConflict: {
            target: "ChooseResolution",
            description: "Forward the chosen merged text to the child.",
            map: ({ event }) => ({ _tag: "ChooseResolution", text: event.text }),
          },
          AbortConflict: {
            target: "AbortResolution",
            description: "Forward the decision to keep the local version.",
            map: (): { readonly _tag: "AbortResolution" } => ({ _tag: "AbortResolution" }),
          },
        },
        onComplete: {
          branches: [
            {
              when: {
                name: "merge-selected",
                guard: ({ value }) => value._tag === "ConflictResolved",
              },
              target: "Saving",
              reduce: ({ state, value }) => ({
                _tag: "Saving",
                documentId: state.documentId,
                text: value._tag === "ConflictResolved" ? value.text : state.localText,
                revision: state.revision,
                online: true,
              }),
            },
            {
              otherwise: true,
              target: "Editing",
              reduce: ({ state }) => ({
                _tag: "Editing",
                documentId: state.documentId,
                text: state.localText,
                revision: state.revision,
                dirty: false,
              }),
            },
          ],
        },
      },
      {
        Cancel: {
          target: "Editing",
          reduce: ({ state }) => ({
            _tag: "Editing",
            documentId: state.documentId,
            text: state.localText,
            revision: state.revision,
            dirty: false,
          }),
        },
        Close: {
          target: "Closed",
          reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
        },
      },
    ),
    OpeningFailed: document.final(),
    SavingFailed: document.final(),
    Closed: document.final(),
  },
)

export const LocalFirstDocument = {
  Input,
  State,
  Event,
  definition,
  ConflictResolution,
} as const
