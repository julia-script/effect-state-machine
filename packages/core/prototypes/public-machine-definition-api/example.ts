/**
 * Throwaway API evidence for ticket 01.
 *
 * This definition is compile-checked to evaluate authoring ergonomics. It is
 * not the production machine implementation.
 */
import { Context, Effect, Schedule, Schema, type Stream } from "effect"
import {
  type InspectionEvent,
  Machine,
  type MachineCompletion,
  type MachineHandle,
  type MachineRequirements,
} from "./machine"

class DocumentUnavailable extends Schema.TaggedError<DocumentUnavailable>()("DocumentUnavailable", {
  message: Schema.String,
}) {}

class Documents extends Context.Service<
  Documents,
  Readonly<{
    open: (documentId: string) => Effect.Effect<string, DocumentUnavailable>
    save: (documentId: string, text: string) => Effect.Effect<void, DocumentUnavailable>
  }>
>()("prototype/Documents") {}

class InvalidResolution extends Schema.TaggedError<InvalidResolution>()("InvalidResolution", {
  message: Schema.String,
}) {}

class RetryExhausted extends Schema.TaggedError<RetryExhausted>()("RetryExhausted", {
  message: Schema.String,
}) {}

class ConflictPolicy extends Context.Service<
  ConflictPolicy,
  Readonly<{
    validate: (text: string) => Effect.Effect<string, InvalidResolution>
  }>
>()("prototype/ConflictPolicy") {}

const ConflictInput = Schema.Struct({
  documentId: Schema.String,
  localText: Schema.String,
  remoteText: Schema.String,
}).annotate({
  title: "Conflict input",
  description: "The two document versions that need an explicit choice.",
})

const Deciding = Schema.TaggedStruct("Deciding", {
  localText: Schema.String,
  remoteText: Schema.String,
}).annotate({
  title: "Deciding",
  description: "Wait for the developer to choose a document version.",
})

const Validating = Schema.TaggedStruct("Validating", {
  localText: Schema.String,
  remoteText: Schema.String,
  selectedText: Schema.String,
}).annotate({
  title: "Validating",
  description: "Validate the selected conflict resolution.",
})

const Resolved = Schema.TaggedStruct("Resolved", {
  text: Schema.String,
}).annotate({
  title: "Resolved",
  description: "The selected version is valid and completes conflict resolution.",
})

const ConflictState = Schema.Union([Deciding, Validating, Resolved]).pipe(
  Schema.toTaggedUnion("_tag"),
)

const ChooseLocal = Schema.TaggedStruct("ChooseLocal", {}).annotate({
  title: "Choose local",
  description: "Resolve the conflict with the local version.",
})

const ChooseRemote = Schema.TaggedStruct("ChooseRemote", {}).annotate({
  title: "Choose remote",
  description: "Resolve the conflict with the remote version.",
})

const ConflictEvent = Schema.Union([ChooseLocal, ChooseRemote]).pipe(Schema.toTaggedUnion("_tag"))

const conflict = Machine.builder({
  input: ConflictInput,
  state: ConflictState,
  event: ConflictEvent,
})

const conflictDefinition = conflict.make({
  id: "resolve-conflict",
  description: "Makes conflict resolution an isolated, visible protocol.",
  initial: (input) => ({
    _tag: "Deciding",
    localText: input.localText,
    remoteText: input.remoteText,
  }),
  nodes: [
    conflict.state("Deciding", {
      on: {
        ChooseLocal: {
          target: "Validating",
          reduce: ({ state }) => ({
            _tag: "Validating",
            localText: state.localText,
            remoteText: state.remoteText,
            selectedText: state.localText,
          }),
        },
        ChooseRemote: {
          target: "Validating",
          reduce: ({ state }) => ({
            _tag: "Validating",
            localText: state.localText,
            remoteText: state.remoteText,
            selectedText: state.remoteText,
          }),
        },
      },
    }),
    conflict.invoke("Validating", {
      name: "ConflictPolicy.validate",
      description: "Validate the selected text with a dependency supplied at execution time.",
      success: Schema.String,
      error: InvalidResolution,
      effect: (state) =>
        Effect.flatMap(ConflictPolicy, (policy) => policy.validate(state.selectedText)),
      onSuccess: {
        target: "Resolved",
        reduce: ({ value }) => ({ _tag: "Resolved", text: value }),
      },
      onFailure: {
        target: "Deciding",
        reduce: ({ state }) => ({
          _tag: "Deciding",
          localText: state.localText,
          remoteText: state.remoteText,
        }),
      },
      on: {},
    }),
    conflict.final("Resolved"),
  ],
})

const DocumentInput = Schema.Struct({
  documentId: Schema.String,
}).annotate({
  title: "Document input",
  description: "Identifies the document this machine should open.",
})

const Closed = Schema.TaggedStruct("Closed", {
  documentId: Schema.String,
}).annotate({
  title: "Closed",
  description: "The document has not been opened yet.",
})

const Editing = Schema.TaggedStruct("Editing", {
  documentId: Schema.String,
  text: Schema.String,
  dirty: Schema.Boolean,
}).annotate({
  title: "Editing",
  description: "The document is open and may contain unsaved changes.",
})

const Opening = Schema.TaggedStruct("Opening", {
  documentId: Schema.String,
}).annotate({
  title: "Opening",
  description: "The document contents are being loaded.",
})

const Saving = Schema.TaggedStruct("Saving", {
  documentId: Schema.String,
  text: Schema.String,
}).annotate({
  title: "Saving",
  description: "The current document contents are being saved.",
})

const Resolving = Schema.TaggedStruct("Resolving", {
  documentId: Schema.String,
  localText: Schema.String,
  remoteText: Schema.String,
}).annotate({
  title: "Resolving",
  description: "A child machine owns the active conflict-resolution protocol.",
})

const Failed = Schema.TaggedStruct("Failed", {
  documentId: Schema.String,
  message: Schema.String,
}).annotate({
  title: "Failed",
  description: "An expected document operation failed.",
})

const Done = Schema.TaggedStruct("Done", {
  documentId: Schema.String,
}).annotate({
  title: "Done",
  description: "The document session completed normally.",
})

const DocumentState = Schema.Union([
  Closed,
  Opening,
  Editing,
  Saving,
  Resolving,
  Failed,
  Done,
]).pipe(Schema.toTaggedUnion("_tag"))

const Open = Schema.TaggedStruct("Open", {}).annotate({
  title: "Open",
  description: "Open the selected document.",
})

const Save = Schema.TaggedStruct("Save", {}).annotate({
  title: "Save",
  description: "Persist the current document contents.",
})

const Restart = Schema.TaggedStruct("Restart", {}).annotate({
  title: "Restart",
  description: "Try opening the document again after an expected failure.",
})

const Conflict = Schema.TaggedStruct("Conflict", {
  remoteText: Schema.String,
}).annotate({
  title: "Conflict",
  description: "Report a remote version that conflicts with local edits.",
})

const DocumentEvent = Schema.Union([Open, Save, Restart, Conflict, ChooseLocal, ChooseRemote]).pipe(
  Schema.toTaggedUnion("_tag"),
)

const document = Machine.builder({
  input: DocumentInput,
  state: DocumentState,
  event: DocumentEvent,
})

const aggregateNode = document.invokeAll("Opening", {
  name: "load document inputs",
  concurrency: 2,
  tasks: {
    document: {
      description: "Load the document body.",
      success: Schema.String,
      error: DocumentUnavailable,
      effect: (state, metadata) => {
        const executionKey: string | undefined = metadata?.executionKey
        void executionKey
        return Effect.flatMap(Documents, (documents) => documents.open(state.documentId))
      },
    },
    cached: {
      success: Schema.Boolean,
      error: Schema.Never,
      effect: () => Effect.succeed(true),
    },
  },
  onSuccess: {
    target: "Editing",
    reduce: ({ state, value }) => {
      const text: string = value.document
      const cached: boolean = value.cached
      return { _tag: "Editing", documentId: state.documentId, text, dirty: !cached }
    },
  },
  onFailure: {
    target: "Failed",
    reduce: ({ state, error }) => {
      const failure: DocumentUnavailable = error
      return { _tag: "Failed", documentId: state.documentId, message: failure.message }
    },
  },
})

const raceNode = document.invokeRace("Opening", {
  name: "load fastest document source",
  tasks: {
    document: {
      success: Schema.String,
      error: DocumentUnavailable,
      effect: (state) => Effect.flatMap(Documents, (documents) => documents.open(state.documentId)),
    },
    cache: {
      success: Schema.Boolean,
      error: Schema.Never,
      effect: () => Effect.succeed(true),
    },
  },
  onSuccess: {
    target: "Editing",
    reduce: ({ state, value }) => {
      const text = value.winner === "document" ? value.value : String(value.value)
      if (value.winner === "document") {
        const narrowed: string = value.value
        void narrowed
      } else {
        const narrowed: boolean = value.value
        void narrowed
      }
      return { _tag: "Editing", documentId: state.documentId, text, dirty: false }
    },
  },
  onFailure: {
    target: "Failed",
    reduce: ({ state, error }) => ({
      _tag: "Failed",
      documentId: state.documentId,
      message: error.message,
    }),
  },
})

const retrySchedule = null as unknown as Schedule.Schedule<
  number,
  DocumentUnavailable,
  RetryExhausted,
  ConflictPolicy
>
const RetryFailure = Schema.Union([DocumentUnavailable, RetryExhausted])
type RetryFailureCoversTerminalError =
  RetryExhausted extends Schema.Schema.Type<typeof RetryFailure> ? true : false
const retryFailureCoversTerminalError: true = true as RetryFailureCoversTerminalError
void retryFailureCoversTerminalError
const retryNode = document.invoke("Opening", {
  name: "load with durable-compatible errors",
  success: Schema.String,
  error: RetryFailure,
  effect: (state) => Effect.flatMap(Documents, (documents) => documents.open(state.documentId)),
  retry: { name: "retry with terminal error", schedule: retrySchedule },
  onSuccess: {
    target: "Editing",
    reduce: ({ state, value }) => ({
      _tag: "Editing",
      documentId: state.documentId,
      text: value,
      dirty: false,
    }),
  },
  onFailure: {
    target: "Failed",
    reduce: ({ state, error }) => ({
      _tag: "Failed",
      documentId: state.documentId,
      message: error.message,
    }),
  },
})

class OutcomeEncoding extends Context.Service<OutcomeEncoding, Readonly<Record<never, never>>>()(
  "prototype/OutcomeEncoding",
) {}
const ServiceEncodedString = Schema.String as Schema.Codec<string, string, never, OutcomeEncoding>
const schemaRequirementNode = document.invoke("Opening", {
  name: "schema service requirements",
  success: ServiceEncodedString,
  error: Schema.Never,
  effect: () => Effect.succeed("encoded"),
  onSuccess: {
    target: "Editing",
    reduce: ({ state, value }) => ({
      _tag: "Editing",
      documentId: state.documentId,
      text: value,
      dirty: false,
    }),
  },
  onFailure: {
    target: "Failed",
    reduce: ({ state }) => ({
      _tag: "Failed",
      documentId: state.documentId,
      message: "impossible",
    }),
  },
})

const schemaRequirementDefinition = document.make({
  id: "schema-requirements",
  initial: (input) => ({ _tag: "Opening", documentId: input.documentId }),
  nodes: [schemaRequirementNode],
})

export const documentDefinition = document.make({
  id: "document-session",
  description: "Keeps one document session understandable in code and as a graph.",
  initial: (input) => ({ _tag: "Closed", documentId: input.documentId }),
  nodes: [
    document.state("Closed", {
      on: {
        Open: {
          target: "Opening",
          reduce: ({ state, event }) => {
            const stateTag: "Closed" = state._tag
            const eventTag: "Open" = event._tag
            void stateTag
            void eventTag
            return {
              _tag: "Opening",
              documentId: state.documentId,
            }
          },
        },
      },
    }),
    document.invoke("Opening", {
      name: "Documents.open",
      description: "Load the selected document through the provided Documents service.",
      success: Schema.String,
      error: DocumentUnavailable,
      effect: (state) => Effect.flatMap(Documents, (documents) => documents.open(state.documentId)),
      retry: {
        name: "retry transient open failures",
        description: "Retry opening twice before exposing the typed failure.",
        schedule: Schedule.recurs(2),
      },
      onSuccess: {
        target: "Editing",
        reduce: ({ state, value }) => ({
          _tag: "Editing",
          documentId: state.documentId,
          text: value,
          dirty: true,
        }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ state, error }) => ({
          _tag: "Failed",
          documentId: state.documentId,
          message: error.message,
        }),
      },
      on: {},
    }),
    document.state("Editing", {
      on: {
        Save: {
          branches: [
            {
              when: {
                name: "document has changes",
                description: "Only persist content that changed during this session.",
                guard: ({ state, event }) => {
                  const stateTag: "Editing" = state._tag
                  const eventTag: "Save" = event._tag
                  void stateTag
                  void eventTag
                  return state.dirty
                },
              },
              target: "Saving",
              reduce: ({ state }) => ({
                _tag: "Saving",
                documentId: state.documentId,
                text: state.text,
              }),
            },
            {
              otherwise: true,
              description: "A clean document needs no write.",
              target: "Done",
              reduce: ({ state }) => ({ _tag: "Done", documentId: state.documentId }),
            },
          ],
        },
        Conflict: {
          target: "Resolving",
          description: "Hand conflicting versions to the child protocol.",
          reduce: ({ state, event }) => ({
            _tag: "Resolving",
            documentId: state.documentId,
            localText: state.text,
            remoteText: event.remoteText,
          }),
        },
      },
    }),
    document.invoke("Saving", {
      name: "Documents.save",
      description: "Persist the current contents through the provided Documents service.",
      success: Schema.Void,
      error: DocumentUnavailable,
      effect: (state) =>
        Effect.flatMap(Documents, (documents) => documents.save(state.documentId, state.text)),
      onSuccess: {
        target: "Done",
        reduce: ({ state }) => ({ _tag: "Done", documentId: state.documentId }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ state, error }) => ({
          _tag: "Failed",
          documentId: state.documentId,
          message: error.message,
        }),
      },
      on: {},
    }),
    document.child("Resolving", {
      name: "resolve document conflict",
      description: "Run one statically declared child while this parent state is active.",
      machine: conflictDefinition,
      input: (state) => ({
        documentId: state.documentId,
        localText: state.localText,
        remoteText: state.remoteText,
      }),
      forward: ["ChooseLocal", "ChooseRemote"],
      onDone: {
        target: "Editing",
        reduce: ({ state, output }) => ({
          _tag: "Editing",
          documentId: state.documentId,
          text: output.text,
          dirty: true,
        }),
      },
      on: {},
    }),
    document.state("Failed", {
      on: {
        Restart: {
          target: "Opening",
          reduce: ({ state }) => ({ _tag: "Opening", documentId: state.documentId }),
        },
      },
    }),
    document.final("Done"),
  ],
})

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Condition extends true> = Condition

type CompletionIsFinalState = Assert<
  Equal<
    MachineCompletion<typeof documentDefinition>,
    Readonly<{ _tag: "Done"; documentId: string }>
  >
>
type RequirementsIncludeDocuments = Assert<
  Equal<MachineRequirements<typeof documentDefinition>, Documents | ConflictPolicy>
>
type AggregateRequirementsAreExact = Assert<
  Equal<
    MachineRequirements<
      ReturnType<typeof document.make<readonly [typeof aggregateNode, typeof raceNode]>>
    >,
    Documents
  >
>
type RetryRequirementsIncludeSchedule = Assert<
  Equal<
    MachineRequirements<ReturnType<typeof document.make<readonly [typeof retryNode]>>>,
    Documents | ConflictPolicy
  >
>
type SchemaEncodingRequirementsAreIncluded = Assert<
  Equal<MachineRequirements<typeof schemaRequirementDefinition>, OutcomeEncoding>
>

type InspectionIsOnTheHandle = Assert<
  Equal<MachineHandle<typeof documentDefinition>["inspection"], Stream.Stream<InspectionEvent>>
>

void (null as unknown as CompletionIsFinalState)
void (null as unknown as RequirementsIncludeDocuments)
void (null as unknown as AggregateRequirementsAreExact)
void (null as unknown as RetryRequirementsIncludeSchedule)
void (null as unknown as SchemaEncodingRequirementsAreIncluded)
void (null as unknown as InspectionIsOnTheHandle)
