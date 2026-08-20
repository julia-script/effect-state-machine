import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { encodeComponent, recordFromEntries } from "./Internal.js"
import * as Machine from "./Machine.js"
import * as MachinePlan from "./MachinePlan.js"
import {
  ActivityCommand,
  ActivityOutcome,
  Checkpoint,
  CompatibilityError,
  DispatchRecord,
  deliveryId,
  deriveEntryId,
  deriveMessageId,
  deriveRuntimeExecutionId,
  entryId,
  type executionId,
  type Handle,
  type InstanceId,
  instanceId,
  type Json,
  LeaseLost,
  type MachineCommit,
  type MachineDefectSummary,
  type MachineDelivery,
  MachineEncodingError,
  type MachineError,
  MachineInstanceDefect,
  MachineMessage,
  MigrationDocument,
  MigrationError,
  messageId,
  type PersistedTreeRecordBody,
  persistenceVersion,
  type RunOptions,
  revision,
  Store,
  StoreError,
  type StoreService,
  type TreeRecordDraft,
} from "./MachineRuntimeProtocol.js"
import * as MachineStore from "./MachineStore.js"

interface Tagged {
  readonly _tag: string
}

interface RuntimeDefinition extends Machine.DefinitionMetadata {
  readonly schemas: Readonly<{
    input: Schema.Top
    state: Machine.TaggedSchema
    event: Machine.TaggedSchema
  }>
  readonly initial: (input: never) => Tagged
}

interface RuntimeTask {
  readonly success: Schema.Top
  readonly error: Schema.Top
  readonly effect: (
    state: Tagged,
    execution: Machine.WorkExecution,
  ) => Effect.Effect<unknown, unknown, unknown>
}

interface RuntimeRegionNode {
  readonly final?: true
  readonly on?: Readonly<Record<string, MachinePlan.RegionEventHandler<Tagged, Tagged>>>
  readonly after?: MachinePlan.RegionAfter<Tagged>
  readonly invoke?: Readonly<{
    name: string
    success: Schema.Top
    error: Schema.Top
    effect: (
      state: Tagged,
      parent: Tagged,
      execution: Machine.WorkExecution,
    ) => Effect.Effect<unknown, unknown, unknown>
    retry?: Readonly<{
      name: string
      schedule: Schedule.Schedule<unknown, unknown, unknown, unknown>
    }>
    onSuccess: MachinePlan.RegionOutcome<Tagged, "value">
    onFailure: MachinePlan.RegionOutcome<Tagged, "error">
  }>
}

interface RuntimeNode {
  readonly kind: "state" | "invoke" | "regions" | "child" | "final"
  readonly tag: string
  readonly on?: Readonly<Record<string, MachinePlan.EventHandler<Tagged, Tagged>>>
  readonly after?: MachinePlan.After<Tagged>
  readonly name?: string
  readonly workKind?: "effect" | "all" | "race"
  readonly success?: Schema.Top
  readonly error?: Schema.Top
  readonly effect?: (
    state: Tagged,
    execution: Machine.WorkExecution,
  ) => Effect.Effect<unknown, unknown, unknown>
  readonly tasks?: Readonly<Record<string, RuntimeTask>>
  readonly concurrency?: number | "unbounded"
  readonly retry?: Readonly<{
    name: string
    schedule: Schedule.Schedule<unknown, unknown, unknown, unknown>
  }>
  readonly onSuccess?: MachinePlan.OutcomeHandler<Tagged, unknown, "value">
  readonly onFailure?: MachinePlan.OutcomeHandler<Tagged, unknown, "error">
  readonly regions?: Readonly<
    Record<string, Readonly<{ states: Readonly<Record<string, RuntimeRegionNode>> }>>
  >
  readonly onComplete?: unknown
  readonly definition?: RuntimeDefinition
  readonly input?: (state: Tagged) => unknown
  readonly forward?: Readonly<
    Record<
      string,
      | Readonly<{
          target: string
          map: (args: Readonly<{ state: Tagged; event: Tagged }>) => Tagged
        }>
      | undefined
    >
  >
}

interface EntryWork {
  readonly rootEntryId: string
  readonly regionEntryIds: Readonly<Record<string, string>>
  readonly timers: ReadonlyArray<Checkpoint["timers"][number]>
  readonly aggregates: ReadonlyArray<Checkpoint["aggregates"][number]>
  readonly messages: ReadonlyArray<MachineMessage>
  readonly activities: ReadonlyArray<ActivityCommand>
}

/** Package-private actor identity carried across recursive durable child runs. */
export interface RuntimeActor {
  readonly actorId: Machine.ActorId
  readonly definitionPath: Machine.DefinitionPath
  readonly parent?: Readonly<{
    actorId: Machine.ActorId
    definitionPath: Machine.DefinitionPath
    machineId: string
    stateTag: string
    invocation: string
  }>
}

/** Package-private bridge from the durable interpreter to one root observation journal. */
export interface RuntimeObserver {
  readonly refresh: Effect.Effect<void, MachineError>
  readonly register: (
    actor: RuntimeActor,
    adapter: Readonly<{
      can: (event: unknown) => Effect.Effect<boolean, MachineError>
      send: (event: unknown) => Effect.Effect<void, MachineError>
    }>,
  ) => Effect.Effect<void>
  readonly terminate: (
    actor: RuntimeActor,
    status: "completed" | "cancelled" | "defected",
  ) => Effect.Effect<void>
}

interface RuntimeRunOptions extends RunOptions {
  readonly actor?: RuntimeActor
  readonly observer?: RuntimeObserver
}

const checkpointFormatVersion = 1
const defaultMachineLeaseMillis = 30_000
const defaultActivityLeaseMillis = 30_000
const idlePollMillis = 250
let workerSequence = 0
const observationBaseStores = new WeakMap<StoreService, StoreService>()

interface ActivityCancellationEntry {
  readonly instanceId: InstanceId
  readonly childInstanceId?: InstanceId
  readonly signal: Deferred.Deferred<void>
}

const activityCancellationRegistries = new WeakMap<
  StoreService,
  Map<string, ActivityCancellationEntry>
>()

const baseStoreOf = (store: StoreService): StoreService => observationBaseStores.get(store) ?? store

const isInstanceAtOrBelow = (candidate: InstanceId, ancestor: InstanceId): boolean => {
  let current: string = candidate
  while (true) {
    if (current === ancestor) return true
    const identity = MachineStore.parseChildMachineInstanceId(current)
    if (identity === undefined) return false
    current = identity.parentInstanceId
  }
}

const cancellationOwnsInstance = (cancelledId: string, candidate: InstanceId): boolean => {
  let current: string = candidate
  while (true) {
    if (cancelledId.endsWith(`:${encodeComponent(current)}`)) return true
    const identity = MachineStore.parseChildMachineInstanceId(current)
    if (identity === undefined) return false
    current = identity.parentInstanceId
  }
}

const workerId = (kind: "machine" | "activity", instance: InstanceId): string =>
  `${kind}:${instance}:${++workerSequence}`

const childInstanceId = (
  parentInstanceId: InstanceId,
  parentEntryId: string,
  childName: string,
): InstanceId =>
  instanceId(
    MachineStore.deriveChildMachineInstanceId(
      MachineStore.machineInstanceId(parentInstanceId),
      MachineStore.entryId(parentEntryId),
      childName,
    ),
  )

const childRunOptions = (
  definition: RuntimeDefinition,
  childId: InstanceId,
  options: RuntimeRunOptions,
  parentMachineId: string,
  ownerStateTag: string,
  invocation: string,
): RuntimeRunOptions => ({
  instanceId: childId,
  persistenceVersion: persistenceVersion(definition.version),
  migrations: definition.migrations,
  ...(options.machineLeaseMillis === undefined
    ? {}
    : { machineLeaseMillis: options.machineLeaseMillis }),
  ...(options.activityLeaseMillis === undefined
    ? {}
    : { activityLeaseMillis: options.activityLeaseMillis }),
  ...(options.pollIntervalMillis === undefined
    ? {}
    : { pollIntervalMillis: options.pollIntervalMillis }),
  ...(options.activityWorkerCount === undefined
    ? {}
    : { activityWorkerCount: options.activityWorkerCount }),
  ...(options.observer === undefined ? {} : { observer: options.observer }),
  ...(options.actor === undefined
    ? {}
    : {
        actor: {
          actorId: Machine.ActorId.make(`actor:${childId}`),
          definitionPath: Machine.DefinitionPath.child(
            options.actor.definitionPath,
            ownerStateTag,
            invocation,
          ),
          parent: {
            actorId: options.actor.actorId,
            definitionPath: options.actor.definitionPath,
            machineId: parentMachineId,
            stateTag: ownerStateTag,
            invocation,
          },
        },
      }),
})

const encodeJson: (
  schema: Schema.Top,
  value: unknown,
  operation: string,
) => Effect.Effect<Json, MachineEncodingError, unknown> = Effect.fnUntraced(
  function* (schema, value, operation) {
    return yield* Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
      Effect.mapError(
        (error) => new MachineEncodingError({ operation, message: String(error), cause: error }),
      ),
    )
  },
)

// This caller-selected generic result cannot retain its signature through Effect.fnUntraced.
const decodeJson = <Value>(
  schema: Schema.Top,
  value: Json,
  operation: string,
): Effect.Effect<Value, MachineEncodingError, unknown> =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    // The owning Schema has validated the decoded value at this single generic erasure boundary.
    Effect.map((decoded) => decoded as Value),
    Effect.mapError(
      (error) => new MachineEncodingError({ operation, message: String(error), cause: error }),
    ),
  )

const validateEnvelope: (
  schema: Schema.Top,
  value: unknown,
  operation: string,
) => Effect.Effect<void, MachineEncodingError, unknown> = Effect.fnUntraced(
  function* (schema, value, operation) {
    yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.asVoid,
      Effect.mapError(
        (error) => new MachineEncodingError({ operation, message: String(error), cause: error }),
      ),
    )
  },
)

const commitMachine: (
  store: StoreService,
  commit: MachineCommit,
) => Effect.Effect<void, MachineError, unknown> = Effect.fnUntraced(function* (store, commit) {
  yield* validateEnvelope(Checkpoint, commit.checkpoint, "validate committed checkpoint")
  yield* Effect.forEach(
    commit.publishMessages,
    (message) => validateEnvelope(MachineMessage, message, "validate published message"),
    { discard: true },
  )
  yield* Effect.forEach(
    commit.publishActivities,
    (activity) => validateEnvelope(ActivityCommand, activity, "validate published activity"),
    { discard: true },
  )
  if (commit.dispatch !== undefined) {
    yield* validateEnvelope(DispatchRecord, commit.dispatch, "validate dispatch record")
  }
  yield* store.commitMachine(commit)
})

const createInstance: (
  store: StoreService,
  request: Parameters<StoreService["create"]>[0],
) => Effect.Effect<boolean, MachineError, unknown> = Effect.fnUntraced(function* (store, request) {
  yield* validateEnvelope(Checkpoint, request.checkpoint, "validate initial checkpoint")
  yield* Effect.forEach(
    request.messages,
    (message) => validateEnvelope(MachineMessage, message, "validate initial message"),
    { discard: true },
  )
  yield* Effect.forEach(
    request.activities,
    (activity) => validateEnvelope(ActivityCommand, activity, "validate initial activity"),
    { discard: true },
  )
  return yield* store.create(request)
})

const completeActivity: (
  store: StoreService,
  id: ReturnType<typeof deliveryId>,
  fence: number,
  message: MachineMessage,
) => Effect.Effect<void, MachineError, unknown> = Effect.fnUntraced(
  function* (store, id, fence, message) {
    yield* validateEnvelope(MachineMessage, message, "validate activity outcome message")
    yield* store.completeActivity(id, fence, message)
  },
)

const canonicalJson = (value: Json): string => {
  const normalize = (part: Json): Json => {
    if (Array.isArray(part)) return part.map(normalize)
    if (typeof part === "object" && part !== null) {
      return Object.fromEntries(
        Object.entries(part)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item as Json)]),
      )
    }
    return part
  }
  return JSON.stringify(normalize(value))
}

const defectSummary = (
  category: MachineDefectSummary["category"],
  error: unknown,
): MachineDefectSummary => ({
  category,
  name: error instanceof Error ? error.name : "UnknownDefect",
  message: error instanceof Error ? error.message : String(error),
})

const runtimeActor = (options: RuntimeRunOptions): RuntimeActor =>
  options.actor ?? {
    actorId: Machine.ActorId.make(`actor:${options.instanceId}`),
    definitionPath: Machine.DefinitionPath.root,
  }

const persistedBody = (body: Machine.TreeRecordBody): PersistedTreeRecordBody => {
  switch (body._tag) {
    case "ActorStarted":
      return body
    case "Inspection":
      return {
        _tag: body._tag,
        metadata: body.metadata,
        ...(body.event === undefined ? {} : { event: body.event }),
      }
    case "StateSnapshot":
      return body
    case "ActorTerminated":
      return body
  }
}

const observationDraft = (
  actor: RuntimeActor,
  key: string,
  body: Machine.TreeRecordBody,
): TreeRecordDraft => ({
  key,
  actorId: actor.actorId,
  definitionPath: actor.definitionPath,
  body: persistedBody(body),
})

const inspectionDraft = (
  actor: RuntimeActor,
  key: string,
  metadata: Machine.InspectionEvent,
  event?: Json,
): TreeRecordDraft =>
  observationDraft(actor, key, {
    _tag: "Inspection",
    metadata,
    ...(event === undefined ? {} : { event }),
  })

const initialObservationDrafts = (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  checkpoint: Checkpoint,
  options: RuntimeRunOptions,
): ReadonlyArray<TreeRecordDraft> => {
  const actor = runtimeActor(options)
  const encodedState =
    typeof checkpoint.state === "object" &&
    checkpoint.state !== null &&
    !Array.isArray(checkpoint.state)
      ? (checkpoint.state as Readonly<Record<string, Json>>)
      : undefined
  const stateTag = typeof encodedState?._tag === "string" ? encodedState._tag : "unknown"
  const prefix = `${checkpoint.instanceId}:actor-start`
  const records: Array<TreeRecordDraft> = [
    observationDraft(actor, `${prefix}:actor`, {
      _tag: "ActorStarted",
      machineId: definition.id,
      ...(actor.parent === undefined
        ? { instanceId: checkpoint.instanceId }
        : {
            parentActorId: actor.parent.actorId,
            ownerStateTag: actor.parent.stateTag,
            invocation: actor.parent.invocation,
            instanceId: checkpoint.instanceId,
          }),
    }),
    inspectionDraft(actor, `${prefix}:machine`, {
      _tag: "MachineStarted",
      machineId: definition.id,
      initialStateTag: stateTag,
    }),
    observationDraft(actor, `${prefix}:snapshot`, {
      _tag: "StateSnapshot",
      state: checkpoint.state,
    }),
  ]
  if (actor.parent !== undefined) {
    records.unshift(
      inspectionDraft(
        {
          actorId: actor.parent.actorId,
          definitionPath: actor.parent.definitionPath,
        },
        `${prefix}:parent-child-started`,
        {
          _tag: "ChildStarted",
          machineId: actor.parent.machineId,
          stateTag: actor.parent.stateTag,
          invocation: actor.parent.invocation,
          instanceId: checkpoint.instanceId,
          childDefinitionId: definition.id,
          generation: checkpoint.revision,
        },
      ),
    )
  }
  const node = nodes.get(stateTag)
  if (node?.kind === "invoke" && node.name !== undefined) {
    records.push(
      inspectionDraft(actor, `${prefix}:invocation:${node.name}`, {
        _tag: "InvocationStarted",
        machineId: definition.id,
        stateTag,
        invocation: node.name,
        generation: checkpoint.revision,
        ownerPath: stateTag,
        workKind: node.workKind ?? "effect",
        ...(node.tasks === undefined ? {} : { lanes: Object.keys(node.tasks) }),
      }),
    )
  }
  for (const timer of checkpoint.timers) {
    records.push(
      inspectionDraft(actor, `${prefix}:timer:${timer.messageId}`, {
        _tag: "TimerStarted",
        machineId: definition.id,
        stateTag,
        timer: timer.name,
        generation: checkpoint.revision,
        ownerPath: timer.ownerPath,
        durationMillis: timer.durationMillis,
      }),
    )
  }
  return records
}

const nodesOf = (definition: RuntimeDefinition): ReadonlyMap<string, RuntimeNode> =>
  new Map(
    (Machine.definitionNodes(definition) as unknown as ReadonlyArray<RuntimeNode>).map((node) => [
      node.tag,
      node,
    ]),
  )

const activityCommand = (
  instance: InstanceId,
  ownerEntryId: string,
  generation: number,
  ownerPath: string,
  invocation: string,
  lane: string,
  state: Json,
  parentState: Json | null,
  concurrencyGroup: string,
  concurrencyLimit: number,
): ActivityCommand => {
  const key = deriveRuntimeExecutionId(instance, entryId(ownerEntryId), ownerPath, invocation, lane)
  return {
    deliveryId: key,
    instanceId: instance,
    executionId: key,
    entryId: ownerEntryId,
    generation,
    ownerPath,
    invocation,
    lane,
    state,
    parentState,
    concurrencyGroup,
    concurrencyLimit,
  }
}

const timerWork = <DurationState>(
  instance: InstanceId,
  targetRevision: number,
  ownerEntryId: string,
  ownerPath: string,
  after: Readonly<{ duration: MachinePlan.DurationSpec<DurationState> }>,
  durationState: DurationState,
  now: number,
): Readonly<{
  timer: Checkpoint["timers"][number]
  message: MachineMessage
}> => {
  const resolved = MachinePlan.resolveDuration(after.duration, durationState)
  const id = deriveMessageId(
    instance,
    revision(targetRevision),
    ownerPath,
    `timer:${resolved.timer}`,
  )
  const dueAtEpochMillis = now + resolved.durationMillis
  return {
    timer: {
      entryId: ownerEntryId,
      ownerPath,
      name: resolved.timer,
      durationMillis: resolved.durationMillis,
      dueAtEpochMillis,
      messageId: id,
    },
    message: {
      _tag: "Timer",
      messageId: id,
      instanceId: instance,
      availableAtEpochMillis: dueAtEpochMillis,
      entryId: ownerEntryId,
      ownerPath,
      timer: resolved.timer,
    },
  }
}

const planRegionSlot: (
  instance: InstanceId,
  targetRevision: number,
  parent: Tagged,
  encodedParent: Json,
  node: RuntimeNode,
  slot: string,
  now: number,
) => Effect.Effect<Omit<EntryWork, "rootEntryId">, MachineEncodingError> = Effect.fnUntraced(
  function* (instance, targetRevision, parent, encodedParent, node, slot, now) {
    const local = (parent as unknown as Readonly<Record<string, unknown>>)[slot]
    if (typeof local !== "object" || local === null || !("_tag" in local)) {
      return { regionEntryIds: {}, timers: [], aggregates: [], messages: [], activities: [] }
    }
    const tagged = local as Tagged
    const regionNode = node.regions?.[slot]?.states[tagged._tag]
    if (regionNode === undefined || regionNode.final === true) {
      return { regionEntryIds: {}, timers: [], aggregates: [], messages: [], activities: [] }
    }
    const ownerPath = `${parent._tag}/${slot}/${tagged._tag}`
    const durableEntry = deriveEntryId(instance, revision(targetRevision), ownerPath)
    const timers: Array<Checkpoint["timers"][number]> = []
    const messages: Array<MachineMessage> = []
    const activities: Array<ActivityCommand> = []
    if (regionNode.after !== undefined) {
      const planned = timerWork(
        instance,
        targetRevision,
        durableEntry,
        ownerPath,
        regionNode.after,
        { state: tagged, parent },
        now,
      )
      timers.push(planned.timer)
      messages.push(planned.message)
    }
    if (regionNode.invoke !== undefined) {
      if (
        typeof encodedParent !== "object" ||
        encodedParent === null ||
        Array.isArray(encodedParent) ||
        !Object.hasOwn(encodedParent, slot)
      ) {
        return yield* new MachineEncodingError({
          operation: "plan region activity",
          message: `encoded state is missing active region slot ${slot}`,
        })
      }
      const encodedLocal = (encodedParent as Readonly<Record<string, Json>>)[slot]
      if (encodedLocal === undefined) {
        return yield* new MachineEncodingError({
          operation: "plan region activity",
          message: `encoded state has undefined active region slot ${slot}`,
        })
      }
      activities.push(
        activityCommand(
          instance,
          durableEntry,
          targetRevision,
          ownerPath,
          regionNode.invoke.name,
          "",
          encodedLocal,
          encodedParent,
          `${instance}:${durableEntry}:${regionNode.invoke.name}`,
          1,
        ),
      )
    }
    return {
      regionEntryIds: recordFromEntries([[slot, durableEntry]]),
      timers,
      aggregates: [],
      messages,
      activities,
    }
  },
)

const planEntry: (
  nodes: ReadonlyMap<string, RuntimeNode>,
  instance: InstanceId,
  targetRevision: number,
  state: Tagged,
  encodedState: Json,
  now: number,
) => Effect.Effect<EntryWork, MachineEncodingError> = Effect.fnUntraced(
  function* (nodes, instance, targetRevision, state, encodedState, now) {
    const node = nodes.get(state._tag)
    const rootEntry = deriveEntryId(instance, revision(targetRevision), state._tag)
    const timers: Array<Checkpoint["timers"][number]> = []
    const aggregates: Array<Checkpoint["aggregates"][number]> = []
    const messages: Array<MachineMessage> = []
    const activities: Array<ActivityCommand> = []
    const regionEntryIds = new Map<string, string>()

    if (node?.after !== undefined) {
      const planned = timerWork(
        instance,
        targetRevision,
        rootEntry,
        state._tag,
        node.after,
        state,
        now,
      )
      timers.push(planned.timer)
      messages.push(planned.message)
    }

    if (node?.kind === "invoke" && node.name !== undefined) {
      const workKind = node.workKind ?? "effect"
      if (workKind === "effect") {
        activities.push(
          activityCommand(
            instance,
            rootEntry,
            targetRevision,
            state._tag,
            node.name,
            "",
            encodedState,
            null,
            `${instance}:${rootEntry}:${node.name}`,
            1,
          ),
        )
      } else {
        const lanes = Object.keys(node.tasks ?? {})
        const concurrency =
          workKind === "race" || node.concurrency === "unbounded" || node.concurrency === undefined
            ? lanes.length
            : Math.min(node.concurrency, lanes.length)
        const running = lanes.slice(0, concurrency)
        const pending = lanes.slice(concurrency)
        aggregates.push({
          kind: workKind,
          entryId: rootEntry,
          ownerPath: state._tag,
          invocation: node.name,
          state: encodedState,
          parentState: null,
          pending,
          running,
          completed: {},
          failures: {},
        })
        for (const lane of running) {
          activities.push(
            activityCommand(
              instance,
              rootEntry,
              targetRevision,
              state._tag,
              node.name,
              lane,
              encodedState,
              null,
              `${instance}:${rootEntry}:${node.name}`,
              Math.max(1, concurrency),
            ),
          )
        }
      }
    }

    if (node?.kind === "child" && node.name !== undefined) {
      const childId = childInstanceId(instance, rootEntry, node.name)
      activities.push(
        activityCommand(
          instance,
          rootEntry,
          targetRevision,
          state._tag,
          `child:${node.name}`,
          childId,
          encodedState,
          null,
          `${instance}:${rootEntry}:child:${node.name}`,
          1,
        ),
      )
    }

    if (node?.kind === "regions") {
      for (const slot of Object.keys(node.regions ?? {})) {
        const planned = yield* planRegionSlot(
          instance,
          targetRevision,
          state,
          encodedState,
          node,
          slot,
          now,
        )
        for (const [plannedSlot, plannedEntryId] of Object.entries(planned.regionEntryIds)) {
          regionEntryIds.set(plannedSlot, plannedEntryId)
        }
        timers.push(...planned.timers)
        messages.push(...planned.messages)
        activities.push(...planned.activities)
      }
      if (node.onComplete !== undefined && MachinePlan.regionsComplete(node, state)) {
        messages.push({
          _tag: "RegionsComplete",
          messageId: deriveMessageId(
            instance,
            revision(targetRevision),
            state._tag,
            "regions-complete",
          ),
          instanceId: instance,
          availableAtEpochMillis: now,
          entryId: rootEntry,
          ownerPath: state._tag,
        })
      }
    }

    return {
      rootEntryId: rootEntry,
      regionEntryIds: recordFromEntries(regionEntryIds),
      timers,
      aggregates,
      messages,
      activities,
    }
  },
)

const oldRuntimeExecutionIds = (
  nodes: ReadonlyMap<string, RuntimeNode>,
  instance: InstanceId,
  checkpoint: Checkpoint,
  state: Tagged,
): ReadonlyArray<ReturnType<typeof executionId>> => {
  const node = nodes.get(state._tag)
  const keys: Array<ReturnType<typeof executionId>> = []
  if (node?.kind === "invoke" && node.name !== undefined) {
    const lanes =
      node.workKind === "effect" || node.workKind === undefined
        ? [""]
        : Object.keys(node.tasks ?? {})
    for (const lane of lanes) {
      keys.push(
        deriveRuntimeExecutionId(
          instance,
          entryId(checkpoint.rootEntryId),
          state._tag,
          node.name,
          lane,
        ),
      )
    }
  }
  if (node?.kind === "child" && node.name !== undefined) {
    const childId = childInstanceId(instance, checkpoint.rootEntryId, node.name)
    keys.push(
      deriveRuntimeExecutionId(
        instance,
        entryId(checkpoint.rootEntryId),
        state._tag,
        `child:${node.name}`,
        childId,
      ),
    )
  }
  if (node?.kind === "regions") {
    for (const [slot, region] of Object.entries(node.regions ?? {})) {
      const local = (state as unknown as Readonly<Record<string, unknown>>)[slot]
      if (typeof local !== "object" || local === null || !("_tag" in local)) continue
      const tagged = local as Tagged
      const invoke = region.states[tagged._tag]?.invoke
      const durableEntry = checkpoint.regionEntryIds[slot]
      if (invoke !== undefined && durableEntry !== undefined) {
        keys.push(
          deriveRuntimeExecutionId(
            instance,
            entryId(durableEntry),
            `${state._tag}/${slot}/${tagged._tag}`,
            invoke.name,
          ),
        )
      }
    }
  }
  return keys
}

const dispatchFor = (
  checkpoint: Checkpoint,
  message: Extract<MachineMessage, { readonly _tag: "External" }>,
  status: "committed" | "rejected",
  reason = "",
) =>
  ({
    instanceId: checkpoint.instanceId,
    idempotencyKey: message.idempotencyKey,
    payloadFingerprint: message.payloadFingerprint,
    status,
    revision: checkpoint.revision,
    reason,
  }) as const

const makeCheckpoint = (
  previous: Checkpoint,
  state: Json,
  status: Checkpoint["status"],
  entry: EntryWork | undefined,
  defect: MachineDefectSummary | null = null,
): Checkpoint => ({
  ...previous,
  revision: previous.revision + 1,
  status,
  state,
  rootEntryId: entry?.rootEntryId ?? previous.rootEntryId,
  regionEntryIds: entry?.regionEntryIds ?? previous.regionEntryIds,
  timers: entry?.timers ?? previous.timers,
  aggregates: entry?.aggregates ?? previous.aggregates,
  defect,
})

const commitTransition: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  previousState: Tagged,
  nextState: Tagged,
  dispatch: MachineCommit["dispatch"],
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, store, delivery, previousState, nextState, dispatch) {
    const encoded = yield* encodeJson(definition.schemas.state, nextState, "encode state")
    if (!nodes.has(nextState._tag)) {
      return yield* new MachineEncodingError({
        operation: "transition",
        message: `machine ${definition.id} targeted missing state ${nextState._tag}`,
      })
    }
    const now = yield* store.now
    const isFinal = nodes.get(nextState._tag)?.kind === "final"
    const entry = isFinal
      ? {
          rootEntryId: deriveEntryId(
            delivery.checkpoint.instanceId as InstanceId,
            revision(delivery.checkpoint.revision + 1),
            nextState._tag,
          ),
          regionEntryIds: {},
          timers: [],
          aggregates: [],
          messages: [],
          activities: [],
        }
      : yield* planEntry(
          nodes,
          delivery.checkpoint.instanceId as InstanceId,
          delivery.checkpoint.revision + 1,
          nextState,
          encoded,
          now,
        )
    const checkpoint = makeCheckpoint(
      delivery.checkpoint,
      encoded,
      isFinal ? "completed" : "running",
      entry,
    )
    yield* commitMachine(store, {
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages: entry.messages,
      publishActivities: entry.activities,
      cancelMessageIds: delivery.checkpoint.timers.map((timer) => messageId(timer.messageId)),
      cancelExecutionIds: oldRuntimeExecutionIds(
        nodes,
        delivery.checkpoint.instanceId as InstanceId,
        delivery.checkpoint,
        previousState,
      ),
      dispatch,
    })
    return checkpoint
  },
)

const commitPreservingEntry: (
  store: StoreService,
  delivery: MachineDelivery,
  encodedState: Json,
  dispatch: MachineCommit["dispatch"],
  aggregates?: Checkpoint["aggregates"],
  publishActivities?: ReadonlyArray<ActivityCommand>,
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(function* (
  store,
  delivery,
  encodedState,
  dispatch,
  aggregates = delivery.checkpoint.aggregates,
  publishActivities = [],
) {
  const checkpoint: Checkpoint = {
    ...delivery.checkpoint,
    revision: delivery.checkpoint.revision + 1,
    state: encodedState,
    aggregates,
  }
  yield* commitMachine(store, {
    instanceId: delivery.checkpoint.instanceId as InstanceId,
    deliveryId: deliveryId(delivery.message.messageId),
    fence: delivery.claim.fence,
    expectedRevision: revision(delivery.checkpoint.revision),
    checkpoint,
    publishMessages: [],
    publishActivities,
    cancelMessageIds: [],
    cancelExecutionIds: [],
    dispatch,
  })
  return checkpoint
})

const commitDefect: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  defect: MachineDefectSummary,
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, store, delivery, defect) {
    const state = yield* decodeJson<Tagged>(
      definition.schemas.state,
      delivery.checkpoint.state,
      "decode defected checkpoint state",
    )
    const checkpoint: Checkpoint = {
      ...makeCheckpoint(
        delivery.checkpoint,
        delivery.checkpoint.state,
        "defected",
        undefined,
        defect,
      ),
      timers: [],
      aggregates: [],
    }
    yield* commitMachine(store, {
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages: [],
      publishActivities: [],
      cancelMessageIds: delivery.checkpoint.timers.map((timer) => messageId(timer.messageId)),
      cancelExecutionIds: oldRuntimeExecutionIds(
        nodes,
        delivery.checkpoint.instanceId as InstanceId,
        delivery.checkpoint,
        state,
      ),
      dispatch:
        delivery.message._tag === "External"
          ? dispatchFor(checkpoint, delivery.message, "rejected", defect.message)
          : undefined,
    })
    return checkpoint
  },
)

const activityOutcome: (
  schema: Schema.Top,
  channel: "Success" | "Failure",
  value: unknown,
) => Effect.Effect<ActivityOutcome, never, unknown> = Effect.fnUntraced(
  function* (schema, channel, value) {
    return yield* encodeJson(schema, value, `encode activity ${channel.toLowerCase()}`).pipe(
      Effect.map((encoded) =>
        channel === "Success"
          ? ({ _tag: "Success", encodedValue: encoded } as const)
          : ({ _tag: "Failure", encodedError: encoded } as const),
      ),
      Effect.catchTag("MachineEncodingError", (error) =>
        Effect.succeed({
          _tag: "Defect" as const,
          defect: defectSummary("encoding", error),
        }),
      ),
    )
  },
)

const nonFailureCause = (cause: Cause.Cause<unknown>): Cause.Cause<never> =>
  Cause.fromReasons(
    cause.reasons.filter(
      (reason): reason is Cause.Die | Cause.Interrupt => !Cause.isFailReason(reason),
    ),
  )

const findActivity = (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  command: ActivityCommand,
  deliveryAttempt: number,
  options: RuntimeRunOptions,
):
  | Readonly<{
      success: Schema.Top
      error: Schema.Top
      operation: Effect.Effect<unknown, unknown, unknown>
      retry?: Readonly<{
        name: string
        schedule: Schedule.Schedule<unknown, unknown, unknown, unknown>
      }>
    }>
  | undefined => {
  const parts = command.ownerPath.split("/")
  const node = nodes.get(parts[0] ?? "")
  const metadata: Machine.WorkExecution = {
    id: MachineStore.executionId(command.executionId),
    instanceId: MachineStore.machineInstanceId(command.instanceId),
    entryId: MachineStore.entryId(command.entryId),
    ownerPath: command.ownerPath,
    invocationName: command.invocation,
    ...(command.lane === "" ? {} : { laneName: command.lane }),
    deliveryAttempt,
  }
  if (parts.length === 3 && node?.kind === "regions") {
    const slot = parts[1] ?? ""
    const localTag = parts[2] ?? ""
    const invoke = node.regions?.[slot]?.states[localTag]?.invoke
    if (invoke === undefined || command.parentState === null) return undefined
    return {
      success: invoke.success,
      error: invoke.error,
      operation: Effect.gen(function* () {
        const parent = yield* decodeJson<Tagged>(
          definition.schemas.state,
          command.parentState as Json,
          "decode region activity parent",
        )
        const local = (parent as unknown as Readonly<Record<string, unknown>>)[slot] as Tagged
        return yield* invoke.effect(local, parent, metadata)
      }),
      retry: invoke.retry,
    }
  }
  if (
    node?.kind === "child" &&
    node.name !== undefined &&
    node.definition !== undefined &&
    node.input !== undefined &&
    command.invocation === `child:${node.name}`
  ) {
    const childDefinition = node.definition
    const childInput = node.input
    return {
      success: childDefinition.schemas.state,
      error: Schema.Never,
      operation: decodeJson<Tagged>(
        definition.schemas.state,
        command.state,
        "decode child parent state",
      ).pipe(
        Effect.flatMap((parent) =>
          run(
            childDefinition,
            childInput(parent),
            childRunOptions(
              childDefinition,
              instanceId(command.lane),
              options,
              definition.id,
              command.ownerPath,
              command.invocation.slice("child:".length),
            ),
          ).pipe(Effect.provideService(Store, baseStoreOf(store))),
        ),
        Effect.flatMap((handle) => handle.completion),
      ),
    }
  }
  if (node?.kind !== "invoke" || node.name !== command.invocation) return undefined
  const work = command.lane === "" ? node : node.tasks?.[command.lane]
  if (work?.effect === undefined || work.success === undefined || work.error === undefined) {
    return undefined
  }
  return {
    success: work.success,
    error: work.error,
    operation: decodeJson<Tagged>(
      definition.schemas.state,
      command.state,
      "decode activity state",
    ).pipe(
      Effect.flatMap((state) => work.effect?.(state, metadata) ?? Effect.die("missing activity")),
    ),
    retry: command.lane === "" ? node.retry : undefined,
  }
}

const outcomeMessage: (
  command: ActivityCommand,
  outcome: ActivityOutcome,
  now: number,
) => Effect.Effect<MachineMessage, MachineEncodingError, unknown> = Effect.fnUntraced(
  function* (command, outcome, now) {
    const encodedOutcome = yield* encodeJson(ActivityOutcome, outcome, "encode activity outcome")
    return {
      _tag: "ActivityOutcome",
      messageId: deriveMessageId(
        command.instanceId as InstanceId,
        revision(0),
        command.ownerPath,
        `outcome:${command.executionId}`,
      ),
      instanceId: command.instanceId,
      availableAtEpochMillis: now,
      executionId: command.executionId,
      entryId: command.entryId,
      ownerPath: command.ownerPath,
      invocation: command.invocation,
      lane: command.lane,
      outcome: encodedOutcome,
    }
  },
)

const runActivity: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  command: ActivityCommand,
  claimFence: number,
  claimAttempt: number,
  options: RuntimeRunOptions,
  preserveCause: (cause: Cause.Cause<never>) => void,
) => Effect.Effect<void, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, store, command, claimFence, claimAttempt, options, preserveCause) {
    const located = findActivity(definition, nodes, store, command, claimAttempt, options)
    let outcome: ActivityOutcome
    if (located === undefined) {
      outcome = {
        _tag: "Defect",
        defect: defectSummary(
          "definition",
          new Error(
            `activity ${command.ownerPath}/${command.invocation}/${command.lane} is missing`,
          ),
        ),
      }
    } else {
      const metadataOperation = located.operation
      const retry = located.retry
      const operation =
        retry === undefined
          ? metadataOperation
          : Effect.retry(
              metadataOperation,
              retry.schedule.pipe(
                Schedule.tap((metadata) =>
                  store
                    .appendActivityTree(deliveryId(command.deliveryId), claimFence, [
                      inspectionDraft(
                        runtimeActor(options),
                        `${command.executionId}:retry:${claimAttempt}:${claimFence}:${metadata.attempt}`,
                        {
                          _tag: "InvocationRetryScheduled",
                          machineId: definition.id,
                          stateTag: command.ownerPath.split("/")[0] ?? command.ownerPath,
                          invocation: command.invocation,
                          generation: command.generation,
                          policy: retry.name,
                          attempt: metadata.attempt,
                          delayMillis: Duration.toMillis(metadata.duration),
                          ownerPath: command.ownerPath,
                          workKind:
                            command.ownerPath.split("/").length === 3
                              ? "effect"
                              : (nodes.get(command.ownerPath)?.workKind ?? "effect"),
                          ...(command.lane === "" ? {} : { lanes: [command.lane] }),
                        },
                      ),
                    ])
                    .pipe(
                      Effect.tap(() => options.observer?.refresh ?? Effect.void),
                      Effect.catchTag("LeaseLost", () => Effect.void),
                    ),
                ),
              ),
            )
      outcome = yield* Effect.matchCauseEffect(operation, {
        onFailure: (cause) => {
          if (Cause.hasInterrupts(cause)) {
            return Effect.failCause(nonFailureCause(cause))
          }
          const failure = Cause.findErrorOption(cause)
          return !Cause.hasDies(cause) && Option.isSome(failure)
            ? activityOutcome(located.error, "Failure", failure.value)
            : Effect.sync(() => {
                const defectCause = nonFailureCause(cause)
                preserveCause(defectCause)
                return {
                  _tag: "Defect" as const,
                  defect: defectSummary("activity", Cause.squash(cause)),
                }
              })
        },
        onSuccess: (value) => activityOutcome(located.success, "Success", value),
      })
    }
    const now = yield* store.now
    const message = yield* outcomeMessage(command, outcome, now)
    yield* completeActivity(store, deliveryId(command.deliveryId), claimFence, message)
  },
)

const processActivityOutcome: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  state: Tagged,
  message: Extract<MachineMessage, { readonly _tag: "ActivityOutcome" }>,
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, store, delivery, state, message) {
    const node = nodes.get(state._tag)
    const regionParts = message.ownerPath.split("/")
    const isRegion = regionParts.length === 3
    const activeEntry = isRegion
      ? delivery.checkpoint.regionEntryIds[regionParts[1] ?? ""]
      : delivery.checkpoint.rootEntryId
    if (activeEntry !== message.entryId) {
      return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
    }
    const encodedOutcome = message.outcome as Readonly<Record<string, unknown>>
    if (encodedOutcome._tag === "Defect") {
      return yield* commitDefect(
        definition,
        nodes,
        store,
        delivery,
        encodedOutcome.defect as MachineDefectSummary,
      )
    }

    if (isRegion && node?.kind === "regions") {
      const slot = regionParts[1] ?? ""
      const localTag = regionParts[2] ?? ""
      const local = (state as unknown as Readonly<Record<string, unknown>>)[slot]
      const invoke = node.regions?.[slot]?.states[localTag]?.invoke
      if (
        invoke === undefined ||
        typeof local !== "object" ||
        local === null ||
        !("_tag" in local)
      ) {
        return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
      }
      const success = encodedOutcome._tag === "Success"
      const value = yield* decodeJson(
        success ? invoke.success : invoke.error,
        (success ? encodedOutcome.encodedValue : encodedOutcome.encodedError) as Json,
        "decode region activity outcome",
      )
      const nextLocal = MachinePlan.planRegionOutcome(
        success ? invoke.onSuccess : invoke.onFailure,
        state,
        local as Tagged,
        success ? "success" : "failure",
        value,
      )
      const next = { ...state, [slot]: nextLocal } as Tagged
      return yield* commitRegionUpdate(
        definition,
        nodes,
        store,
        delivery,
        state,
        next,
        new Set([slot]),
      )
    }

    if (
      node?.kind === "child" &&
      node.name !== undefined &&
      node.definition !== undefined &&
      message.invocation === `child:${node.name}`
    ) {
      if (encodedOutcome._tag !== "Success") {
        return yield* commitDefect(
          definition,
          nodes,
          store,
          delivery,
          defectSummary("protocol", new Error(`child ${node.name} returned a failure outcome`)),
        )
      }
      const completionValue = yield* decodeJson(
        node.definition.schemas.state,
        encodedOutcome.encodedValue as Json,
        "decode child completion",
      )
      const planned = MachinePlan.planOutcome(
        node.onComplete as MachinePlan.OutcomeHandler<Tagged, unknown, "value">,
        state,
        "success",
        completionValue,
      )
      if (planned === undefined) {
        return yield* commitDefect(
          definition,
          nodes,
          store,
          delivery,
          defectSummary("protocol", new Error(`child ${node.name} completion did not transition`)),
        )
      }
      return yield* commitTransition(
        definition,
        nodes,
        store,
        delivery,
        state,
        planned.next,
        undefined,
      )
    }

    if (node?.kind !== "invoke" || node.name !== message.invocation) {
      return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
    }
    const task = message.lane === "" ? node : node.tasks?.[message.lane]
    if (task?.success === undefined || task.error === undefined) {
      return yield* commitDefect(
        definition,
        nodes,
        store,
        delivery,
        defectSummary("definition", new Error(`activity lane ${message.lane} is missing`)),
      )
    }
    const succeeded = encodedOutcome._tag === "Success"
    const value = yield* decodeJson(
      succeeded ? task.success : task.error,
      (succeeded ? encodedOutcome.encodedValue : encodedOutcome.encodedError) as Json,
      "decode activity outcome",
    )
    const workKind = node.workKind ?? "effect"
    if (workKind === "effect") {
      const planned = MachinePlan.planOutcome(
        succeeded ? node.onSuccess : node.onFailure,
        state,
        succeeded ? "success" : "failure",
        value,
      )
      if (planned === undefined) {
        return yield* commitDefect(
          definition,
          nodes,
          store,
          delivery,
          defectSummary("protocol", new Error("no activity outcome transition matched")),
        )
      }
      return yield* commitTransition(
        definition,
        nodes,
        store,
        delivery,
        state,
        planned.next,
        undefined,
      )
    }

    const index = delivery.checkpoint.aggregates.findIndex(
      (progress) =>
        progress.entryId === message.entryId && progress.invocation === message.invocation,
    )
    const current = delivery.checkpoint.aggregates[index]
    if (current === undefined) {
      return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
    }
    if (
      (succeeded && current.completed[message.lane] !== undefined) ||
      current.failures[message.lane] !== undefined
    ) {
      return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
    }

    if ((workKind === "race" && succeeded) || (workKind === "all" && !succeeded)) {
      const planned = MachinePlan.planOutcome(
        succeeded ? node.onSuccess : node.onFailure,
        state,
        succeeded ? "success" : "failure",
        workKind === "race" && succeeded ? { winner: message.lane, value } : value,
        workKind === "race" && succeeded,
      )
      if (planned === undefined) {
        return yield* commitDefect(
          definition,
          nodes,
          store,
          delivery,
          defectSummary("protocol", new Error("no aggregate outcome transition matched")),
        )
      }
      return yield* commitTransition(
        definition,
        nodes,
        store,
        delivery,
        state,
        planned.next,
        undefined,
      )
    }

    const running = current.running.filter((lane) => lane !== message.lane)
    const completed = succeeded
      ? {
          ...current.completed,
          [message.lane]: (encodedOutcome as { encodedValue: Json }).encodedValue,
        }
      : current.completed
    const failures = succeeded
      ? current.failures
      : {
          ...current.failures,
          [message.lane]: (encodedOutcome as { encodedError: Json }).encodedError,
        }
    if (current.pending.length === 0 && running.length === 0) {
      const aggregateValue =
        workKind === "all"
          ? Object.fromEntries(
              yield* Effect.forEach(Object.entries(completed), ([lane, encoded]) =>
                decodeJson(
                  node.tasks?.[lane]?.success ?? Schema.Json,
                  encoded,
                  `decode all lane ${lane}`,
                ).pipe(Effect.map((decoded) => [lane, decoded] as const)),
              ),
            )
          : value
      const planned = MachinePlan.planOutcome(
        workKind === "all" ? node.onSuccess : node.onFailure,
        state,
        workKind === "all" ? "success" : "failure",
        aggregateValue,
      )
      if (planned === undefined) {
        return yield* commitDefect(
          definition,
          nodes,
          store,
          delivery,
          defectSummary("protocol", new Error("no terminal aggregate transition matched")),
        )
      }
      return yield* commitTransition(
        definition,
        nodes,
        store,
        delivery,
        state,
        planned.next,
        undefined,
      )
    }

    const limit =
      node.concurrency === undefined || node.concurrency === "unbounded"
        ? Object.keys(node.tasks ?? {}).length
        : node.concurrency
    const capacity = Math.max(0, limit - running.length)
    const starting = workKind === "all" ? current.pending.slice(0, capacity) : []
    const pending = current.pending.slice(starting.length)
    const nextProgress = {
      ...current,
      pending,
      running: [...running, ...starting],
      completed,
      failures,
    }
    const aggregates = delivery.checkpoint.aggregates.map((progress, progressIndex) =>
      progressIndex === index ? nextProgress : progress,
    )
    const commands = starting.map((lane) =>
      activityCommand(
        delivery.checkpoint.instanceId as InstanceId,
        current.entryId,
        Number(current.entryId.split(":")[1] ?? delivery.checkpoint.revision),
        current.ownerPath,
        current.invocation,
        lane,
        current.state,
        current.parentState,
        `${delivery.checkpoint.instanceId}:${current.entryId}:${current.invocation}`,
        Math.max(1, limit),
      ),
    )
    return yield* commitPreservingEntry(
      store,
      delivery,
      delivery.checkpoint.state,
      undefined,
      aggregates,
      commands,
    )
  },
)

const commitRegionUpdate: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  previous: Tagged,
  next: Tagged,
  reenteredSlots: ReadonlySet<string>,
  dispatch?: MachineCommit["dispatch"],
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, store, delivery, previous, next, reenteredSlots, dispatch) {
    const encoded = yield* encodeJson(definition.schemas.state, next, "encode region state")
    const node = nodes.get(next._tag)
    const now = yield* store.now
    const regionEntryIds = new Map(Object.entries(delivery.checkpoint.regionEntryIds))
    const timers = delivery.checkpoint.timers.filter(
      (timer) =>
        ![...reenteredSlots].some((slot) => timer.ownerPath.startsWith(`${next._tag}/${slot}/`)),
    )
    const publishMessages: Array<MachineMessage> = []
    const publishActivities: Array<ActivityCommand> = []
    const cancelMessageIds = delivery.checkpoint.timers
      .filter((timer) => !timers.includes(timer))
      .map((timer) => messageId(timer.messageId))
    const cancelExecutionIds: Array<ReturnType<typeof executionId>> = []
    if (node?.kind === "regions") {
      for (const slot of reenteredSlots) {
        const priorLocal = (previous as unknown as Readonly<Record<string, unknown>>)[slot]
        const oldEntry = delivery.checkpoint.regionEntryIds[slot]
        if (
          typeof priorLocal === "object" &&
          priorLocal !== null &&
          "_tag" in priorLocal &&
          oldEntry !== undefined
        ) {
          const invoke = node.regions?.[slot]?.states[(priorLocal as Tagged)._tag]?.invoke
          if (invoke !== undefined) {
            cancelExecutionIds.push(
              deriveRuntimeExecutionId(
                delivery.checkpoint.instanceId as InstanceId,
                entryId(oldEntry),
                `${previous._tag}/${slot}/${(priorLocal as Tagged)._tag}`,
                invoke.name,
              ),
            )
          }
        }
        const planned = yield* planRegionSlot(
          delivery.checkpoint.instanceId as InstanceId,
          delivery.checkpoint.revision + 1,
          next,
          encoded,
          node,
          slot,
          now,
        )
        for (const [plannedSlot, plannedEntryId] of Object.entries(planned.regionEntryIds)) {
          regionEntryIds.set(plannedSlot, plannedEntryId)
        }
        timers.push(...planned.timers)
        publishMessages.push(...planned.messages)
        publishActivities.push(...planned.activities)
      }
      if (node.onComplete !== undefined && MachinePlan.regionsComplete(node, next)) {
        publishMessages.push({
          _tag: "RegionsComplete",
          messageId: deriveMessageId(
            delivery.checkpoint.instanceId as InstanceId,
            revision(delivery.checkpoint.revision + 1),
            next._tag,
            "regions-complete",
          ),
          instanceId: delivery.checkpoint.instanceId,
          availableAtEpochMillis: now,
          entryId: delivery.checkpoint.rootEntryId,
          ownerPath: next._tag,
        })
      }
    }
    const checkpoint: Checkpoint = {
      ...delivery.checkpoint,
      revision: delivery.checkpoint.revision + 1,
      state: encoded,
      regionEntryIds: recordFromEntries(regionEntryIds),
      timers,
    }
    yield* commitMachine(store, {
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages,
      publishActivities,
      cancelMessageIds,
      cancelExecutionIds,
      dispatch,
    })
    return checkpoint
  },
)

const processDelivery: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  options: RuntimeRunOptions,
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, store, delivery, options) {
    return yield* Effect.gen(function* () {
      if (delivery.checkpoint.status !== "running") {
        return yield* new StoreError({
          operation: "processDelivery",
          message: `store returned work for ${delivery.checkpoint.status} instance ${delivery.checkpoint.instanceId}`,
        })
      }
      const state = yield* decodeJson<Tagged>(
        definition.schemas.state,
        delivery.checkpoint.state,
        "decode checkpoint state",
      )
      const node = nodes.get(state._tag)
      const message = delivery.message

      if (message._tag === "ActivityOutcome") {
        return yield* processActivityOutcome(definition, nodes, store, delivery, state, message)
      }

      if (message._tag === "Timer") {
        const parts = message.ownerPath.split("/")
        if (parts.length === 3 && node?.kind === "regions") {
          const slot = parts[1] ?? ""
          const local = (state as unknown as Readonly<Record<string, unknown>>)[slot]
          const regionNode = node.regions?.[slot]?.states[parts[2] ?? ""]
          if (
            delivery.checkpoint.regionEntryIds[slot] !== message.entryId ||
            regionNode?.after === undefined ||
            typeof local !== "object" ||
            local === null ||
            !("_tag" in local)
          ) {
            return yield* commitPreservingEntry(
              store,
              delivery,
              delivery.checkpoint.state,
              undefined,
            )
          }
          const planned = MachinePlan.planRegionAfter(regionNode.after, state, local as Tagged)
          if (planned === undefined) {
            return yield* commitDefect(
              definition,
              nodes,
              store,
              delivery,
              defectSummary("protocol", new Error("no region timer transition matched")),
            )
          }
          const next = { ...state, [slot]: planned.next } as Tagged
          return yield* commitRegionUpdate(
            definition,
            nodes,
            store,
            delivery,
            state,
            next,
            new Set([slot]),
          )
        }
        if (delivery.checkpoint.rootEntryId !== message.entryId || node?.after === undefined) {
          return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
        }
        const planned = MachinePlan.planAfter(node.after, state)
        if (planned === undefined) {
          return yield* commitDefect(
            definition,
            nodes,
            store,
            delivery,
            defectSummary("protocol", new Error("no timer transition matched")),
          )
        }
        return yield* commitTransition(
          definition,
          nodes,
          store,
          delivery,
          state,
          planned.next,
          undefined,
        )
      }

      if (message._tag === "RegionsComplete") {
        if (
          message.entryId !== delivery.checkpoint.rootEntryId ||
          node?.kind !== "regions" ||
          node.onComplete === undefined ||
          !MachinePlan.regionsComplete(node, state)
        ) {
          return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
        }
        const transition = node.onComplete as {
          target: string
          reduce: (args: { state: Tagged }) => Readonly<Record<string, unknown>>
        }
        const next = { ...transition.reduce({ state }), _tag: transition.target } as Tagged
        return yield* commitTransition(definition, nodes, store, delivery, state, next, undefined)
      }

      const event = yield* decodeJson<Tagged>(
        definition.schemas.event,
        message.event,
        "decode external event",
      )
      if (
        node?.kind === "child" &&
        node.name !== undefined &&
        node.definition !== undefined &&
        node.input !== undefined
      ) {
        const forwarded = node.forward?.[event._tag]
        if (forwarded !== undefined) {
          const childEvent = forwarded.map({ state, event })
          if (childEvent._tag !== forwarded.target) {
            return yield* commitDefect(
              definition,
              nodes,
              store,
              delivery,
              defectSummary(
                "definition",
                new Error(
                  `child forwarder ${event._tag} expected ${forwarded.target} but returned ${childEvent._tag}`,
                ),
              ),
            )
          }
          const childId = childInstanceId(
            options.instanceId,
            delivery.checkpoint.rootEntryId,
            node.name,
          )
          const idempotencyKey = `${message.messageId}:forward:${node.name}`
          const child = yield* run(
            node.definition,
            node.input(state),
            childRunOptions(
              node.definition,
              childId,
              options,
              definition.id,
              state._tag,
              node.name,
            ),
          ).pipe(Effect.provideService(Store, baseStoreOf(store)))
          yield* child.send(childEvent, { idempotencyKey })
          return yield* commitPreservingEntry(
            store,
            delivery,
            delivery.checkpoint.state,
            dispatchFor(
              { ...delivery.checkpoint, revision: delivery.checkpoint.revision + 1 },
              message,
              "committed",
            ),
          )
        }
      }
      if (node?.kind === "regions") {
        const regionPlan = MachinePlan.planRegionEvent(node, state, event)
        if (regionPlan !== undefined) {
          const next = regionPlan.next
          return yield* commitRegionUpdate(
            definition,
            nodes,
            store,
            delivery,
            state,
            next,
            regionPlan.reenteredSlots,
            dispatchFor(
              { ...delivery.checkpoint, revision: delivery.checkpoint.revision + 1 },
              message,
              "committed",
            ),
          )
        }
      }
      const planned = MachinePlan.planEvent(node?.on?.[event._tag], state, event)
      if (planned === undefined) {
        return yield* commitDefect(
          definition,
          nodes,
          store,
          delivery,
          defectSummary(
            "protocol",
            new Error(`machine ${definition.id} does not accept ${event._tag} in ${state._tag}`),
          ),
        )
      }
      const targetRevision = delivery.checkpoint.revision + 1
      const dispatch = dispatchFor(
        { ...delivery.checkpoint, revision: targetRevision },
        message,
        "committed",
      )
      if (planned.kind === "ignore") {
        return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, dispatch)
      }
      if (planned.kind === "stay") {
        const encoded = yield* encodeJson(
          definition.schemas.state,
          planned.next,
          "encode stay state",
        )
        return yield* commitPreservingEntry(store, delivery, encoded, dispatch)
      }
      return yield* commitTransition(
        definition,
        nodes,
        store,
        delivery,
        state,
        planned.next,
        dispatch,
      )
    }).pipe(
      Effect.catchTag("MachineEncodingError", (error) =>
        commitDefect(definition, nodes, store, delivery, defectSummary("encoding", error)),
      ),
    )
  },
)

const committedObservationDrafts: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  delivery: MachineDelivery,
  checkpoint: Checkpoint,
  options: RuntimeRunOptions,
) => Effect.Effect<ReadonlyArray<TreeRecordDraft>, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, delivery, checkpoint, options) {
    const actor = runtimeActor(options)
    const previous = yield* decodeJson<Tagged>(
      definition.schemas.state,
      delivery.checkpoint.state,
      "decode observed prior state",
    )
    const next = yield* decodeJson<Tagged>(
      definition.schemas.state,
      checkpoint.state,
      "decode observed committed state",
    )
    const prefix = `${checkpoint.instanceId}:revision:${checkpoint.revision}`
    const inspections: Array<Readonly<{ metadata: Machine.InspectionEvent; event?: Json }>> = []
    const node = nodes.get(previous._tag)
    const message = delivery.message

    if (message._tag === "External") {
      const event = yield* decodeJson<Tagged>(
        definition.schemas.event,
        message.event,
        "decode observed event",
      )
      inspections.push({
        metadata: {
          _tag: "EventReceived",
          machineId: definition.id,
          stateTag: previous._tag,
          eventTag: event._tag,
        },
        event: message.event,
      })
      const forwarded = node?.kind === "child" ? node.forward?.[event._tag] : undefined
      if (forwarded !== undefined && node?.name !== undefined && checkpoint.status === "running") {
        const childEvent = forwarded.map({ state: previous, event })
        inspections.push({
          metadata: {
            _tag: "ChildEventForwarded",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: node.name,
            instanceId: childInstanceId(
              options.instanceId,
              delivery.checkpoint.rootEntryId,
              node.name,
            ),
            parentEventTag: event._tag,
            childEventTag: childEvent._tag,
            generation: delivery.checkpoint.revision,
          },
        })
      } else if (node?.kind === "regions") {
        const regionPlan = MachinePlan.planRegionEvent(node, previous, event)
        if (regionPlan !== undefined) {
          for (const transition of regionPlan.transitions) {
            inspections.push({
              metadata: {
                _tag: "TransitionSelected",
                machineId: definition.id,
                sourceStateTag: transition.source,
                targetStateTag: transition.target,
                eventTag: event._tag,
                ownerPath: `${previous._tag}/${transition.slot}/${transition.source}`,
                macrostep: checkpoint.revision,
              },
            })
          }
        }
      } else {
        const planned = MachinePlan.planEvent(node?.on?.[event._tag], previous, event)
        if (planned?.kind === "ignore") {
          inspections.push({
            metadata: {
              _tag: "EventIgnored",
              machineId: definition.id,
              stateTag: previous._tag,
              eventTag: event._tag,
            },
          })
        } else if (planned !== undefined) {
          inspections.push({
            metadata: {
              _tag: "TransitionSelected",
              machineId: definition.id,
              sourceStateTag: previous._tag,
              targetStateTag: planned.next._tag,
              eventTag: event._tag,
              ...(planned.kind === "transition" && planned.branch !== undefined
                ? { branch: planned.branch }
                : {}),
            },
          })
        } else if (checkpoint.status === "defected") {
          inspections.push({
            metadata: {
              _tag: "MachineDefected",
              machineId: definition.id,
              stateTag: previous._tag,
              eventTag: event._tag,
              defect: "ProtocolDefect",
            },
          })
        }
      }
    } else if (message._tag === "Timer") {
      const timer = delivery.checkpoint.timers.find(
        (candidate) => candidate.messageId === message.messageId,
      )
      if (timer !== undefined) {
        inspections.push({
          metadata: {
            _tag: "TimerFired",
            machineId: definition.id,
            stateTag: previous._tag,
            timer: timer.name,
            generation: delivery.checkpoint.revision,
            ownerPath: timer.ownerPath,
            durationMillis: timer.durationMillis,
          },
        })
      }
      if (node?.after !== undefined && message.entryId === delivery.checkpoint.rootEntryId) {
        const planned = MachinePlan.planAfter(node.after, previous)
        if (planned !== undefined) {
          inspections.push({
            metadata: {
              _tag: "TransitionSelected",
              machineId: definition.id,
              sourceStateTag: previous._tag,
              targetStateTag: planned.next._tag,
              eventTag: "@after",
              ownerPath: message.ownerPath,
              macrostep: checkpoint.revision,
              ...(planned.branch === undefined ? {} : { branch: planned.branch }),
            },
          })
        }
      } else if (message.ownerPath.split("/").length === 3 && node?.kind === "regions") {
        const [, slot = "", localTag = ""] = message.ownerPath.split("/")
        const local = (previous as unknown as Readonly<Record<string, unknown>>)[slot]
        const after = node.regions?.[slot]?.states[localTag]?.after
        if (after !== undefined && typeof local === "object" && local !== null && "_tag" in local) {
          const selected = MachinePlan.selectRegionAfter(after, {
            state: local as Tagged,
            parent: previous,
          })
          if (selected !== undefined) {
            inspections.push({
              metadata: {
                _tag: "TransitionSelected",
                machineId: definition.id,
                sourceStateTag: localTag,
                targetStateTag: selected.transition.target,
                eventTag: "@after",
                ownerPath: `${previous._tag}/${slot}/${localTag}`,
                macrostep: checkpoint.revision,
                ...(selected.branch === undefined ? {} : { branch: selected.branch }),
              },
            })
          }
        }
      }
    } else if (message._tag === "RegionsComplete") {
      if (node?.kind === "regions" && node.onComplete !== undefined) {
        const transition = node.onComplete as Readonly<{ target: string }>
        inspections.push({
          metadata: {
            _tag: "TransitionSelected",
            machineId: definition.id,
            sourceStateTag: previous._tag,
            targetStateTag: transition.target,
            eventTag: "@complete",
            ownerPath: previous._tag,
            macrostep: checkpoint.revision,
          },
        })
      }
    } else if (message._tag === "ActivityOutcome") {
      const outcome = message.outcome as Readonly<Record<string, unknown>>
      const regionParts = message.ownerPath.split("/")
      if (regionParts.length === 3 && node?.kind === "regions") {
        const [, slot = "", localTag = ""] = regionParts
        const invoke = node.regions?.[slot]?.states[localTag]?.invoke
        const succeeded = outcome._tag === "Success"
        inspections.push({
          metadata: {
            _tag:
              outcome._tag === "Success"
                ? "InvocationSucceeded"
                : outcome._tag === "Failure"
                  ? "InvocationFailed"
                  : "InvocationDefected",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: invoke?.name ?? message.invocation,
            generation: delivery.checkpoint.revision,
            ownerPath: `${previous._tag}/${slot}/${localTag}`,
            workKind: "effect",
          },
        })
        if (invoke !== undefined && (succeeded || outcome._tag === "Failure")) {
          inspections.push({
            metadata: {
              _tag: "TransitionSelected",
              machineId: definition.id,
              sourceStateTag: localTag,
              targetStateTag: (succeeded ? invoke.onSuccess : invoke.onFailure).target,
              eventTag: succeeded ? "@success" : "@failure",
              ownerPath: `${previous._tag}/${slot}/${localTag}`,
              macrostep: checkpoint.revision,
            },
          })
        }
      } else if (node?.kind === "child" && node.name !== undefined) {
        let branch: Machine.SelectedBranch | undefined
        if (outcome._tag === "Success" && node.definition !== undefined) {
          const value = yield* decodeJson(
            node.definition.schemas.state,
            outcome.encodedValue as Json,
            "decode observed child completion",
          )
          branch = MachinePlan.planOutcome(
            node.onComplete as MachinePlan.OutcomeHandler<Tagged, unknown, "value">,
            previous,
            "success",
            value,
          )?.branch
        }
        inspections.push({
          metadata: {
            _tag: outcome._tag === "Defect" ? "ChildDefected" : "ChildCompleted",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: node.name,
            instanceId: message.lane,
            generation: delivery.checkpoint.revision,
            ...(branch === undefined ? {} : { branch }),
          },
        })
      } else if (node?.kind === "invoke" && node.name !== undefined) {
        const task = message.lane === "" ? node : node.tasks?.[message.lane]
        const succeeded = outcome._tag === "Success"
        const branch =
          (succeeded || outcome._tag === "Failure") &&
          task?.success !== undefined &&
          task.error !== undefined
            ? MachinePlan.planOutcome(
                succeeded ? node.onSuccess : node.onFailure,
                previous,
                succeeded ? "success" : "failure",
                yield* decodeJson(
                  succeeded ? task.success : task.error,
                  (succeeded ? outcome.encodedValue : outcome.encodedError) as Json,
                  "decode observed activity outcome",
                ),
              )?.branch
            : undefined
        inspections.push({
          metadata: {
            _tag:
              outcome._tag === "Success"
                ? "InvocationSucceeded"
                : outcome._tag === "Failure"
                  ? "InvocationFailed"
                  : "InvocationDefected",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: node.name,
            generation: delivery.checkpoint.revision,
            ownerPath: message.ownerPath,
            workKind: node.workKind ?? "effect",
            ...(node.tasks === undefined ? {} : { lanes: Object.keys(node.tasks) }),
            ...(branch === undefined ? {} : { branch }),
          },
        })
      }
    }

    const changed = canonicalJson(delivery.checkpoint.state) !== canonicalJson(checkpoint.state)
    if (changed) {
      const priorChild = node?.kind === "child" && node.name !== undefined ? node : undefined
      if (priorChild !== undefined && checkpoint.rootEntryId !== delivery.checkpoint.rootEntryId) {
        inspections.push({
          metadata: {
            _tag: "ChildCancelled",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: priorChild.name ?? "child",
            instanceId: childInstanceId(
              options.instanceId,
              delivery.checkpoint.rootEntryId,
              priorChild.name ?? "child",
            ),
            generation: delivery.checkpoint.revision,
          },
        })
      }
      if (node?.kind === "invoke" && next._tag !== previous._tag && message._tag === "External") {
        inspections.push({
          metadata: {
            _tag: "InvocationCancelled",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: node.name ?? "invoke",
            generation: delivery.checkpoint.revision,
            ownerPath: previous._tag,
            workKind: node.workKind ?? "effect",
            ...(node.tasks === undefined ? {} : { lanes: Object.keys(node.tasks) }),
          },
        })
      }
      inspections.push({
        metadata: {
          _tag: "StateChanged",
          machineId: definition.id,
          previousStateTag: previous._tag,
          nextStateTag: next._tag,
        },
      })
    }
    if (checkpoint.status === "completed") {
      inspections.push({
        metadata: {
          _tag: "MachineCompleted",
          machineId: definition.id,
          finalStateTag: next._tag,
        },
      })
    }

    const records = inspections.map((inspection, index) =>
      inspectionDraft(
        actor,
        `${prefix}:inspection:${index}`,
        inspection.metadata,
        inspection.event,
      ),
    )
    if (changed) {
      records.push(
        observationDraft(actor, `${prefix}:snapshot`, {
          _tag: "StateSnapshot",
          state: checkpoint.state,
        }),
      )
    }
    for (const timer of delivery.checkpoint.timers) {
      if (
        (message._tag === "Timer" && timer.messageId === message.messageId) ||
        checkpoint.timers.some((candidate) => candidate.messageId === timer.messageId)
      ) {
        continue
      }
      records.push(
        inspectionDraft(actor, `${prefix}:timer-cancelled:${timer.messageId}`, {
          _tag: "TimerCancelled",
          machineId: definition.id,
          stateTag: previous._tag,
          timer: timer.name,
          generation: checkpoint.revision,
          ownerPath: timer.ownerPath,
          durationMillis: timer.durationMillis,
        }),
      )
    }
    if (delivery.checkpoint.rootEntryId !== checkpoint.rootEntryId) {
      for (const timer of checkpoint.timers) {
        records.push(
          inspectionDraft(actor, `${prefix}:timer-started:${timer.messageId}`, {
            _tag: "TimerStarted",
            machineId: definition.id,
            stateTag: next._tag,
            timer: timer.name,
            generation: checkpoint.revision,
            ownerPath: timer.ownerPath,
            durationMillis: timer.durationMillis,
          }),
        )
      }
      const nextNode = nodes.get(next._tag)
      if (nextNode?.kind === "invoke" && nextNode.name !== undefined) {
        records.push(
          inspectionDraft(actor, `${prefix}:invocation-started:${nextNode.name}`, {
            _tag: "InvocationStarted",
            machineId: definition.id,
            stateTag: next._tag,
            invocation: nextNode.name,
            generation: checkpoint.revision,
            ownerPath: next._tag,
            workKind: nextNode.workKind ?? "effect",
            ...(nextNode.tasks === undefined ? {} : { lanes: Object.keys(nextNode.tasks) }),
          }),
        )
      }
    }
    if (checkpoint.status !== "running") {
      records.push(
        observationDraft(actor, `${prefix}:terminated`, {
          _tag: "ActorTerminated",
          status: checkpoint.status === "completed" ? "completed" : "defected",
        }),
      )
    }
    return records
  },
)

const initialize: (
  definition: RuntimeDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  input: unknown,
  options: RuntimeRunOptions,
  store: StoreService,
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, nodes, input, options, store) {
    const state = definition.initial(input as never)
    if (!nodes.has(state._tag)) {
      return yield* new MachineEncodingError({
        operation: "initialize",
        message: `machine ${definition.id} initialized to missing state ${state._tag}`,
      })
    }
    const encoded = yield* encodeJson(definition.schemas.state, state, "encode initial state")
    const now = yield* store.now
    const isFinal = nodes.get(state._tag)?.kind === "final"
    const entry = isFinal
      ? {
          rootEntryId: deriveEntryId(options.instanceId, revision(0), state._tag),
          regionEntryIds: {},
          timers: [],
          aggregates: [],
          messages: [],
          activities: [],
        }
      : yield* planEntry(nodes, options.instanceId, 0, state, encoded, now)
    const checkpoint: Checkpoint = {
      formatVersion: checkpointFormatVersion,
      definitionId: definition.id,
      persistenceVersion: options.persistenceVersion,
      instanceId: options.instanceId,
      revision: 0,
      status: isFinal ? "completed" : "running",
      state: encoded,
      rootEntryId: entry.rootEntryId,
      regionEntryIds: entry.regionEntryIds,
      timers: entry.timers,
      aggregates: entry.aggregates,
      nextSequence: 0,
      defect: null,
    }
    const created = yield* createInstance(store, {
      checkpoint,
      messages: entry.messages,
      activities: entry.activities,
    })
    if (created) return checkpoint
    const loaded = yield* store.load(options.instanceId)
    if (Option.isNone(loaded)) {
      return yield* new MachineEncodingError({
        operation: "create",
        message: "store reported an existing instance but it could not be loaded",
      })
    }
    return loaded.value
  },
)

const validateCompatibility: (
  definition: RuntimeDefinition,
  options: RuntimeRunOptions,
  checkpoint: Checkpoint,
) => Effect.Effect<void, CompatibilityError> = Effect.fnUntraced(
  function* (definition, options, checkpoint) {
    if (checkpoint.definitionId !== definition.id) {
      return yield* Effect.fail(
        new CompatibilityError({
          instanceId: options.instanceId,
          reason: {
            _tag: "DefinitionMismatch",
            expectedDefinitionId: definition.id,
            actualDefinitionId: checkpoint.definitionId,
          },
        }),
      )
    }
    if (checkpoint.persistenceVersion !== options.persistenceVersion) {
      return yield* Effect.fail(
        new CompatibilityError({
          instanceId: options.instanceId,
          reason: {
            _tag: "PersistenceVersionMismatch",
            expected: options.persistenceVersion,
            actual: persistenceVersion(checkpoint.persistenceVersion),
          },
        }),
      )
    }
  },
)

const migrateCheckpoint: (
  definition: RuntimeDefinition,
  options: RuntimeRunOptions,
  store: StoreService,
  checkpoint: Checkpoint,
) => Effect.Effect<Checkpoint, MachineError, unknown> = Effect.fnUntraced(
  function* (definition, options, store, checkpoint) {
    if (checkpoint.persistenceVersion === options.persistenceVersion) return checkpoint
    const loaded = yield* store.loadDocument(options.instanceId)
    if (Option.isNone(loaded)) {
      return yield* new MigrationError({
        instanceId: options.instanceId,
        message: "persisted migration document is missing",
      })
    }
    let document = yield* Schema.decodeUnknownEffect(MigrationDocument)(loaded.value).pipe(
      Effect.mapError(
        (error) =>
          new MigrationError({
            instanceId: options.instanceId,
            message: `stored migration document is invalid: ${String(error)}`,
            cause: error,
          }),
      ),
    )
    let current = persistenceVersion(document.checkpoint.persistenceVersion)
    const visited = new Set<string>()
    while (current !== options.persistenceVersion) {
      if (visited.has(current)) {
        return yield* new MigrationError({
          instanceId: options.instanceId,
          message: `migration cycle detected at ${current}`,
        })
      }
      visited.add(current)
      const migration = options.migrations?.find((candidate) => candidate.from === current)
      if (migration === undefined) {
        return yield* new CompatibilityError({
          instanceId: options.instanceId,
          reason: {
            _tag: "MissingMigration",
            from: current,
            target: options.persistenceVersion,
          },
        })
      }
      document = yield* migration.migrate(document)
      document = yield* Schema.decodeUnknownEffect(MigrationDocument)(document).pipe(
        Effect.mapError(
          (error) =>
            new MigrationError({
              instanceId: options.instanceId,
              message: `migration ${migration.from} -> ${migration.to} returned an invalid document: ${String(error)}`,
              cause: error,
            }),
        ),
      )
      current = migration.to
    }
    const migratedCheckpoint: Checkpoint = {
      ...document.checkpoint,
      definitionId: definition.id,
      persistenceVersion: options.persistenceVersion,
      revision: checkpoint.revision + 1,
    }
    yield* decodeJson<Tagged>(
      definition.schemas.state,
      migratedCheckpoint.state,
      "decode migrated state",
    ).pipe(
      Effect.mapError(
        (error) =>
          new MigrationError({
            instanceId: options.instanceId,
            message: error.message,
            cause: error,
          }),
      ),
    )
    const migrated: MigrationDocument = { ...document, checkpoint: migratedCheckpoint }
    yield* Schema.decodeUnknownEffect(MigrationDocument)(migrated).pipe(
      Effect.mapError(
        (error) =>
          new MigrationError({
            instanceId: options.instanceId,
            message: `final migration document is invalid: ${String(error)}`,
            cause: error,
          }),
      ),
    )
    yield* store.commitMigration(options.instanceId, revision(checkpoint.revision), migrated)
    return migratedCheckpoint
  },
)

/** Package-private checkpoint runtime used by the public MachineEngine service. */
export const run = <Definition extends RuntimeDefinition>(
  definition: Definition,
  input: Machine.MachineInput<Definition>,
  options: RuntimeRunOptions,
): Effect.Effect<
  Handle<
    Machine.MachineState<Definition>,
    Machine.MachineEvent<Definition>,
    Machine.MachineCompletion<Definition>
  >,
  MachineError,
  | Scope.Scope
  | Store
  | Machine.MachineRequirements<Definition>
  | Definition["schemas"]["state"]["EncodingServices"]
  | Definition["schemas"]["state"]["DecodingServices"]
  | Definition["schemas"]["event"]["EncodingServices"]
  | Definition["schemas"]["event"]["DecodingServices"]
> =>
  Effect.gen(function* () {
    const baseStore = yield* Store
    const cancellationStore = baseStoreOf(baseStore)
    const cancellationRegistry =
      activityCancellationRegistries.get(cancellationStore) ??
      new Map<string, ActivityCancellationEntry>()
    activityCancellationRegistries.set(cancellationStore, cancellationRegistry)
    const nodes = nodesOf(definition)
    let activeDelivery: MachineDelivery | undefined
    const store = Store.of({
      ...baseStore,
      create: (request) =>
        baseStore.create({
          ...request,
          treeRecords: initialObservationDrafts(definition, nodes, request.checkpoint, options),
        }),
      commitMachine: (commit) => {
        const committed =
          activeDelivery === undefined
            ? baseStore.commitMachine(commit)
            : (committedObservationDrafts(
                definition,
                nodes,
                activeDelivery,
                commit.checkpoint,
                options,
              ).pipe(
                Effect.flatMap((treeRecords) =>
                  baseStore.commitMachine({ ...commit, treeRecords }),
                ),
              ) as never)
        return committed.pipe(
          Effect.tap(() =>
            Effect.forEach(
              commit.cancelExecutionIds,
              (cancelledId) => {
                const owner = cancellationRegistry.get(cancelledId)
                return Effect.forEach(
                  cancellationRegistry.values(),
                  (entry) =>
                    entry === owner ||
                    cancellationOwnsInstance(cancelledId, entry.instanceId) ||
                    (owner?.childInstanceId !== undefined &&
                      isInstanceAtOrBelow(entry.instanceId, owner.childInstanceId))
                      ? Deferred.succeed(entry.signal, undefined)
                      : Effect.void,
                  { discard: true },
                )
              },
              { discard: true },
            ),
          ),
        )
      },
    })
    observationBaseStores.set(store, baseStoreOf(baseStore))
    const loaded = yield* store.load(options.instanceId)
    const loadedOrCreated = Option.isSome(loaded)
      ? loaded.value
      : yield* initialize(definition, nodes, input, options, store)
    if (loadedOrCreated.definitionId !== definition.id) {
      yield* validateCompatibility(definition, options, loadedOrCreated)
    }
    const initialCheckpoint = yield* migrateCheckpoint(definition, options, store, loadedOrCreated)
    yield* validateCompatibility(definition, options, initialCheckpoint)
    const initialState = yield* decodeJson<Machine.MachineState<Definition>>(
      definition.schemas.state,
      initialCheckpoint.state,
      "decode checkpoint state",
    )
    const initialNode = nodes.get((initialState as Tagged)._tag)
    if (
      initialCheckpoint.status === "running" &&
      initialNode?.kind === "child" &&
      initialNode.name !== undefined &&
      initialNode.definition !== undefined &&
      initialNode.input !== undefined
    ) {
      const childId = childInstanceId(
        options.instanceId,
        initialCheckpoint.rootEntryId,
        initialNode.name,
      )
      yield* run(
        initialNode.definition,
        initialNode.input(initialState as Tagged),
        childRunOptions(
          initialNode.definition,
          childId,
          options,
          definition.id,
          initialState._tag,
          initialNode.name,
        ),
      ).pipe(Effect.provideService(Store, baseStoreOf(store)))
    }
    const stateRef = yield* SubscriptionRef.make(initialState)
    const statusRef = yield* SubscriptionRef.make(initialCheckpoint.status)
    const completion = yield* Deferred.make<Machine.MachineCompletion<Definition>, MachineError>()
    let liveCause: Cause.Cause<never> | undefined
    let publishedRevision = initialCheckpoint.revision

    const publishCheckpoint: (
      checkpoint: Checkpoint,
    ) => Effect.Effect<void, MachineError, unknown> = Effect.fnUntraced(function* (checkpoint) {
      const decoded = yield* decodeJson<Machine.MachineState<Definition>>(
        definition.schemas.state,
        checkpoint.state,
        "decode committed state",
      )
      if (checkpoint.revision > publishedRevision) {
        publishedRevision = checkpoint.revision
        yield* SubscriptionRef.set(stateRef, decoded)
      }
      yield* SubscriptionRef.set(statusRef, checkpoint.status)
      if (checkpoint.status === "completed") {
        yield* Deferred.succeed(completion, decoded as Machine.MachineCompletion<Definition>)
        if (options.observer !== undefined) {
          yield* options.observer.terminate(runtimeActor(options), "completed")
        }
      } else if (checkpoint.status === "defected") {
        if (options.observer !== undefined) {
          yield* options.observer.terminate(runtimeActor(options), "defected")
        }
        yield* Deferred.fail(
          completion,
          new MachineInstanceDefect({
            instanceId: options.instanceId,
            defect:
              checkpoint.defect ?? defectSummary("unknown", new Error("durable instance defected")),
            ...(liveCause === undefined ? {} : { cause: liveCause }),
          }),
        )
      }
      if (options.observer !== undefined) yield* options.observer.refresh
    })

    yield* publishCheckpoint(initialCheckpoint)
    const machineWorker = workerId("machine", options.instanceId)
    const activityWorkers = Array.from(
      { length: Math.max(1, options.activityWorkerCount ?? 4) },
      () => workerId("activity", options.instanceId),
    )
    const machineLease = options.machineLeaseMillis ?? defaultMachineLeaseMillis
    const activityLease = options.activityLeaseMillis ?? defaultActivityLeaseMillis

    const processMachineOnce = Effect.gen(function* () {
      const claimed = yield* store.claimMachine(options.instanceId, machineWorker, machineLease)
      if (Option.isNone(claimed)) return false
      activeDelivery = claimed.value
      const renewal = Effect.forever(
        Effect.sleep(Math.max(1, Math.floor(machineLease / 2))).pipe(
          Effect.andThen(
            store.renewMachine(
              deliveryId(claimed.value.message.messageId),
              claimed.value.claim.fence,
              machineLease,
            ),
          ),
        ),
      )
      const checkpoint = yield* Effect.raceFirst(
        processDelivery(definition, nodes, store, claimed.value, options),
        renewal,
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            activeDelivery = undefined
          }),
        ),
      )
      yield* publishCheckpoint(checkpoint)
      return true
    }).pipe(
      Effect.catchTags({
        LeaseLost: () => Effect.succeed(true),
        RevisionConflict: () => Effect.succeed(true),
      }),
    )

    const drainMachine = Effect.gen(function* () {
      let worked = true
      while (worked) worked = yield* processMachineOnce
    })

    const processActivityOnce = Effect.fnUntraced(function* (activityWorker: string) {
      return yield* Effect.gen(function* () {
        const claimed = yield* store.claimActivity(
          options.instanceId,
          activityWorker,
          activityLease,
        )
        if (Option.isNone(claimed)) return false
        const cancellationSignal = yield* Deferred.make<void>()
        cancellationRegistry.set(claimed.value.command.executionId, {
          instanceId: instanceId(claimed.value.command.instanceId),
          ...(claimed.value.command.invocation.startsWith("child:")
            ? { childInstanceId: instanceId(claimed.value.command.lane) }
            : {}),
          signal: cancellationSignal,
        })
        const renewal = Effect.forever(
          Effect.sleep(Math.max(1, Math.floor(activityLease / 2))).pipe(
            Effect.andThen(
              store.renewActivity(
                deliveryId(claimed.value.command.deliveryId),
                claimed.value.claim.fence,
                activityLease,
              ),
            ),
          ),
        )
        const persistedCancellation = Effect.forever(
          Effect.sleep(options.pollIntervalMillis ?? idlePollMillis).pipe(
            Effect.andThen(
              store.activityClaimActive(
                deliveryId(claimed.value.command.deliveryId),
                claimed.value.claim.fence,
              ),
            ),
            Effect.flatMap((active) =>
              active
                ? Effect.void
                : Effect.fail(
                    new LeaseLost({
                      deliveryId: deliveryId(claimed.value.command.deliveryId),
                      expectedFence: claimed.value.claim.fence,
                    }),
                  ),
            ),
          ),
        )
        yield* Effect.raceFirst(
          runActivity(
            definition,
            nodes,
            store,
            claimed.value.command,
            claimed.value.claim.fence,
            claimed.value.claim.attempt,
            options,
            (cause) => {
              liveCause = cause
            },
          ),
          Effect.raceFirst(
            renewal,
            Effect.raceFirst(Deferred.await(cancellationSignal), persistedCancellation),
          ),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              cancellationRegistry.delete(claimed.value.command.executionId)
            }),
          ),
        )
        yield* drainMachine
        return true
      }).pipe(Effect.catchTag("LeaseLost", () => Effect.succeed(true)))
    })

    const loop = (step: Effect.Effect<boolean, MachineError, unknown>) =>
      Effect.forever(
        step.pipe(
          Effect.flatMap((worked) =>
            worked ? Effect.yieldNow : Effect.sleep(options.pollIntervalMillis ?? idlePollMillis),
          ),
        ),
      )

    if (initialCheckpoint.status === "running") {
      const reportWorkerFailure = (cause: Cause.Cause<MachineError>) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void
        const error = Cause.findErrorOption(cause)
        return Deferred.fail(
          completion,
          Option.isSome(error)
            ? error.value
            : new MachineInstanceDefect({
                instanceId: options.instanceId,
                defect: defectSummary("unknown", Cause.squash(cause)),
              }),
        ).pipe(Effect.asVoid)
      }
      yield* loop(processMachineOnce).pipe(
        Effect.catchCause(reportWorkerFailure),
        Effect.forkScoped,
      )
      for (const activityWorker of activityWorkers) {
        yield* loop(processActivityOnce(activityWorker)).pipe(
          Effect.catchCause(reportWorkerFailure),
          Effect.forkScoped,
        )
      }
    }

    const sync = Effect.gen(function* () {
      const latest = yield* store.load(options.instanceId)
      if (Option.isSome(latest)) yield* publishCheckpoint(latest.value)
    })

    const can: (
      event: Machine.MachineEvent<Definition>,
    ) => Effect.Effect<boolean, MachineError, unknown> = Effect.fnUntraced(function* (event) {
      yield* sync
      const state = yield* SubscriptionRef.get(stateRef)
      const node = nodes.get((state as Tagged)._tag)
      if (node?.kind === "child" && node.forward?.[(event as Tagged)._tag] !== undefined) {
        return true
      }
      if (node?.kind === "regions") {
        const region = MachinePlan.planRegionEvent(node, state as Tagged, event as Tagged)
        if (region !== undefined) return true
      }
      return (
        MachinePlan.planEvent(
          node?.on?.[(event as Tagged)._tag],
          state as Tagged,
          event as Tagged,
        ) !== undefined
      )
    })

    const send: (
      event: Machine.MachineEvent<Definition>,
      sendOptions: Readonly<{ idempotencyKey: string }>,
    ) => Effect.Effect<void, MachineError, unknown> = Effect.fnUntraced(
      function* (event, sendOptions) {
        const encoded = yield* encodeJson(definition.schemas.event, event, "encode event")
        const now = yield* store.now
        const id = deriveMessageId(
          options.instanceId,
          revision(0),
          "external",
          sendOptions.idempotencyKey,
        )
        const message: MachineMessage = {
          _tag: "External",
          messageId: id,
          instanceId: options.instanceId,
          availableAtEpochMillis: now,
          idempotencyKey: sendOptions.idempotencyKey,
          payloadFingerprint: canonicalJson(encoded),
          event: encoded,
        }
        yield* validateEnvelope(MachineMessage, message, "validate offered message")
        yield* store.offer({
          instanceId: options.instanceId,
          idempotencyKey: sendOptions.idempotencyKey,
          payloadFingerprint: message.payloadFingerprint,
          message,
        })
        yield* drainMachine
        const result = yield* store.observeDispatch(options.instanceId, sendOptions.idempotencyKey)
        yield* sync
        if (result.status === "rejected") {
          const latest = yield* store.load(options.instanceId)
          const defect = Option.isSome(latest)
            ? latest.value.defect
            : defectSummary("protocol", new Error(result.reason))
          return yield* new MachineInstanceDefect({
            instanceId: options.instanceId,
            defect: defect ?? defectSummary("protocol", new Error(result.reason)),
          })
        }
      },
    )

    if (options.observer !== undefined) {
      const actor = runtimeActor(options)
      let directDispatchSequence = 0
      yield* options.observer.register(actor, {
        can: (event) => can(event as Machine.MachineEvent<Definition>) as never,
        send: (event) =>
          send(event as Machine.MachineEvent<Definition>, {
            idempotencyKey: `${actor.actorId}:direct:${directDispatchSequence++}`,
          }) as never,
      })
      const terminal = yield* SubscriptionRef.get(statusRef)
      if (terminal !== "running") {
        yield* options.observer.terminate(
          actor,
          terminal === "completed" ? "completed" : "defected",
        )
      }
    }

    return {
      instanceId: options.instanceId,
      snapshot: sync.pipe(Effect.andThen(SubscriptionRef.get(stateRef))),
      changes: Stream.takeUntil(
        SubscriptionRef.changes(stateRef),
        (state) => nodes.get((state as Tagged)._tag)?.kind === "final",
      ),
      send,
      can,
      completion: Deferred.await(completion),
      status: sync.pipe(Effect.andThen(SubscriptionRef.get(statusRef))),
    }
    // The implementation erases heterogeneous runtime nodes internally; the public signature above
    // restores the exact definition-derived state, event, completion, and requirement channels.
  }) as never
