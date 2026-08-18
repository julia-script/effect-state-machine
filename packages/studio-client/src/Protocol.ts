import * as Schema from "effect/Schema"
import type { Machine } from "effect-state-machine"
import type { Graph } from "effect-state-machine/devtools"

/**
 * Current wire-protocol version announced by attached applications.
 *
 * @category constants
 * @since 0.1.0
 */
export const VERSION = 5

/**
 * Default TCP port used by the local Studio server.
 *
 * @category constants
 * @since 0.1.0
 */
export const DEFAULT_PORT = 4747

/**
 * WebSocket path used by attached applications.
 *
 * @category constants
 * @since 0.1.0
 */
export const APP_PATH = "/app"

/**
 * WebSocket path used by Studio viewers.
 *
 * @category constants
 * @since 0.1.0
 */
export const VIEWER_PATH = "/viewer"

/**
 * Schema for arbitrary JSON-compatible protocol payloads.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Json = Schema.Unknown

/**
 * Schema for best-effort authored source coordinates sent to Studio.
 *
 * @category schemas
 * @since 0.1.0
 */
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
    Schema.Struct({
      kind: Schema.Literals(["success", "failure", "completion", "timer"]),
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
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
  readonly kind: "state" | "invoke" | "child" | "regions" | "final"
  readonly location?: Schema.Schema.Type<typeof SourceLocation>
  readonly invocation?: {
    readonly name: string
    readonly kind?: "effect" | "all" | "race"
    readonly lanes?: ReadonlyArray<string>
    readonly concurrency?: number | "unbounded"
    readonly description?: string
    readonly retry?: { readonly name: string; readonly description?: string }
  }
  readonly timer?: {
    readonly duration?: unknown
    readonly name?: string
    readonly description?: string
    readonly targets: ReadonlyArray<string>
  }
  readonly regions?: { readonly slots: ReadonlyArray<string> }
  readonly region?: { readonly parent: string; readonly slot: string; readonly tag: string }
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
  kind: Schema.Literals(["state", "invoke", "child", "regions", "final"]),
  location: Schema.optionalKey(SourceLocation),
  invocation: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      kind: Schema.optionalKey(Schema.Literals(["effect", "all", "race"])),
      lanes: Schema.optionalKey(Schema.Array(Schema.String)),
      concurrency: Schema.optionalKey(
        Schema.Union([Schema.Number, Schema.Literals(["unbounded"])]),
      ),
      description: Schema.optionalKey(Schema.String),
      retry: Schema.optionalKey(
        Schema.Struct({
          name: Schema.String,
          description: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
  timer: Schema.optionalKey(
    Schema.Struct({
      duration: Schema.optionalKey(Json),
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      targets: Schema.Array(Schema.String),
    }),
  ),
  regions: Schema.optionalKey(
    Schema.Struct({
      slots: Schema.Array(Schema.String),
    }),
  ),
  region: Schema.optionalKey(
    Schema.Struct({
      parent: Schema.String,
      slot: Schema.String,
      tag: Schema.String,
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

/**
 * Recursive Schema for the renderer-independent machine graph sent over the wire.
 *
 * **Details**
 *
 * Its decoded value is structurally compatible with the core `Graph.Graph` model.
 *
 * @category schemas
 * @since 0.1.0
 */
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
  ownerPath: Schema.optionalKey(Schema.String),
  workKind: Schema.optionalKey(Schema.Literals(["effect", "all", "race"])),
  lanes: Schema.optionalKey(Schema.Array(Schema.String)),
} as const

const childLifecycleFields = {
  machineId: Schema.String,
  stateTag: Schema.String,
  invocation: Schema.String,
  instanceId: Schema.String,
  generation: Schema.Number,
} as const

/**
 * Schema for payload-safe machine lifecycle and decision events.
 *
 * @category schemas
 * @since 0.1.0
 */
export const InspectionEvent = Schema.Union([
  Schema.TaggedStruct("MachineStarted", {
    machineId: Schema.String,
    initialStateTag: Schema.String,
  }),
  Schema.TaggedStruct("EventReceived", {
    machineId: Schema.String,
    stateTag: Schema.String,
    eventTag: Schema.String,
    /**
     * Schema-encoded event value; absent when encoding was not possible.
     */
    details: Schema.optionalKey(Json),
  }),
  Schema.TaggedStruct("TransitionSelected", {
    machineId: Schema.String,
    sourceStateTag: Schema.String,
    targetStateTag: Schema.String,
    eventTag: Schema.String,
    branch: Schema.optionalKey(SelectedBranch),
    ownerPath: Schema.optionalKey(Schema.String),
    macrostep: Schema.optionalKey(Schema.Number),
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
    ownerPath: Schema.optionalKey(Schema.String),
    workKind: Schema.optionalKey(Schema.Literals(["effect", "all", "race"])),
    lanes: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.TaggedStruct("TimerStarted", {
    machineId: Schema.String,
    stateTag: Schema.String,
    timer: Schema.String,
    generation: Schema.Number,
    ownerPath: Schema.String,
    durationMillis: Schema.Number,
  }),
  Schema.TaggedStruct("TimerFired", {
    machineId: Schema.String,
    stateTag: Schema.String,
    timer: Schema.String,
    generation: Schema.Number,
    ownerPath: Schema.String,
    durationMillis: Schema.Number,
  }),
  Schema.TaggedStruct("TimerCancelled", {
    machineId: Schema.String,
    stateTag: Schema.String,
    timer: Schema.String,
    generation: Schema.Number,
    ownerPath: Schema.String,
    durationMillis: Schema.Number,
  }),
  Schema.TaggedStruct("StaleOutcomeIgnored", {
    machineId: Schema.String,
    stateTag: Schema.String,
    ownerPath: Schema.String,
    generation: Schema.Number,
    currentGeneration: Schema.Number,
    outcome: Schema.Literals([
      "work-success",
      "work-failure",
      "work-defect",
      "timer",
      "completion",
    ]),
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

/**
 * Decoded wire representation of {@link InspectionEvent}.
 *
 * @category models
 * @since 0.1.0
 */
export type InspectionEventMessage = Schema.Schema.Type<typeof InspectionEvent>

// Compile-time sync with the core inspection vocabulary: both the plain and the
// event-projected streams must remain assignable to the wire union.
const _inspectionToWire: (event: Machine.InspectionEvent) => InspectionEventMessage = (event) =>
  event
const _projectedToWire: (
  event: Machine.ProjectedInspectionEvent<unknown>,
) => InspectionEventMessage = (event) => event

/**
 * Schema for the application identity displayed in Studio.
 *
 * @category schemas
 * @since 0.1.0
 */
export const AppIdentity = Schema.Struct({
  name: Schema.String,
  runtime: Schema.Literals(["browser", "node", "other"]),
  /** Absolute filesystem root used to resolve dev-server-relative source paths. */
  projectRoot: Schema.optionalKey(Schema.String),
})

/**
 * Schema for the announced machine identity and description.
 *
 * @category schemas
 * @since 0.1.0
 */
export const MachineIdentity = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String),
})

/**
 * Schema for a named event control exposed by an attached application.
 *
 * @category schemas
 * @since 0.1.0
 */
export const QuickEventControl = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optionalKey(Schema.String),
  group: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["event", "factory"]),
  /**
   * Known for predefined event values; factories reveal their tag only when run.
   */
  eventTag: Schema.optionalKey(Schema.String),
})

/**
 * Schema for a child definition's structural placement under its parent definition.
 *
 * @category schemas
 * @since 0.2.0
 */
export const ChildDefinitionReference = Schema.Struct({
  ownerStateTag: Schema.String,
  invocation: Schema.String,
  definitionPath: Schema.String,
})

/**
 * Schema for one self-describing machine definition in an announced execution tree.
 *
 * @category schemas
 * @since 0.2.0
 */
export const DefinitionDescriptor = Schema.Struct({
  definitionPath: Schema.String,
  machine: MachineIdentity,
  graph: SerializedGraph,
  jsonSchemas: Schema.Struct({
    states: Schema.Record(Schema.String, Json),
    events: Schema.Record(Schema.String, Json),
  }),
  quickEvents: Schema.Array(QuickEventControl),
  children: Schema.Array(ChildDefinitionReference),
})

/**
 * Schema for the self-describing message that opens one root-machine session and its definition tree.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Hello = Schema.TaggedStruct("Hello", {
  protocolVersion: Schema.Number,
  sessionId: Schema.String,
  /**
   * Stable application-lineage identifier: reruns of the same application
   * announce the same key, letting Studio supersede the stale predecessor.
   */
  instanceKey: Schema.optionalKey(Schema.String),
  parentSessionId: Schema.optionalKey(Schema.String),
  rootActorId: Schema.String,
  app: AppIdentity,
  machine: MachineIdentity,
  graph: SerializedGraph,
  jsonSchemas: Schema.Struct({
    states: Schema.Record(Schema.String, Json),
    events: Schema.Record(Schema.String, Json),
  }),
  quickEvents: Schema.Array(QuickEventControl),
  definitions: Schema.Array(DefinitionDescriptor),
})

/**
 * Schema for ordered application facts recorded by Studio.
 *
 * @category schemas
 * @since 0.1.0
 */
export const FactBody = Schema.Union([
  Schema.TaggedStruct("ActorStarted", {
    machineId: Schema.String,
    parentActorId: Schema.optionalKey(Schema.String),
    ownerStateTag: Schema.optionalKey(Schema.String),
    invocation: Schema.optionalKey(Schema.String),
    instanceId: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct("Inspection", { event: InspectionEvent }),
  Schema.TaggedStruct("StateCommitted", { state: Json }),
  Schema.TaggedStruct("ActorTerminated", {
    status: Schema.Literals(["completed", "cancelled", "defected"]),
  }),
  Schema.TaggedStruct("StateEncodingFailed", { stateTag: Schema.String, message: Schema.String }),
  Schema.TaggedStruct("StatusChanged", { status: Schema.Literals(["completed", "defected"]) }),
  Schema.TaggedStruct("HistoryTruncated", {
    dropped: Schema.Number,
    fromSequence: Schema.Number,
    toSequence: Schema.Number,
  }),
])

/**
 * Schema for a sequenced fact in one Studio session.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Fact = Schema.TaggedStruct("Fact", {
  sessionId: Schema.String,
  sequence: Schema.Number,
  actorId: Schema.String,
  definitionPath: Schema.String,
  body: FactBody,
})

/**
 * Schema for either a named quick-event dispatch or a custom encoded event.
 *
 * @category schemas
 * @since 0.1.0
 */
export const DispatchCommand = Schema.Union([
  Schema.TaggedStruct("Quick", { id: Schema.String }),
  Schema.TaggedStruct("Custom", { event: Json }),
])

/**
 * Schema for a correlated Studio request to send an event to one actor in a root session.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Dispatch = Schema.TaggedStruct("Dispatch", {
  sessionId: Schema.String,
  actorId: Schema.String,
  correlationId: Schema.String,
  command: DispatchCommand,
})

/**
 * Schema for stable reasons a Studio dispatch can be rejected.
 *
 * @category schemas
 * @since 0.1.0
 */
export const DispatchFailureReason = Schema.Literals([
  "not-found",
  "factory-threw",
  "invalid",
  "unavailable",
  "not-running",
  "unknown-actor",
  "actor-ended",
  "disconnected",
])

/**
 * Schema for the correlated accepted or rejected result of a dispatch.
 *
 * @category schemas
 * @since 0.1.0
 */
export const DispatchOutcome = Schema.TaggedStruct("DispatchOutcome", {
  sessionId: Schema.String,
  actorId: Schema.String,
  correlationId: Schema.String,
  result: Schema.Union([
    Schema.TaggedStruct("Accepted", {}),
    Schema.TaggedStruct("Rejected", {
      reason: DispatchFailureReason,
      message: Schema.optionalKey(Schema.String),
    }),
  ]),
})

/**
 * Schema for the message sent when an application attachment closes normally.
 *
 * @category schemas
 * @since 0.1.0
 */
export const SessionEnded = Schema.TaggedStruct("SessionEnded", {
  sessionId: Schema.String,
})

/**
 * Schema for the message sent to viewers when an application's connection drops.
 *
 * @category schemas
 * @since 0.1.0
 */
export const SessionDisconnected = Schema.TaggedStruct("SessionDisconnected", {
  sessionId: Schema.String,
})

/**
 * Schema for a viewer's request to remove a disconnected or ended session.
 *
 * @category schemas
 * @since 0.3.0
 */
export const RemoveSession = Schema.TaggedStruct("RemoveSession", {
  sessionId: Schema.String,
})

/**
 * Schema for the notification that a session was removed, whether by viewer
 * request or by a rerun superseding its stale predecessor.
 *
 * @category schemas
 * @since 0.3.0
 */
export const SessionRemoved = Schema.TaggedStruct("SessionRemoved", {
  sessionId: Schema.String,
})

/**
 * Schema for rejecting a session that announces an unsupported protocol version.
 *
 * @category schemas
 * @since 0.1.0
 */
export const SessionRejected = Schema.TaggedStruct("SessionRejected", {
  sessionId: Schema.String,
  supportedVersion: Schema.Number,
  announcedVersion: Schema.Number,
  message: Schema.String,
})

/**
 * Schema for every message exchanged by applications, the Studio server, and viewers.
 *
 * **Details**
 *
 * Facts flow from applications to Studio, dispatches flow toward applications, and session
 * lifecycle messages coordinate all peers. Viewer-only presentation state is intentionally absent.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Message = Schema.Union([
  Hello,
  Fact,
  Dispatch,
  DispatchOutcome,
  SessionEnded,
  SessionDisconnected,
  SessionRejected,
  RemoveSession,
  SessionRemoved,
])

/**
 * Decoded union of every protocol message.
 *
 * @category models
 * @since 0.1.0
 */
export type Message = Schema.Schema.Type<typeof Message>

/**
 * Decoded session announcement message.
 *
 * @category models
 * @since 0.1.0
 */
export type HelloMessage = Schema.Schema.Type<typeof Hello>

/**
 * Decoded sequenced fact message.
 *
 * @category models
 * @since 0.1.0
 */
export type FactMessage = Schema.Schema.Type<typeof Fact>

/**
 * Decoded union of protocol fact bodies.
 *
 * @category models
 * @since 0.1.0
 */
export type FactBodyMessage = Schema.Schema.Type<typeof FactBody>

/**
 * Decoded Studio dispatch request.
 *
 * @category models
 * @since 0.1.0
 */
export type DispatchMessage = Schema.Schema.Type<typeof Dispatch>

/**
 * Decoded result of a Studio dispatch request.
 *
 * @category models
 * @since 0.1.0
 */
export type DispatchOutcomeMessage = Schema.Schema.Type<typeof DispatchOutcome>

/**
 * Decoded stable reason for a rejected dispatch.
 *
 * @category models
 * @since 0.1.0
 */
export type DispatchFailure = Schema.Schema.Type<typeof DispatchFailureReason>

/**
 * Decoded metadata for a named quick-event control.
 *
 * @category models
 * @since 0.1.0
 */
export type QuickEventControlMessage = Schema.Schema.Type<typeof QuickEventControl>

/**
 * Decoded self-describing definition registry entry.
 *
 * @category models
 * @since 0.2.0
 */
export type DefinitionDescriptorMessage = Schema.Schema.Type<typeof DefinitionDescriptor>

/**
 * Schema that converts the full protocol message union to and from a JSON string.
 *
 * @category schemas
 * @since 0.1.0
 */
export const MessageFromJsonString = Schema.fromJsonString(Message)

/**
 * Replaces the oldest fact with a cumulative history-truncation marker.
 *
 * **Details**
 *
 * Repeated truncation increments an existing head marker and removes the next fact, preserving the
 * sequence position from which retained history begins. An empty log is returned unchanged.
 *
 * @category transforming
 * @since 0.1.0
 */
export const truncateOldest = (
  sessionId: string,
  facts: ReadonlyArray<FactMessage>,
): ReadonlyArray<FactMessage> => {
  const head = facts[0]
  if (head === undefined) return facts
  if (head.body._tag === "HistoryTruncated") {
    const dropped = facts[1]
    return [
      {
        ...head,
        body: {
          _tag: "HistoryTruncated",
          dropped: head.body.dropped + 1,
          fromSequence: head.body.fromSequence,
          toSequence: dropped?.sequence ?? head.body.toSequence,
        },
      },
      ...facts.slice(2),
    ]
  }
  return [
    {
      _tag: "Fact",
      sessionId,
      sequence: head.sequence,
      actorId: head.actorId,
      definitionPath: head.definitionPath,
      body: {
        _tag: "HistoryTruncated",
        dropped: 1,
        fromSequence: head.sequence,
        toSequence: head.sequence,
      },
    },
    ...facts.slice(1),
  ]
}

/**
 * Decodes an unknown value as a protocol message.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeMessage = Schema.decodeUnknownEffect(Message)

/**
 * Encodes a decoded protocol message as plain data.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeMessage = Schema.encodeEffect(Message)

/**
 * Decodes a JSON string as a protocol message.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeMessageString = Schema.decodeEffect(MessageFromJsonString)

/**
 * Encodes a protocol message as a JSON string.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeMessageString = Schema.encodeEffect(MessageFromJsonString)
