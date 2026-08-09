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
const ChoosingResolution = Schema.TaggedStruct("ChoosingResolution", {
  localText: Schema.String,
  remoteText: Schema.String,
}).annotate({
  description: "Wait for the application to choose a merged document.",
})
const ConflictResolved = Schema.TaggedStruct("ConflictResolved", {
  text: Schema.String,
}).annotate({ description: "Return the chosen merged text to the document session." })
const ConflictAborted = Schema.TaggedStruct("ConflictAborted", {}).annotate({
  description: "Return without replacing the local document.",
})
const ConflictState = Schema.Union([ChoosingResolution, ConflictResolved, ConflictAborted]).pipe(
  Schema.toTaggedUnion("_tag"),
)
const ChooseResolution = Schema.TaggedStruct("ChooseResolution", {
  text: Schema.String,
}).annotate({ description: "Accept a merged version of the document." })
const AbortResolution = Schema.TaggedStruct("AbortResolution", {}).annotate({
  description: "Keep the local version and leave conflict resolution.",
})
const ConflictEvent = Schema.Union([ChooseResolution, AbortResolution]).pipe(
  Schema.toTaggedUnion("_tag"),
)

const conflict = Machine.builder({
  input: ConflictInput,
  state: ConflictState,
  event: ConflictEvent,
})

export const ConflictResolution = conflict.make({
  id: "local-first-conflict-resolution",
  description: "An interactive, state-owned conflict-resolution protocol.",
  initial: (input) => ({
    _tag: "ChoosingResolution",
    localText: input.localText,
    remoteText: input.remoteText,
  }),
  nodes: [
    conflict.state("ChoosingResolution", {
      on: {
        ChooseResolution: {
          target: "ConflictResolved",
          reduce: ({ event }) => ({ _tag: "ConflictResolved", text: event.text }),
        },
        AbortResolution: {
          target: "ConflictAborted",
          reduce: () => ({ _tag: "ConflictAborted" }),
        },
      },
    }),
    conflict.final("ConflictResolved"),
    conflict.final("ConflictAborted"),
  ],
})

const Input = Schema.Struct({ documentId: Schema.String }).annotate({
  description: "Select the one document owned by this session.",
})
const Opening = Schema.TaggedStruct("Opening", { documentId: Schema.String }).annotate({
  description: "Load the local document through the injected Documents service.",
})
const Editing = Schema.TaggedStruct("Editing", {
  documentId: Schema.String,
  text: Schema.String,
  revision: Schema.Number,
  dirty: Schema.Boolean,
}).annotate({ description: "Accept local edits and choose when to save or go offline." })
const Saving = Schema.TaggedStruct("Saving", {
  documentId: Schema.String,
  text: Schema.String,
  revision: Schema.Number,
  online: Schema.Boolean,
}).annotate({ description: "Persist the current text to local storage." })
const Syncing = Schema.TaggedStruct("Syncing", {
  documentId: Schema.String,
  text: Schema.String,
  revision: Schema.Number,
}).annotate({ description: "Synchronize a locally saved revision with the remote service." })
const Offline = Schema.TaggedStruct("Offline", {
  documentId: Schema.String,
  text: Schema.String,
  revision: Schema.Number,
  dirty: Schema.Boolean,
  pendingSync: Schema.Boolean,
}).annotate({ description: "Continue local work while remote synchronization is unavailable." })
const ResolvingConflict = Schema.TaggedStruct("ResolvingConflict", {
  documentId: Schema.String,
  localText: Schema.String,
  remoteText: Schema.String,
  revision: Schema.Number,
}).annotate({ description: "Own one scoped conflict-resolution child machine." })
const OpeningFailed = Schema.TaggedStruct("OpeningFailed", {
  documentId: Schema.String,
  message: Schema.String,
}).annotate({ description: "Finish after an expected local open failure." })
const SavingFailed = Schema.TaggedStruct("SavingFailed", {
  documentId: Schema.String,
  message: Schema.String,
}).annotate({ description: "Finish after an expected local save failure." })
const Closed = Schema.TaggedStruct("Closed", { documentId: Schema.String }).annotate({
  description: "Finish the document session and release all owned work.",
})

const State = Schema.Union([
  Opening,
  Editing,
  Saving,
  Syncing,
  Offline,
  ResolvingConflict,
  OpeningFailed,
  SavingFailed,
  Closed,
]).pipe(Schema.toTaggedUnion("_tag"))

const Edit = Schema.TaggedStruct("Edit", { text: Schema.String }).annotate({
  description: "Replace the current local text.",
})
const Save = Schema.TaggedStruct("Save", {}).annotate({
  description: "Persist local edits and synchronize when online.",
})
const GoOffline = Schema.TaggedStruct("GoOffline", {}).annotate({
  description: "Stop remote work and continue locally.",
})
const GoOnline = Schema.TaggedStruct("GoOnline", {}).annotate({
  description: "Resume remote synchronization when needed.",
})
const Cancel = Schema.TaggedStruct("Cancel", {}).annotate({
  description: "Cancel work owned by the current state.",
})
const ResolveConflict = Schema.TaggedStruct("ResolveConflict", { text: Schema.String }).annotate({
  description: "Forward a merged document to the conflict child.",
})
const AbortConflict = Schema.TaggedStruct("AbortConflict", {}).annotate({
  description: "Forward an abort decision to the conflict child.",
})
const Close = Schema.TaggedStruct("Close", {}).annotate({
  description: "Finish the document session.",
})
const Event = Schema.Union([
  Edit,
  Save,
  GoOffline,
  GoOnline,
  Cancel,
  ResolveConflict,
  AbortConflict,
  Close,
]).pipe(Schema.toTaggedUnion("_tag"))

const syncRetry = Schedule.recurs(2).pipe(
  Schedule.addDelay(() => Effect.succeed("1 minute")),
  Schedule.while(
    (metadata: Schedule.Metadata<number, SyncFailure>) => metadata.input._tag === "SyncOffline",
  ),
)

const document = Machine.builder({ input: Input, state: State, event: Event })

export const definition = document.make({
  id: "local-first-document",
  description: "A headless single-document local-first editing and synchronization session.",
  initial: (input) => ({ _tag: "Opening", documentId: input.documentId }),
  nodes: [
    document.invoke("Opening", {
      name: "Documents.open",
      description: "Load the local snapshot using the application-provided Documents service.",
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
      on: {
        Close: {
          target: "Closed",
          reduce: ({ state }) => ({ _tag: "Closed", documentId: state.documentId }),
        },
      },
    }),
    document.state("Editing", {
      on: {
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
      },
    }),
    document.invoke("Saving", {
      name: "Documents.save",
      description: "Persist the current text locally before any remote synchronization.",
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
      on: {
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
    }),
    document.invoke("Syncing", {
      name: "Synchronizer.sync",
      description: "Push the locally saved revision through the injected remote service.",
      effect: (state) =>
        Effect.flatMap(Synchronizer, ({ sync }) =>
          sync({ id: state.documentId, text: state.text, revision: state.revision }),
        ),
      retry: {
        name: "retry-while-offline",
        description: "Retry offline failures twice at one-minute intervals; never retry conflicts.",
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
      on: {
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
    }),
    document.state("Offline", {
      on: {
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
      },
    }),
    document.child("ResolvingConflict", {
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
      on: {
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
    }),
    document.final("OpeningFailed"),
    document.final("SavingFailed"),
    document.final("Closed"),
  ],
})

export const LocalFirstDocument = {
  Input,
  State,
  Event,
  definition,
  ConflictResolution,
} as const
