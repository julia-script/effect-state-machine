import type * as Protocol from "./Protocol.js"

/** @category models @since 0.1.0 */
export type Status = "running" | "completed" | "defected"

/** @category models @since 0.2.0 */
export type ActorStatus = "running" | "completed" | "cancelled" | "defected"

/** @category models @since 0.1.0 */
export type StepKind =
  | "machine"
  | "event"
  | "invocation"
  | "child"
  | "completion"
  | "defect"
  | "activity"

/** @category models @since 0.1.0 */
export type StepStatus =
  | "received"
  | "selected"
  | "ignored"
  | "started"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "completed"
  | "defected"

/** @category models @since 0.1.0 */
export interface SelectedBranch {
  readonly kind: "guard" | "otherwise"
  readonly index: number
  readonly name?: string
}

/** Developer-sized semantic action derived from one or more actor-qualified facts. */
export interface Step {
  readonly index: number
  readonly sequence: number
  readonly actorId: string
  readonly definitionPath: string
  readonly depth: number
  readonly kind: StepKind
  readonly title: string
  readonly statePosition: number
  readonly committedPosition?: number
  readonly sourceStateTag?: string
  readonly targetStateTag?: string
  readonly eventTag?: string
  readonly eventPayload?: unknown
  readonly invocation?: string
  readonly generation?: number
  readonly instanceId?: string
  readonly status?: StepStatus
  readonly attempt?: number
  readonly delayMillis?: number
  readonly branch?: SelectedBranch
  readonly raw: ReadonlyArray<number>
}

/** One schema-encoded state committed by one actor in session history. */
export interface Position {
  readonly index: number
  readonly sequence: number
  readonly actorId: string
  readonly definitionPath: string
  readonly stateTag: string
  readonly state: unknown
  readonly previousActorPosition?: number
}

/** Runtime actor lifecycle and its actor-local position index. */
export interface Actor {
  readonly actorId: string
  readonly definitionPath: string
  readonly machineId: string
  readonly parentActorId?: string
  readonly ownerStateTag?: string
  readonly invocation?: string
  readonly instanceId?: string
  readonly depth: number
  readonly startedAt: number
  readonly endedAt?: number
  readonly status: ActorStatus
  readonly positions: ReadonlyArray<number>
}

interface ActorFold {
  readonly activeEventStep?: number
  readonly pendingOutcomeStep?: number
  readonly pendingCommitStep?: number
  readonly invocations: ReadonlyMap<string, number>
  readonly children: ReadonlyMap<string, number>
}

const emptyActorFold = (): ActorFold => ({ invocations: new Map(), children: new Map() })

/** Pure projection of one root session's ordered fact log. */
export interface Model {
  readonly status: Status
  readonly rootActorId?: string
  readonly actors: ReadonlyMap<string, Actor>
  readonly positions: ReadonlyArray<Position>
  readonly steps: ReadonlyArray<Step>
  readonly facts: ReadonlyArray<Protocol.FactMessage>
  readonly truncatedFacts: number
  readonly truncatedRange?: Readonly<{ fromSequence: number; toSequence: number }>
  readonly encodingFailures: ReadonlyArray<
    Readonly<{
      actorId: string
      definitionPath: string
      stateTag: string
      message: string
    }>
  >
  readonly actorFolds: ReadonlyMap<string, ActorFold>
}

/** Empty running history model used to begin an incremental fold. */
export const initial: Model = {
  status: "running",
  actors: new Map(),
  positions: [],
  steps: [],
  facts: [],
  truncatedFacts: 0,
  encodingFailures: [],
  actorFolds: new Map(),
}

const stateTagOf = (state: unknown): string => {
  if (typeof state === "object" && state !== null && "_tag" in state) {
    const tag = state._tag
    if (typeof tag === "string") return tag
  }
  return "unknown"
}

const ensureActor = (model: Model, fact: Protocol.FactMessage): Model => {
  if (model.actors.has(fact.actorId)) return model
  const actor: Actor = {
    actorId: fact.actorId,
    definitionPath: fact.definitionPath,
    machineId: "unknown",
    depth: 0,
    startedAt: fact.sequence,
    status: "running",
    positions: [],
  }
  return {
    ...model,
    rootActorId: model.rootActorId ?? fact.actorId,
    actors: new Map(model.actors).set(fact.actorId, actor),
    actorFolds: new Map(model.actorFolds).set(fact.actorId, emptyActorFold()),
  }
}

const updateActor = (model: Model, actorId: string, update: (actor: Actor) => Actor): Model => {
  const actor = model.actors.get(actorId)
  if (actor === undefined) return model
  return { ...model, actors: new Map(model.actors).set(actorId, update(actor)) }
}

const actorFold = (model: Model, actorId: string): ActorFold =>
  model.actorFolds.get(actorId) ?? emptyActorFold()

const updateActorFold = (
  model: Model,
  actorId: string,
  update: (fold: ActorFold) => ActorFold,
): Model => ({
  ...model,
  actorFolds: new Map(model.actorFolds).set(actorId, update(actorFold(model, actorId))),
})

const latestActorPosition = (model: Model, actorId: string): number => {
  const indices = model.actors.get(actorId)?.positions ?? []
  return indices[indices.length - 1] ?? 0
}

const invocationKey = (event: Readonly<{ invocation: string; generation: number }>): string =>
  `${event.invocation}:${event.generation}`

type StepInput = Omit<Step, "index" | "sequence" | "actorId" | "definitionPath" | "depth">

const appendStep = (
  model: Model,
  fact: Protocol.FactMessage,
  step: StepInput,
): readonly [Model, number] => {
  const index = model.steps.length
  const actor = model.actors.get(fact.actorId)
  return [
    {
      ...model,
      steps: [
        ...model.steps,
        {
          ...step,
          index,
          sequence: fact.sequence,
          actorId: fact.actorId,
          definitionPath: fact.definitionPath,
          depth: actor?.depth ?? 0,
        },
      ],
    },
    index,
  ]
}

const updateStep = (model: Model, index: number, update: (step: Step) => Step): Model => ({
  ...model,
  steps: model.steps.map((step, candidate) => (candidate === index ? update(step) : step)),
})

const attachRaw = (
  model: Model,
  index: number,
  factIndex: number,
  fields: Partial<Step> = {},
): Model =>
  updateStep(model, index, (step) => ({
    ...step,
    ...fields,
    raw: [...step.raw, factIndex],
  }))

const foldInspection = (
  model: Model,
  fact: Protocol.FactMessage,
  event: Protocol.InspectionEventMessage,
  factIndex: number,
): Model => {
  const at = latestActorPosition(model, fact.actorId)
  const fold = actorFold(model, fact.actorId)

  switch (event._tag) {
    case "MachineStarted": {
      const existing = model.steps.some(
        (step) => step.actorId === fact.actorId && step.kind === "machine",
      )
      if (existing) return model
      const [withStep, step] = appendStep(model, fact, {
        kind: "machine",
        title: `Started ${event.machineId}`,
        statePosition: at,
        targetStateTag: event.initialStateTag,
        status: "started",
        raw: [factIndex],
      })
      const withMachine = updateActor(withStep, fact.actorId, (actor) => ({
        ...actor,
        machineId: event.machineId,
      }))
      return updateActorFold(withMachine, fact.actorId, (current) => ({
        ...current,
        pendingCommitStep: step,
      }))
    }
    case "EventReceived": {
      const [withStep, step] = appendStep(model, fact, {
        kind: "event",
        title: event.eventTag,
        statePosition: at,
        sourceStateTag: event.stateTag,
        eventTag: event.eventTag,
        ...("details" in event ? { eventPayload: event.details } : {}),
        status: "received",
        raw: [factIndex],
      })
      return updateActorFold(withStep, fact.actorId, (current) => ({
        ...current,
        activeEventStep: step,
      }))
    }
    case "TransitionSelected": {
      if (fold.activeEventStep === undefined) break
      return attachRaw(model, fold.activeEventStep, factIndex, {
        targetStateTag: event.targetStateTag,
        status: "selected",
        ...(event.branch === undefined ? {} : { branch: event.branch }),
      })
    }
    case "EventIgnored": {
      if (fold.activeEventStep === undefined) break
      const updated = attachRaw(model, fold.activeEventStep, factIndex, { status: "ignored" })
      return updateActorFold(updated, fact.actorId, (current) => ({
        ...current,
        activeEventStep: undefined,
      }))
    }
    case "StateChanged": {
      const owner = fold.activeEventStep ?? fold.pendingOutcomeStep
      const updated =
        owner === undefined
          ? model
          : attachRaw(model, owner, factIndex, {
              sourceStateTag: event.previousStateTag,
              targetStateTag: event.nextStateTag,
            })
      return updateActorFold(updated, fact.actorId, (current) => ({
        ...current,
        pendingCommitStep: owner,
        activeEventStep: undefined,
        pendingOutcomeStep: undefined,
      }))
    }
    case "InvocationStarted": {
      const [withStep, step] = appendStep(model, fact, {
        kind: "invocation",
        title: event.invocation,
        statePosition: at,
        sourceStateTag: event.stateTag,
        invocation: event.invocation,
        generation: event.generation,
        status: "started",
        raw: [factIndex],
      })
      return updateActorFold(withStep, fact.actorId, (current) => ({
        ...current,
        invocations: new Map(current.invocations).set(invocationKey(event), step),
      }))
    }
    case "InvocationRetryScheduled": {
      const step = fold.invocations.get(invocationKey(event))
      if (step === undefined) break
      return attachRaw(model, step, factIndex, {
        status: "retrying",
        attempt: event.attempt,
        delayMillis: event.delayMillis,
      })
    }
    case "InvocationSucceeded":
    case "InvocationFailed": {
      const step = fold.invocations.get(invocationKey(event))
      if (step === undefined) break
      const updated = attachRaw(model, step, factIndex, {
        status: event._tag === "InvocationSucceeded" ? "succeeded" : "failed",
        ...(event.branch === undefined ? {} : { branch: event.branch }),
      })
      return updateActorFold(updated, fact.actorId, (current) => ({
        ...current,
        pendingOutcomeStep: step,
      }))
    }
    case "InvocationCancelled":
    case "InvocationDefected": {
      const step = fold.invocations.get(invocationKey(event))
      if (step === undefined) break
      return attachRaw(model, step, factIndex, {
        status: event._tag === "InvocationCancelled" ? "cancelled" : "defected",
      })
    }
    case "ChildStarted": {
      const [withStep, step] = appendStep(model, fact, {
        kind: "child",
        title: event.invocation,
        statePosition: at,
        sourceStateTag: event.stateTag,
        invocation: event.invocation,
        generation: event.generation,
        instanceId: event.instanceId,
        status: "started",
        raw: [factIndex],
      })
      return updateActorFold(withStep, fact.actorId, (current) => ({
        ...current,
        children: new Map(current.children).set(event.instanceId, step),
      }))
    }
    case "ChildEventForwarded":
    case "ChildCompleted":
    case "ChildCancelled":
    case "ChildDefected": {
      const step = fold.children.get(event.instanceId)
      if (step === undefined) break
      const status =
        event._tag === "ChildCompleted"
          ? "completed"
          : event._tag === "ChildCancelled"
            ? "cancelled"
            : event._tag === "ChildDefected"
              ? "defected"
              : undefined
      const updated = attachRaw(model, step, factIndex, {
        ...(status === undefined ? {} : { status }),
        ...(event._tag === "ChildCompleted" && event.branch !== undefined
          ? { branch: event.branch }
          : {}),
      })
      return event._tag === "ChildCompleted"
        ? updateActorFold(updated, fact.actorId, (current) => ({
            ...current,
            pendingOutcomeStep: step,
          }))
        : updated
    }
    case "MachineCompleted": {
      const [withStep] = appendStep(model, fact, {
        kind: "completion",
        title: `Completed in ${event.finalStateTag}`,
        statePosition: at,
        targetStateTag: event.finalStateTag,
        status: "completed",
        raw: [factIndex],
      })
      return withStep
    }
    case "MachineDefected": {
      if (fold.activeEventStep !== undefined) {
        const updated = attachRaw(model, fold.activeEventStep, factIndex, { status: "defected" })
        return updateActorFold(updated, fact.actorId, (current) => ({
          ...current,
          activeEventStep: undefined,
        }))
      }
      const [withStep] = appendStep(model, fact, {
        kind: "defect",
        title: `Defected on ${event.eventTag}`,
        statePosition: at,
        sourceStateTag: event.stateTag,
        eventTag: event.eventTag,
        status: "defected",
        raw: [factIndex],
      })
      return withStep
    }
  }

  const [withStep] = appendStep(model, fact, {
    kind: "activity",
    title: event._tag,
    statePosition: at,
    raw: [factIndex],
  })
  return withStep
}

const foldActorStarted = (
  model: Model,
  fact: Protocol.FactMessage,
  body: Extract<Protocol.FactBodyMessage, { _tag: "ActorStarted" }>,
): Model => {
  const parent = body.parentActorId === undefined ? undefined : model.actors.get(body.parentActorId)
  const actor: Actor = {
    actorId: fact.actorId,
    definitionPath: fact.definitionPath,
    machineId: body.machineId,
    ...(body.parentActorId === undefined ? {} : { parentActorId: body.parentActorId }),
    ...(body.ownerStateTag === undefined ? {} : { ownerStateTag: body.ownerStateTag }),
    ...(body.invocation === undefined ? {} : { invocation: body.invocation }),
    ...(body.instanceId === undefined ? {} : { instanceId: body.instanceId }),
    depth: parent === undefined ? 0 : parent.depth + 1,
    startedAt: fact.sequence,
    status: "running",
    positions: [],
  }
  return {
    ...model,
    rootActorId: body.parentActorId === undefined ? fact.actorId : model.rootActorId,
    actors: new Map(model.actors).set(fact.actorId, actor),
    actorFolds: new Map(model.actorFolds).set(fact.actorId, emptyActorFold()),
  }
}

const foldState = (
  model: Model,
  fact: Protocol.FactMessage,
  state: unknown,
): Model => {
  const actor = model.actors.get(fact.actorId)
  if (actor === undefined) return model
  const index = model.positions.length
  const previousActorPosition = actor.positions[actor.positions.length - 1]
  const position: Position = {
    index,
    sequence: fact.sequence,
    actorId: fact.actorId,
    definitionPath: fact.definitionPath,
    stateTag: stateTagOf(state),
    state,
    ...(previousActorPosition === undefined ? {} : { previousActorPosition }),
  }
  let next: Model = {
    ...model,
    positions: [...model.positions, position],
    actors: new Map(model.actors).set(fact.actorId, {
      ...actor,
      positions: [...actor.positions, index],
    }),
  }
  const fold = actorFold(next, fact.actorId)
  if (fold.pendingCommitStep !== undefined) {
    next = updateStep(next, fold.pendingCommitStep, (step) => ({
      ...step,
      statePosition: index,
      committedPosition: index,
    }))
  }
  return updateActorFold(next, fact.actorId, (current) => ({
    ...current,
    pendingCommitStep: undefined,
  }))
}

const foldActorTerminated = (
  model: Model,
  fact: Protocol.FactMessage,
  status: Exclude<ActorStatus, "running">,
  factIndex: number,
): Model => {
  let next = updateActor(model, fact.actorId, (actor) => ({
    ...actor,
    status,
    endedAt: fact.sequence,
  }))
  if (fact.actorId === next.rootActorId) {
    next = { ...next, status: status === "completed" ? "completed" : "defected" }
  }
  let terminalStep: Step | undefined
  for (let index = next.steps.length - 1; index >= 0; index -= 1) {
    const candidate = next.steps[index]
    if (candidate?.actorId === fact.actorId && candidate.status === status) {
      terminalStep = candidate
      break
    }
  }
  if (terminalStep !== undefined) return attachRaw(next, terminalStep.index, factIndex)
  const [withStep] = appendStep(next, fact, {
    kind: status === "defected" ? "defect" : status === "completed" ? "completion" : "activity",
    title: `${status === "cancelled" ? "Cancelled" : status === "defected" ? "Defected" : "Completed"} ${next.actors.get(fact.actorId)?.machineId ?? "machine"}`,
    statePosition: latestActorPosition(next, fact.actorId),
    status,
    raw: [factIndex],
  })
  return withStep
}

/** Folds one actor-qualified fact into an existing history model. */
export const reduce = (model: Model, fact: Protocol.FactMessage): Model => {
  const factIndex = model.facts.length
  let next = ensureActor({ ...model, facts: [...model.facts, fact] }, fact)
  const body = fact.body

  switch (body._tag) {
    case "ActorStarted":
      return foldActorStarted(next, fact, body)
    case "Inspection":
      return foldInspection(next, fact, body.event, factIndex)
    case "StateCommitted":
      return foldState(next, fact, body.state)
    case "ActorTerminated":
      return foldActorTerminated(next, fact, body.status, factIndex)
    case "StateEncodingFailed":
      return {
        ...next,
        encodingFailures: [
          ...next.encodingFailures,
          {
            actorId: fact.actorId,
            definitionPath: fact.definitionPath,
            stateTag: body.stateTag,
            message: body.message,
          },
        ],
      }
    case "StatusChanged":
      return { ...next, status: body.status }
    case "HistoryTruncated":
      return {
        ...next,
        truncatedFacts: next.truncatedFacts + body.dropped,
        truncatedRange: {
          fromSequence: next.truncatedRange?.fromSequence ?? body.fromSequence,
          toSequence: body.toSequence,
        },
      }
  }
}

/** Folds an already ordered root-session fact log into a new history model. */
export const fromFacts = (facts: Iterable<Protocol.FactMessage>): Model => {
  let model = initial
  for (const fact of facts) model = reduce(model, fact)
  return model
}

/** Returns actors that exist at a global session sequence. */
export const actorsAt = (model: Model, sequence: number): ReadonlyArray<Actor> =>
  Array.from(model.actors.values()).filter(
    (actor) => actor.startedAt <= sequence && (actor.endedAt === undefined || sequence < actor.endedAt),
  )

/** Returns an actor's latest state at or before a global session sequence. */
export const positionAt = (
  model: Model,
  actorId: string,
  sequence: number,
): Position | undefined => {
  const indices = model.actors.get(actorId)?.positions ?? []
  for (let offset = indices.length - 1; offset >= 0; offset -= 1) {
    const index = indices[offset]
    if (index === undefined) continue
    const position = model.positions[index]
    if (position !== undefined && position.sequence <= sequence) return position
  }
  return undefined
}

/** Returns the prior committed state for the same actor as a position. */
export const previousPosition = (model: Model, position: Position): Position | undefined =>
  position.previousActorPosition === undefined
    ? undefined
    : model.positions[position.previousActorPosition]
