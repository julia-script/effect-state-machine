import type * as Protocol from "./Protocol.js"

/**
 * Folds a session's ordered facts into developer-sized semantic steps and
 * committed state positions. Pure: viewers feed facts in arrival order and
 * derive everything else (cursor, focus, rendering) themselves.
 */

export type Status = "running" | "completed" | "defected"

export type StepKind =
  | "machine"
  | "event"
  | "invocation"
  | "child"
  | "completion"
  | "defect"
  | "activity"

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

export interface SelectedBranch {
  readonly kind: "guard" | "otherwise"
  readonly index: number
  readonly name?: string
}

export interface Step {
  readonly index: number
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
  /** Indices into `facts` for the raw records folded into this step. */
  readonly raw: ReadonlyArray<number>
}

export interface Position {
  readonly index: number
  readonly stateTag: string
  /** The schema-encoded state committed at this position. */
  readonly state: unknown
}

export interface Model {
  readonly status: Status
  readonly positions: ReadonlyArray<Position>
  readonly steps: ReadonlyArray<Step>
  readonly facts: ReadonlyArray<Protocol.FactMessage>
  readonly truncatedFacts: number
  readonly encodingFailures: ReadonlyArray<Readonly<{ stateTag: string; message: string }>>
  readonly pendingStates: ReadonlyArray<Readonly<{ stateTag: string; state: unknown }>>
  readonly pendingCommits: ReadonlyArray<Readonly<{ step?: number }>>
  readonly activeEventStep?: number
  readonly pendingOutcomeStep?: number
  readonly invocations: ReadonlyMap<string, number>
  readonly children: ReadonlyMap<string, number>
}

export const initial: Model = {
  status: "running",
  positions: [],
  steps: [],
  facts: [],
  truncatedFacts: 0,
  encodingFailures: [],
  pendingStates: [],
  pendingCommits: [],
  invocations: new Map(),
  children: new Map(),
}

const stateTagOf = (state: unknown): string => {
  if (typeof state === "object" && state !== null && "_tag" in state) {
    const tag = (state as Readonly<{ _tag: unknown }>)._tag
    if (typeof tag === "string") return tag
  }
  return "unknown"
}

const invocationKey = (event: Readonly<{ invocation: string; generation: number }>): string =>
  `${event.invocation}:${event.generation}`

const appendStep = (model: Model, step: Omit<Step, "index">): readonly [Model, number] => {
  const index = model.steps.length
  return [{ ...model, steps: [...model.steps, { ...step, index }] }, index]
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

const statePositionHint = (model: Model): number =>
  Math.max(0, model.positions.length - 1) + model.pendingCommits.length

const reconcileCommits = (model: Model): Model => {
  let next = model
  while (next.pendingStates.length > 0 && next.pendingCommits.length > 0) {
    const pending = next.pendingStates[0]
    const commit = next.pendingCommits[0]
    const committedPosition = next.positions.length
    next = {
      ...next,
      positions: [
        ...next.positions,
        { index: committedPosition, stateTag: pending.stateTag, state: pending.state },
      ],
      pendingStates: next.pendingStates.slice(1),
      pendingCommits: next.pendingCommits.slice(1),
    }
    if (commit.step !== undefined) {
      next = updateStep(next, commit.step, (step) => ({
        ...step,
        statePosition: committedPosition,
        committedPosition,
      }))
    }
  }
  return next
}

const foldInspection = (
  model: Model,
  event: Protocol.InspectionEventMessage,
  factIndex: number,
): Model => {
  const at = statePositionHint(model)

  switch (event._tag) {
    case "MachineStarted": {
      if (model.steps.some((step) => step.kind === "machine")) return model
      const [withStep] = appendStep(model, {
        kind: "machine",
        title: `Started ${event.machineId}`,
        statePosition: 0,
        targetStateTag: event.initialStateTag,
        status: "started",
        raw: [factIndex],
      })
      return withStep
    }
    case "EventReceived": {
      const [withStep, step] = appendStep(model, {
        kind: "event",
        title: event.eventTag,
        statePosition: at,
        sourceStateTag: event.stateTag,
        eventTag: event.eventTag,
        ...("details" in event ? { eventPayload: event.details } : {}),
        status: "received",
        raw: [factIndex],
      })
      return { ...withStep, activeEventStep: step }
    }
    case "TransitionSelected": {
      if (model.activeEventStep === undefined) break
      return attachRaw(model, model.activeEventStep, factIndex, {
        targetStateTag: event.targetStateTag,
        status: "selected",
        ...(event.branch === undefined ? {} : { branch: event.branch }),
      })
    }
    case "EventIgnored": {
      if (model.activeEventStep === undefined) break
      return {
        ...attachRaw(model, model.activeEventStep, factIndex, { status: "ignored" }),
        activeEventStep: undefined,
      }
    }
    case "StateChanged": {
      let next = model
      const owner = next.activeEventStep ?? next.pendingOutcomeStep
      if (owner !== undefined) {
        next = attachRaw(next, owner, factIndex, {
          sourceStateTag: event.previousStateTag,
          targetStateTag: event.nextStateTag,
        })
      }
      return {
        ...next,
        pendingCommits: [
          ...next.pendingCommits,
          { ...(owner === undefined ? {} : { step: owner }) },
        ],
        activeEventStep: undefined,
        pendingOutcomeStep: undefined,
      }
    }
    case "InvocationStarted": {
      const [withStep, step] = appendStep(model, {
        kind: "invocation",
        title: event.invocation,
        statePosition: at,
        sourceStateTag: event.stateTag,
        invocation: event.invocation,
        generation: event.generation,
        status: "started",
        raw: [factIndex],
      })
      return {
        ...withStep,
        invocations: new Map(withStep.invocations).set(invocationKey(event), step),
      }
    }
    case "InvocationRetryScheduled": {
      const step = model.invocations.get(invocationKey(event))
      if (step === undefined) break
      return attachRaw(model, step, factIndex, {
        status: "retrying",
        attempt: event.attempt,
        delayMillis: event.delayMillis,
      })
    }
    case "InvocationSucceeded":
    case "InvocationFailed": {
      const step = model.invocations.get(invocationKey(event))
      if (step === undefined) break
      return {
        ...attachRaw(model, step, factIndex, {
          status: event._tag === "InvocationSucceeded" ? "succeeded" : "failed",
          ...(event.branch === undefined ? {} : { branch: event.branch }),
        }),
        pendingOutcomeStep: step,
      }
    }
    case "InvocationCancelled":
    case "InvocationDefected": {
      const step = model.invocations.get(invocationKey(event))
      if (step === undefined) break
      return attachRaw(model, step, factIndex, {
        status: event._tag === "InvocationCancelled" ? "cancelled" : "defected",
      })
    }
    case "ChildStarted": {
      const [withStep, step] = appendStep(model, {
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
      return { ...withStep, children: new Map(withStep.children).set(event.instanceId, step) }
    }
    case "ChildEventForwarded":
    case "ChildCompleted":
    case "ChildCancelled":
    case "ChildDefected": {
      const step = model.children.get(event.instanceId)
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
      return event._tag === "ChildCompleted" ? { ...updated, pendingOutcomeStep: step } : updated
    }
    case "MachineCompleted": {
      const [withStep] = appendStep(model, {
        kind: "completion",
        title: `Completed in ${event.finalStateTag}`,
        statePosition: at,
        targetStateTag: event.finalStateTag,
        status: "completed",
        raw: [factIndex],
      })
      return { ...withStep, status: "completed" }
    }
    case "MachineDefected": {
      if (model.activeEventStep !== undefined) {
        return {
          ...attachRaw(model, model.activeEventStep, factIndex, { status: "defected" }),
          activeEventStep: undefined,
          status: "defected",
        }
      }
      const [withStep] = appendStep(model, {
        kind: "defect",
        title: `Defected on ${event.eventTag}`,
        statePosition: at,
        sourceStateTag: event.stateTag,
        eventTag: event.eventTag,
        status: "defected",
        raw: [factIndex],
      })
      return { ...withStep, status: "defected" }
    }
  }

  const [withStep] = appendStep(model, {
    kind: "activity",
    title: event._tag,
    statePosition: at,
    raw: [factIndex],
  })
  return withStep
}

/** Feeds one fact into the model, in arrival order. */
export const reduce = (model: Model, fact: Protocol.FactMessage): Model => {
  const factIndex = model.facts.length
  const next: Model = { ...model, facts: [...model.facts, fact] }
  const body = fact.body

  switch (body._tag) {
    case "Inspection":
      return reconcileCommits(foldInspection(next, body.event, factIndex))
    case "StateCommitted": {
      const pending = { stateTag: stateTagOf(body.state), state: body.state }
      if (next.positions.length === 0 && next.pendingCommits.length === 0) {
        return {
          ...next,
          positions: [{ index: 0, stateTag: pending.stateTag, state: pending.state }],
        }
      }
      return reconcileCommits({ ...next, pendingStates: [...next.pendingStates, pending] })
    }
    case "StateEncodingFailed":
      return {
        ...next,
        encodingFailures: [
          ...next.encodingFailures,
          { stateTag: body.stateTag, message: body.message },
        ],
      }
    case "StatusChanged":
      return { ...next, status: body.status }
    case "HistoryTruncated":
      return { ...next, truncatedFacts: next.truncatedFacts + body.dropped }
  }
}

/** Folds an already-ordered fact log, e.g. a server replay. */
export const fromFacts = (facts: Iterable<Protocol.FactMessage>): Model => {
  let model = initial
  for (const fact of facts) model = reduce(model, fact)
  return model
}
