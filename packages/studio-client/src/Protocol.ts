import * as Schema from "effect/Schema"
import type { Machine } from "effect-state-machine"
import type { Graph } from "effect-state-machine/devtools"

/**
 * The versioned wire vocabulary between an application's attached machine and
 * Studio. Messages carry facts (app → studio) and dispatches (studio → app);
 * per-viewer presentation state never appears here.
 */

export const VERSION = 1

/** Arbitrary JSON produced by Schema encoding or JSON.parse. */
export const Json = Schema.Unknown

export const SourceLocation = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  functionName: Schema.optionalKey(Schema.String),
})

const EventReference = Schema.Struct({
  tag: Schema.String,
  description: Schema.optionalKey(Schema.String),
})

const GraphEdgeBranch = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(["guard"]),
    index: Schema.Number,
    name: Schema.String,
    description: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literals(["otherwise"]),
    index: Schema.Number,
  }),
])

const GraphEdge = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  location: Schema.optionalKey(SourceLocation),
  event: Schema.optionalKey(EventReference),
  outcome: Schema.optionalKey(
    Schema.Struct({ kind: Schema.Literals(["success", "failure", "completion"]) }),
  ),
  description: Schema.optionalKey(Schema.String),
  branch: Schema.optionalKey(GraphEdgeBranch),
})

const GraphIgnore = Schema.Struct({
  source: Schema.String,
  event: EventReference,
  description: Schema.optionalKey(Schema.String),
})

interface GraphNodeEncoded {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly kind: "state" | "invoke" | "child" | "final"
  readonly location?: Schema.Schema.Type<typeof SourceLocation>
  readonly invocation?: {
    readonly name: string
    readonly description?: string
    readonly retry?: { readonly name: string; readonly description?: string }
  }
  readonly child?: {
    readonly name: string
    readonly description?: string
    readonly definition: GraphEncoded
    readonly forwards: ReadonlyArray<{
      readonly parentEvent: Schema.Schema.Type<typeof EventReference>
      readonly childEvent: Schema.Schema.Type<typeof EventReference>
      readonly description?: string
    }>
  }
}

interface GraphEncoded {
  readonly id: string
  readonly description?: string
  readonly nodes: ReadonlyArray<GraphNodeEncoded>
  readonly edges: ReadonlyArray<Schema.Schema.Type<typeof GraphEdge>>
  readonly ignores: ReadonlyArray<Schema.Schema.Type<typeof GraphIgnore>>
}

const GraphNode: Schema.Codec<GraphNodeEncoded> = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["state", "invoke", "child", "final"]),
  location: Schema.optionalKey(SourceLocation),
  invocation: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
      retry: Schema.optionalKey(
        Schema.Struct({
          name: Schema.String,
          description: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
  child: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
      definition: Schema.suspend((): Schema.Codec<GraphEncoded> => SerializedGraph),
      forwards: Schema.Array(
        Schema.Struct({
          parentEvent: EventReference,
          childEvent: EventReference,
          description: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
})

export const SerializedGraph: Schema.Codec<GraphEncoded> = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String),
  nodes: Schema.Array(GraphNode),
  edges: Schema.Array(GraphEdge),
  ignores: Schema.Array(GraphIgnore),
})

// Keep the wire graph structurally identical to the core graph so viewers can
// reuse Graph.focus/Graph.activity on decoded values.
const _graphToWire: (graph: Graph.Graph) => GraphEncoded = (graph) => graph
const _wireToGraph: (graph: GraphEncoded) => Graph.Graph = (graph) => graph

const SelectedBranch = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(["guard"]),
    index: Schema.Number,
    name: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literals(["otherwise"]),
    index: Schema.Number,
  }),
])

const invocationLifecycleFields = {
  machineId: Schema.String,
  stateTag: Schema.String,
  invocation: Schema.String,
  generation: Schema.Number,
  branch: Schema.optionalKey(SelectedBranch),
} as const

const childLifecycleFields = {
  machineId: Schema.String,
  stateTag: Schema.String,
  invocation: Schema.String,
  instanceId: Schema.String,
  generation: Schema.Number,
} as const

export const InspectionEvent = Schema.Union([
  Schema.TaggedStruct("MachineStarted", {
    machineId: Schema.String,
    initialStateTag: Schema.String,
  }),
  Schema.TaggedStruct("EventReceived", {
    machineId: Schema.String,
    stateTag: Schema.String,
    eventTag: Schema.String,
    /** The schema-encoded event value; absent when encoding was not possible. */
    details: Schema.optionalKey(Json),
  }),
  Schema.TaggedStruct("TransitionSelected", {
    machineId: Schema.String,
    sourceStateTag: Schema.String,
    targetStateTag: Schema.String,
    eventTag: Schema.String,
    branch: Schema.optionalKey(SelectedBranch),
  }),
  Schema.TaggedStruct("EventIgnored", {
    machineId: Schema.String,
    stateTag: Schema.String,
    eventTag: Schema.String,
  }),
  Schema.TaggedStruct("StateChanged", {
    machineId: Schema.String,
    previousStateTag: Schema.String,
    nextStateTag: Schema.String,
  }),
  Schema.TaggedStruct("InvocationStarted", invocationLifecycleFields),
  Schema.TaggedStruct("InvocationSucceeded", invocationLifecycleFields),
  Schema.TaggedStruct("InvocationFailed", invocationLifecycleFields),
  Schema.TaggedStruct("InvocationCancelled", invocationLifecycleFields),
  Schema.TaggedStruct("InvocationDefected", invocationLifecycleFields),
  Schema.TaggedStruct("InvocationRetryScheduled", {
    machineId: Schema.String,
    stateTag: Schema.String,
    invocation: Schema.String,
    generation: Schema.Number,
    policy: Schema.String,
    attempt: Schema.Number,
    delayMillis: Schema.Number,
  }),
  Schema.TaggedStruct("ChildStarted", {
    ...childLifecycleFields,
    childDefinitionId: Schema.String,
  }),
  Schema.TaggedStruct("ChildEventForwarded", {
    ...childLifecycleFields,
    parentEventTag: Schema.String,
    childEventTag: Schema.String,
  }),
  Schema.TaggedStruct("ChildCompleted", {
    ...childLifecycleFields,
    branch: Schema.optionalKey(SelectedBranch),
  }),
  Schema.TaggedStruct("ChildCancelled", childLifecycleFields),
  Schema.TaggedStruct("ChildDefected", childLifecycleFields),
  Schema.TaggedStruct("MachineCompleted", {
    machineId: Schema.String,
    finalStateTag: Schema.String,
  }),
  Schema.TaggedStruct("MachineDefected", {
    machineId: Schema.String,
    stateTag: Schema.String,
    eventTag: Schema.String,
    defect: Schema.Literals(["ProtocolDefect"]),
  }),
])

export type InspectionEventMessage = Schema.Schema.Type<typeof InspectionEvent>

// Compile-time sync with the core inspection vocabulary: both the plain and the
// event-projected streams must remain assignable to the wire union.
const _inspectionToWire: (event: Machine.InspectionEvent) => InspectionEventMessage = (event) =>
  event
const _projectedToWire: (
  event: Machine.ProjectedInspectionEvent<unknown>,
) => InspectionEventMessage = (event) => event

export const AppIdentity = Schema.Struct({
  name: Schema.String,
  runtime: Schema.Literals(["browser", "node", "other"]),
})

export const MachineIdentity = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String),
})

export const QuickEventControl = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  group: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["event", "factory"]),
  /** Known for predefined event values; factories only reveal their tag when run. */
  eventTag: Schema.optionalKey(Schema.String),
})

export const Hello = Schema.TaggedStruct("Hello", {
  protocolVersion: Schema.Number,
  sessionId: Schema.String,
  parentSessionId: Schema.optionalKey(Schema.String),
  app: AppIdentity,
  machine: MachineIdentity,
  graph: SerializedGraph,
  jsonSchemas: Schema.Struct({
    states: Schema.Record(Schema.String, Json),
    events: Schema.Record(Schema.String, Json),
  }),
  quickEvents: Schema.Array(QuickEventControl),
})

export const FactBody = Schema.Union([
  Schema.TaggedStruct("Inspection", { event: InspectionEvent }),
  Schema.TaggedStruct("StateCommitted", { state: Json }),
  Schema.TaggedStruct("StateEncodingFailed", { stateTag: Schema.String, message: Schema.String }),
  Schema.TaggedStruct("StatusChanged", { status: Schema.Literals(["completed", "defected"]) }),
  Schema.TaggedStruct("HistoryTruncated", { dropped: Schema.Number }),
])

export const Fact = Schema.TaggedStruct("Fact", {
  sessionId: Schema.String,
  sequence: Schema.Number,
  body: FactBody,
})

export const DispatchCommand = Schema.Union([
  Schema.TaggedStruct("Quick", { id: Schema.String }),
  Schema.TaggedStruct("Custom", { event: Json }),
])

export const Dispatch = Schema.TaggedStruct("Dispatch", {
  sessionId: Schema.String,
  correlationId: Schema.String,
  command: DispatchCommand,
})

export const DispatchFailureReason = Schema.Literals([
  "not-found",
  "factory-threw",
  "invalid",
  "unavailable",
  "not-running",
  "disconnected",
])

export const DispatchOutcome = Schema.TaggedStruct("DispatchOutcome", {
  sessionId: Schema.String,
  correlationId: Schema.String,
  result: Schema.Union([
    Schema.TaggedStruct("Accepted", {}),
    Schema.TaggedStruct("Rejected", {
      reason: DispatchFailureReason,
      message: Schema.optionalKey(Schema.String),
    }),
  ]),
})

/** Sent by the application when the attachment scope closes. */
export const SessionEnded = Schema.TaggedStruct("SessionEnded", {
  sessionId: Schema.String,
})

/** Sent by the server to viewers when a session's application connection drops. */
export const SessionDisconnected = Schema.TaggedStruct("SessionDisconnected", {
  sessionId: Schema.String,
})

/** Sent by the receiver when a Hello announces an unsupported protocol version. */
export const SessionRejected = Schema.TaggedStruct("SessionRejected", {
  sessionId: Schema.String,
  supportedVersion: Schema.Number,
  announcedVersion: Schema.Number,
  message: Schema.String,
})

export const Message = Schema.Union([
  Hello,
  Fact,
  Dispatch,
  DispatchOutcome,
  SessionEnded,
  SessionDisconnected,
  SessionRejected,
])

export type Message = Schema.Schema.Type<typeof Message>
export type HelloMessage = Schema.Schema.Type<typeof Hello>
export type FactMessage = Schema.Schema.Type<typeof Fact>
export type FactBodyMessage = Schema.Schema.Type<typeof FactBody>
export type DispatchMessage = Schema.Schema.Type<typeof Dispatch>
export type DispatchOutcomeMessage = Schema.Schema.Type<typeof DispatchOutcome>
export type DispatchFailure = Schema.Schema.Type<typeof DispatchFailureReason>
export type QuickEventControlMessage = Schema.Schema.Type<typeof QuickEventControl>

export const MessageFromJsonString = Schema.fromJsonString(Message)

export const decodeMessage = Schema.decodeUnknownEffect(Message)
export const encodeMessage = Schema.encodeEffect(Message)
export const decodeMessageString = Schema.decodeEffect(MessageFromJsonString)
export const encodeMessageString = Schema.encodeEffect(MessageFromJsonString)
