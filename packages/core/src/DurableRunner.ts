import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import {
  type ActivityCommand,
  type ActivityOutcome,
  type Checkpoint,
  CompatibilityError,
  type DurableDefectSummary,
  DurableEncodingError,
  type DurableError,
  DurableInstanceDefect,
  deliveryId,
  deriveEntryId,
  deriveExecutionKey,
  deriveMessageId,
  entryId,
  type executionKey,
  type Handle,
  type InstanceId,
  type Json,
  type MachineCommit,
  type MachineDelivery,
  type MachineMessage,
  MigrationDocument,
  MigrationError,
  messageId,
  persistenceVersion,
  type RunOptions,
  revision,
  Store,
  type StoreService,
  validateDefinition,
} from "./Durable.js"
import * as Machine from "./Machine.js"

interface Tagged {
  readonly _tag: string
}

interface DurableDefinition extends Machine.DefinitionMetadata {
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
    metadata?: Machine.WorkExecutionMetadata,
  ) => Effect.Effect<unknown, unknown, unknown>
}

interface RuntimeRegionNode {
  readonly final?: true
  readonly on?: Readonly<Record<string, unknown>>
  readonly after?: Readonly<{ duration: unknown }>
  readonly invoke?: Readonly<{
    name: string
    success: Schema.Top
    error: Schema.Top
    effect: (
      state: Tagged,
      parent: Tagged,
      metadata?: Machine.WorkExecutionMetadata,
    ) => Effect.Effect<unknown, unknown, unknown>
    retry?: Readonly<{ schedule: Schedule.Schedule<unknown, unknown, unknown, unknown> }>
    onSuccess: unknown
    onFailure: unknown
  }>
}

interface RuntimeNode {
  readonly kind: "state" | "invoke" | "regions" | "final"
  readonly tag: string
  readonly on?: Readonly<Record<string, unknown>>
  readonly after?: Readonly<{ duration: unknown }>
  readonly name?: string
  readonly workKind?: "effect" | "all" | "race"
  readonly success?: Schema.Top
  readonly error?: Schema.Top
  readonly effect?: (
    state: Tagged,
    metadata?: Machine.WorkExecutionMetadata,
  ) => Effect.Effect<unknown, unknown, unknown>
  readonly tasks?: Readonly<Record<string, RuntimeTask>>
  readonly concurrency?: number | "unbounded"
  readonly retry?: Readonly<{ schedule: Schedule.Schedule<unknown, unknown, unknown, unknown> }>
  readonly onSuccess?: unknown
  readonly onFailure?: unknown
  readonly regions?: Readonly<
    Record<string, Readonly<{ states: Readonly<Record<string, RuntimeRegionNode>> }>>
  >
  readonly onComplete?: unknown
}

interface EntryWork {
  readonly rootEntryId: string
  readonly regionEntryIds: Readonly<Record<string, string>>
  readonly timers: ReadonlyArray<Checkpoint["timers"][number]>
  readonly aggregates: ReadonlyArray<Checkpoint["aggregates"][number]>
  readonly messages: ReadonlyArray<MachineMessage>
  readonly activities: ReadonlyArray<ActivityCommand>
}

const checkpointFormatVersion = 1
const defaultMachineLeaseMillis = 30_000
const defaultActivityLeaseMillis = 30_000
const idlePollMillis = 25
let workerSequence = 0

const workerId = (kind: "machine" | "activity", instance: InstanceId): string =>
  `${kind}:${instance}:${++workerSequence}`

const asJson = (value: unknown): Json => value as Json

const encodeJson = (
  schema: Schema.Top,
  value: unknown,
  operation: string,
): Effect.Effect<Json, DurableEncodingError, unknown> =>
  Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.map(asJson),
    Effect.mapError((error) => new DurableEncodingError({ operation, message: String(error) })),
  )

const decodeJson = <Value>(
  schema: Schema.Top,
  value: Json,
  operation: string,
): Effect.Effect<Value, DurableEncodingError, unknown> =>
  Schema.decodeUnknownEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.map((decoded) => decoded as Value),
    Effect.mapError((error) => new DurableEncodingError({ operation, message: String(error) })),
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
  category: DurableDefectSummary["category"],
  error: unknown,
): DurableDefectSummary => ({
  category,
  name: error instanceof Error ? error.name : "UnknownDefect",
  message: error instanceof Error ? error.message : String(error),
})

const nodesOf = (definition: DurableDefinition): ReadonlyMap<string, RuntimeNode> =>
  new Map(
    (Machine.definitionNodes(definition) as unknown as ReadonlyArray<RuntimeNode>).map((node) => [
      node.tag,
      node,
    ]),
  )

const activityCommand = (
  instance: InstanceId,
  ownerEntryId: string,
  ownerPath: string,
  invocation: string,
  lane: string,
  state: Json,
  parentState: Json | null,
  concurrencyGroup: string,
  concurrencyLimit: number,
): ActivityCommand => {
  const key = deriveExecutionKey(instance, entryId(ownerEntryId), ownerPath, invocation, lane)
  return {
    deliveryId: key,
    instanceId: instance,
    executionKey: key,
    entryId: ownerEntryId,
    ownerPath,
    invocation,
    lane,
    state,
    parentState,
    concurrencyGroup,
    concurrencyLimit,
  }
}

const timerWork = (
  instance: InstanceId,
  targetRevision: number,
  ownerEntryId: string,
  ownerPath: string,
  after: Readonly<{ duration: unknown }>,
  durationState: unknown,
  now: number,
): Readonly<{
  timer: Checkpoint["timers"][number]
  message: MachineMessage
}> => {
  const resolved = Machine._durableRuntime.resolveDuration(after.duration, durationState)
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

const planRegionSlot = (
  instance: InstanceId,
  targetRevision: number,
  parent: Tagged,
  encodedParent: Json,
  node: RuntimeNode,
  slot: string,
  now: number,
): Omit<EntryWork, "rootEntryId"> => {
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
    const encodedLocal =
      typeof encodedParent === "object" && encodedParent !== null && !Array.isArray(encodedParent)
        ? ((encodedParent as Readonly<Record<string, Json>>)[slot] ?? asJson(tagged))
        : asJson(tagged)
    activities.push(
      activityCommand(
        instance,
        durableEntry,
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
    regionEntryIds: { [slot]: durableEntry },
    timers,
    aggregates: [],
    messages,
    activities,
  }
}

const planEntry = (
  nodes: ReadonlyMap<string, RuntimeNode>,
  instance: InstanceId,
  targetRevision: number,
  state: Tagged,
  encodedState: Json,
  now: number,
): EntryWork => {
  const node = nodes.get(state._tag)
  const rootEntry = deriveEntryId(instance, revision(targetRevision), state._tag)
  const timers: Array<Checkpoint["timers"][number]> = []
  const aggregates: Array<Checkpoint["aggregates"][number]> = []
  const messages: Array<MachineMessage> = []
  const activities: Array<ActivityCommand> = []
  const regionEntryIds: Record<string, string> = {}

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

  if (node?.kind === "regions") {
    for (const slot of Object.keys(node.regions ?? {})) {
      const planned = planRegionSlot(instance, targetRevision, state, encodedState, node, slot, now)
      Object.assign(regionEntryIds, planned.regionEntryIds)
      timers.push(...planned.timers)
      messages.push(...planned.messages)
      activities.push(...planned.activities)
    }
    if (node.onComplete !== undefined && Machine._durableRuntime.regionsComplete(node, state)) {
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
    regionEntryIds,
    timers,
    aggregates,
    messages,
    activities,
  }
}

const oldExecutionKeys = (
  nodes: ReadonlyMap<string, RuntimeNode>,
  instance: InstanceId,
  checkpoint: Checkpoint,
  state: Tagged,
): ReadonlyArray<ReturnType<typeof executionKey>> => {
  const node = nodes.get(state._tag)
  const keys: Array<ReturnType<typeof executionKey>> = []
  if (node?.kind === "invoke" && node.name !== undefined) {
    const lanes =
      node.workKind === "effect" || node.workKind === undefined
        ? [""]
        : Object.keys(node.tasks ?? {})
    for (const lane of lanes) {
      keys.push(
        deriveExecutionKey(instance, entryId(checkpoint.rootEntryId), state._tag, node.name, lane),
      )
    }
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
          deriveExecutionKey(
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
  defect: DurableDefectSummary | null = null,
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

const commitTransition = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  previousState: Tagged,
  nextState: Tagged,
  dispatch: MachineCommit["dispatch"],
): Effect.Effect<Checkpoint, DurableError, unknown> =>
  Effect.gen(function* () {
    const encoded = yield* encodeJson(definition.schemas.state, nextState, "encode state")
    if (!nodes.has(nextState._tag)) {
      return yield* new DurableEncodingError({
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
      : planEntry(
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
    yield* store.commitMachine({
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages: entry.messages,
      publishActivities: entry.activities,
      cancelMessageIds: delivery.checkpoint.timers.map((timer) => messageId(timer.messageId)),
      cancelExecutionKeys: oldExecutionKeys(
        nodes,
        delivery.checkpoint.instanceId as InstanceId,
        delivery.checkpoint,
        previousState,
      ),
      dispatch,
    })
    return checkpoint
  })

const commitPreservingEntry = (
  store: StoreService,
  delivery: MachineDelivery,
  encodedState: Json,
  dispatch: MachineCommit["dispatch"],
  aggregates = delivery.checkpoint.aggregates,
  publishActivities: ReadonlyArray<ActivityCommand> = [],
): Effect.Effect<Checkpoint, DurableError> =>
  Effect.gen(function* () {
    const checkpoint: Checkpoint = {
      ...delivery.checkpoint,
      revision: delivery.checkpoint.revision + 1,
      state: encodedState,
      aggregates,
    }
    yield* store.commitMachine({
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages: [],
      publishActivities,
      cancelMessageIds: [],
      cancelExecutionKeys: [],
      dispatch,
    })
    return checkpoint
  })

const commitDefect = (
  store: StoreService,
  delivery: MachineDelivery,
  defect: DurableDefectSummary,
): Effect.Effect<Checkpoint, DurableError> => {
  const checkpoint = makeCheckpoint(
    delivery.checkpoint,
    delivery.checkpoint.state,
    "defected",
    undefined,
    defect,
  )
  return store
    .commitMachine({
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages: [],
      publishActivities: [],
      cancelMessageIds: delivery.checkpoint.timers.map((timer) => messageId(timer.messageId)),
      cancelExecutionKeys: [],
      dispatch:
        delivery.message._tag === "External"
          ? dispatchFor(checkpoint, delivery.message, "rejected", defect.message)
          : undefined,
    })
    .pipe(Effect.as(checkpoint))
}

const activityOutcome = (
  schema: Schema.Top,
  channel: "Success" | "Failure",
  value: unknown,
): Effect.Effect<ActivityOutcome, never, unknown> =>
  encodeJson(schema, value, `encode activity ${channel.toLowerCase()}`).pipe(
    Effect.map((encoded) =>
      channel === "Success"
        ? ({ _tag: "Success", encodedValue: encoded } as const)
        : ({ _tag: "Failure", encodedError: encoded } as const),
    ),
    Effect.catchCause((cause) =>
      Effect.succeed({
        _tag: "Defect" as const,
        defect: defectSummary("encoding", Cause.squash(cause)),
      }),
    ),
  )

const findActivity = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  command: ActivityCommand,
  deliveryAttempt: number,
):
  | Readonly<{
      success: Schema.Top
      error: Schema.Top
      operation: Effect.Effect<unknown, unknown, unknown>
      retry?: Schedule.Schedule<unknown, unknown, unknown, unknown>
    }>
  | undefined => {
  const parts = command.ownerPath.split("/")
  const node = nodes.get(parts[0] ?? "")
  const metadata: Machine.WorkExecutionMetadata = {
    executionKey: command.executionKey,
    instanceId: command.instanceId,
    entryId: command.entryId,
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
      retry: invoke.retry?.schedule,
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
    retry: command.lane === "" ? node.retry?.schedule : undefined,
  }
}

const outcomeMessage = (
  command: ActivityCommand,
  outcome: ActivityOutcome,
  now: number,
): MachineMessage => ({
  _tag: "ActivityOutcome",
  messageId: deriveMessageId(
    command.instanceId as InstanceId,
    revision(0),
    command.ownerPath,
    `outcome:${command.executionKey}`,
  ),
  instanceId: command.instanceId,
  availableAtEpochMillis: now,
  executionKey: command.executionKey,
  entryId: command.entryId,
  ownerPath: command.ownerPath,
  invocation: command.invocation,
  lane: command.lane,
  outcome: asJson(outcome),
})

const runActivity = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  command: ActivityCommand,
  claimFence: number,
  claimAttempt: number,
  preserveCause: (cause: Cause.Cause<never>) => void,
): Effect.Effect<void, DurableError, unknown> =>
  Effect.gen(function* () {
    const located = findActivity(definition, nodes, command, claimAttempt)
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
      const operation =
        located.retry === undefined
          ? metadataOperation
          : Effect.retry(metadataOperation, located.retry)
      outcome = yield* Effect.matchCauseEffect(operation, {
        onFailure: (cause) => {
          const failure = Cause.findErrorOption(cause)
          return Option.isSome(failure)
            ? activityOutcome(located.error, "Failure", failure.value)
            : Effect.sync(() => {
                preserveCause(cause as Cause.Cause<never>)
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
    const message = outcomeMessage(command, outcome, now)
    yield* store.completeActivity(deliveryId(command.deliveryId), claimFence, message)
  })

const processActivityOutcome = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  state: Tagged,
  message: Extract<MachineMessage, { readonly _tag: "ActivityOutcome" }>,
): Effect.Effect<Checkpoint, DurableError, unknown> =>
  Effect.gen(function* () {
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
      return yield* commitDefect(store, delivery, encodedOutcome.defect as DurableDefectSummary)
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
      const nextLocal = Machine._durableRuntime.planRegionOutcome(
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

    if (node?.kind !== "invoke" || node.name !== message.invocation) {
      return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
    }
    const task = message.lane === "" ? node : node.tasks?.[message.lane]
    if (task?.success === undefined || task.error === undefined) {
      return yield* commitDefect(
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
      const planned = Machine._durableRuntime.planOutcome(
        succeeded ? node.onSuccess : node.onFailure,
        state,
        succeeded ? "success" : "failure",
        value,
      )
      if (planned === undefined) {
        return yield* commitDefect(
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
      const planned = Machine._durableRuntime.planOutcome(
        succeeded ? node.onSuccess : node.onFailure,
        state,
        succeeded ? "success" : "failure",
        workKind === "race" && succeeded ? { winner: message.lane, value } : value,
        workKind === "race" && succeeded,
      )
      if (planned === undefined) {
        return yield* commitDefect(
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
      const planned = Machine._durableRuntime.planOutcome(
        workKind === "all" ? node.onSuccess : node.onFailure,
        state,
        workKind === "all" ? "success" : "failure",
        aggregateValue,
      )
      if (planned === undefined) {
        return yield* commitDefect(
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
  })

const commitRegionUpdate = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
  previous: Tagged,
  next: Tagged,
  reenteredSlots: ReadonlySet<string>,
  dispatch?: MachineCommit["dispatch"],
): Effect.Effect<Checkpoint, DurableError, unknown> =>
  Effect.gen(function* () {
    const encoded = yield* encodeJson(definition.schemas.state, next, "encode region state")
    const node = nodes.get(next._tag)
    const now = yield* store.now
    const regionEntryIds = { ...delivery.checkpoint.regionEntryIds }
    const timers = delivery.checkpoint.timers.filter(
      (timer) =>
        ![...reenteredSlots].some((slot) => timer.ownerPath.startsWith(`${next._tag}/${slot}/`)),
    )
    const publishMessages: Array<MachineMessage> = []
    const publishActivities: Array<ActivityCommand> = []
    const cancelMessageIds = delivery.checkpoint.timers
      .filter((timer) => !timers.includes(timer))
      .map((timer) => messageId(timer.messageId))
    const cancelExecutionKeys: Array<ReturnType<typeof executionKey>> = []
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
            cancelExecutionKeys.push(
              deriveExecutionKey(
                delivery.checkpoint.instanceId as InstanceId,
                entryId(oldEntry),
                `${previous._tag}/${slot}/${(priorLocal as Tagged)._tag}`,
                invoke.name,
              ),
            )
          }
        }
        const planned = planRegionSlot(
          delivery.checkpoint.instanceId as InstanceId,
          delivery.checkpoint.revision + 1,
          next,
          encoded,
          node,
          slot,
          now,
        )
        Object.assign(regionEntryIds, planned.regionEntryIds)
        timers.push(...planned.timers)
        publishMessages.push(...planned.messages)
        publishActivities.push(...planned.activities)
      }
      if (node.onComplete !== undefined && Machine._durableRuntime.regionsComplete(node, next)) {
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
      regionEntryIds,
      timers,
    }
    yield* store.commitMachine({
      instanceId: delivery.checkpoint.instanceId as InstanceId,
      deliveryId: deliveryId(delivery.message.messageId),
      fence: delivery.claim.fence,
      expectedRevision: revision(delivery.checkpoint.revision),
      checkpoint,
      publishMessages,
      publishActivities,
      cancelMessageIds,
      cancelExecutionKeys,
      dispatch,
    })
    return checkpoint
  })

const processDelivery = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  store: StoreService,
  delivery: MachineDelivery,
): Effect.Effect<Checkpoint, DurableError, unknown> =>
  Effect.gen(function* () {
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
          return yield* commitPreservingEntry(store, delivery, delivery.checkpoint.state, undefined)
        }
        const planned = Machine._durableRuntime.planRegionAfter(
          regionNode.after,
          state,
          local as Tagged,
        )
        if (planned === undefined) {
          return yield* commitDefect(
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
      const planned = Machine._durableRuntime.planAfter(node.after, state)
      if (planned === undefined) {
        return yield* commitDefect(
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
        !Machine._durableRuntime.regionsComplete(node, state)
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
    if (node?.kind === "regions") {
      const regionPlan = Machine._durableRuntime.planRegionEvent(node, state, event)
      if (regionPlan !== undefined) {
        const next = regionPlan.next
        const nextEncoded = yield* encodeJson(definition.schemas.state, next, "encode region state")
        const result = yield* commitRegionUpdate(
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
        void nextEncoded
        return result
      }
    }
    const planned = Machine._durableRuntime.planEvent(node?.on?.[event._tag], state, event)
    if (planned === undefined) {
      return yield* commitDefect(
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
      const encoded = yield* encodeJson(definition.schemas.state, planned.next, "encode stay state")
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
    Effect.catchTag("DurableEncodingError", (error) =>
      commitDefect(store, delivery, defectSummary("encoding", error)),
    ),
  )

const initialize = (
  definition: DurableDefinition,
  nodes: ReadonlyMap<string, RuntimeNode>,
  input: unknown,
  options: RunOptions,
  store: StoreService,
): Effect.Effect<Checkpoint, DurableError, unknown> =>
  Effect.gen(function* () {
    const state = definition.initial(input as never)
    if (!nodes.has(state._tag)) {
      return yield* new DurableEncodingError({
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
      : planEntry(nodes, options.instanceId, 0, state, encoded, now)
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
    const created = yield* store.create({
      checkpoint,
      messages: entry.messages,
      activities: entry.activities,
    })
    if (created) return checkpoint
    const loaded = yield* store.load(options.instanceId)
    if (Option.isNone(loaded)) {
      return yield* new DurableEncodingError({
        operation: "create",
        message: "store reported an existing instance but it could not be loaded",
      })
    }
    return loaded.value
  })

const validateCompatibility = (
  definition: DurableDefinition,
  options: RunOptions,
  checkpoint: Checkpoint,
): Effect.Effect<void, CompatibilityError> => {
  if (
    checkpoint.formatVersion !== checkpointFormatVersion ||
    checkpoint.definitionId !== definition.id
  ) {
    return Effect.fail(
      new CompatibilityError({
        instanceId: options.instanceId,
        expected: persistenceVersion(`${definition.id}:format-${checkpointFormatVersion}`),
        actual: persistenceVersion(`${checkpoint.definitionId}:format-${checkpoint.formatVersion}`),
      }),
    )
  }
  if (checkpoint.persistenceVersion !== options.persistenceVersion) {
    return Effect.fail(
      new CompatibilityError({
        instanceId: options.instanceId,
        expected: options.persistenceVersion,
        actual: persistenceVersion(checkpoint.persistenceVersion),
      }),
    )
  }
  return Effect.void
}

const migrateCheckpoint = (
  definition: DurableDefinition,
  options: RunOptions,
  store: StoreService,
  checkpoint: Checkpoint,
): Effect.Effect<Checkpoint, DurableError, unknown> =>
  Effect.gen(function* () {
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
          expected: options.persistenceVersion,
          actual: current,
        })
      }
      document = yield* migration.migrate(document)
      document = yield* Schema.decodeUnknownEffect(MigrationDocument)(document).pipe(
        Effect.mapError(
          (error) =>
            new MigrationError({
              instanceId: options.instanceId,
              message: `migration ${migration.from} -> ${migration.to} returned an invalid document: ${String(error)}`,
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
          }),
      ),
    )
    yield* store.commitMigration(options.instanceId, revision(checkpoint.revision), migrated)
    return migratedCheckpoint
  })

/** Starts an absent durable instance or resumes its compatible checkpoint. */
export const run = <Definition extends DurableDefinition>(
  definition: Definition,
  input: Machine.MachineInput<Definition>,
  options: RunOptions,
): Effect.Effect<
  Handle<
    Machine.MachineState<Definition>,
    Machine.MachineEvent<Definition>,
    Machine.MachineCompletion<Definition>
  >,
  DurableError,
  | Scope.Scope
  | Store
  | Machine.MachineRequirements<Definition>
  | Definition["schemas"]["state"]["EncodingServices"]
  | Definition["schemas"]["state"]["DecodingServices"]
  | Definition["schemas"]["event"]["EncodingServices"]
  | Definition["schemas"]["event"]["DecodingServices"]
> =>
  Effect.gen(function* () {
    yield* validateDefinition(definition)
    const store = yield* Store
    const nodes = nodesOf(definition)
    const loaded = yield* store.load(options.instanceId)
    const loadedOrCreated = Option.isSome(loaded)
      ? loaded.value
      : yield* initialize(definition, nodes, input, options, store)
    if (
      loadedOrCreated.formatVersion !== checkpointFormatVersion ||
      loadedOrCreated.definitionId !== definition.id
    ) {
      yield* validateCompatibility(definition, options, loadedOrCreated)
    }
    const initialCheckpoint = yield* migrateCheckpoint(definition, options, store, loadedOrCreated)
    yield* validateCompatibility(definition, options, initialCheckpoint)
    const initialState = yield* decodeJson<Machine.MachineState<Definition>>(
      definition.schemas.state,
      initialCheckpoint.state,
      "decode checkpoint state",
    )
    const stateRef = yield* SubscriptionRef.make(initialState)
    const statusRef = yield* SubscriptionRef.make(initialCheckpoint.status)
    const completion = yield* Deferred.make<Machine.MachineCompletion<Definition>, DurableError>()
    let liveCause: Cause.Cause<never> | undefined

    const publishCheckpoint = (
      checkpoint: Checkpoint,
    ): Effect.Effect<void, DurableError, unknown> =>
      Effect.gen(function* () {
        const decoded = yield* decodeJson<Machine.MachineState<Definition>>(
          definition.schemas.state,
          checkpoint.state,
          "decode committed state",
        )
        yield* SubscriptionRef.set(stateRef, decoded)
        yield* SubscriptionRef.set(statusRef, checkpoint.status)
        if (checkpoint.status === "completed") {
          yield* Deferred.succeed(completion, decoded as Machine.MachineCompletion<Definition>)
        } else if (checkpoint.status === "defected") {
          yield* Deferred.fail(
            completion,
            new DurableInstanceDefect({
              instanceId: options.instanceId,
              defect:
                checkpoint.defect ??
                defectSummary("unknown", new Error("durable instance defected")),
              ...(liveCause === undefined ? {} : { cause: liveCause }),
            }),
          )
        }
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
        processDelivery(definition, nodes, store, claimed.value),
        renewal,
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

    const processActivityOnce = (activityWorker: string) =>
      Effect.gen(function* () {
        const claimed = yield* store.claimActivity(
          options.instanceId,
          activityWorker,
          activityLease,
        )
        if (Option.isNone(claimed)) return false
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
        yield* Effect.raceFirst(
          runActivity(
            definition,
            nodes,
            store,
            claimed.value.command,
            claimed.value.claim.fence,
            claimed.value.claim.attempt,
            (cause) => {
              liveCause = cause
            },
          ),
          renewal,
        )
        yield* drainMachine
        return true
      }).pipe(Effect.catchTag("LeaseLost", () => Effect.succeed(true)))

    const loop = (step: Effect.Effect<boolean, DurableError, unknown>) =>
      Effect.forever(
        step.pipe(
          Effect.flatMap((worked) =>
            worked ? Effect.yieldNow : Effect.sleep(options.pollIntervalMillis ?? idlePollMillis),
          ),
        ),
      )

    if (initialCheckpoint.status === "running") {
      const reportWorkerFailure = (cause: Cause.Cause<DurableError>) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.void
        const error = Cause.findErrorOption(cause)
        return Deferred.fail(
          completion,
          Option.isSome(error)
            ? error.value
            : new DurableInstanceDefect({
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

    const can = (event: Machine.MachineEvent<Definition>) =>
      Effect.gen(function* () {
        yield* sync
        const state = yield* SubscriptionRef.get(stateRef)
        const node = nodes.get((state as Tagged)._tag)
        if (node?.kind === "regions") {
          const region = Machine._durableRuntime.planRegionEvent(
            node,
            state as Tagged,
            event as Tagged,
          )
          if (region !== undefined) return true
        }
        return (
          Machine._durableRuntime.planEvent(
            node?.on?.[(event as Tagged)._tag],
            state as Tagged,
            event as Tagged,
          ) !== undefined
        )
      })

    const send = (
      event: Machine.MachineEvent<Definition>,
      sendOptions: Readonly<{ idempotencyKey: string }>,
    ) =>
      Effect.gen(function* () {
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
          return yield* new DurableInstanceDefect({
            instanceId: options.instanceId,
            defect: defect ?? defectSummary("protocol", new Error(result.reason)),
          })
        }
      })

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
