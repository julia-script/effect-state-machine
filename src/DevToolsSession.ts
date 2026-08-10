import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Graph from "./Graph.js"
import type * as Machine from "./Machine.js"

interface Tagged {
  readonly _tag: string
}

export type SessionStatus = "running" | "completed" | "defected"

export interface StateMetadata<Details> {
  readonly tag: string
  readonly title: string
  readonly kind: Graph.Node["kind"]
  readonly description?: string
  readonly details?: Details
}

export interface SessionPosition<Details> {
  readonly position: number
  readonly state: StateMetadata<Details>
}

export interface RawInspectionRecord {
  readonly index: number
  readonly event: Machine.InspectionEvent
}

export type SemanticStepKind =
  | "machine"
  | "event"
  | "invocation"
  | "child"
  | "completion"
  | "defect"
  | "activity"

export interface SemanticStep {
  readonly index: number
  readonly kind: SemanticStepKind
  readonly title: string
  readonly statePosition: number
  readonly committedPosition?: number
  readonly sourceStateTag?: string
  readonly targetStateTag?: string
  readonly eventTag?: string
  readonly invocation?: string
  readonly generation?: number
  readonly instanceId?: string
  readonly status?:
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
  readonly attempt?: number
  readonly delayMillis?: number
  readonly branch?: Machine.SelectedBranch
  readonly raw: ReadonlyArray<number>
}

export interface SessionHistory {
  readonly semantic: ReadonlyArray<SemanticStep>
  readonly raw: ReadonlyArray<RawInspectionRecord>
}

export interface SessionView<Details = never> {
  readonly machine: Readonly<{
    id: string
    description?: string
  }>
  readonly graph: Graph.Graph
  readonly status: SessionStatus
  readonly liveHead: number
  readonly cursor: number
  readonly isLive: boolean
  readonly selected: SessionPosition<Details>
  readonly positions: ReadonlyArray<SessionPosition<Details>>
  readonly history: SessionHistory
}

export interface Session<Details = never> {
  readonly view: Effect.Effect<SessionView<Details>>
  readonly changes: Stream.Stream<SessionView<Details>>
}

export interface AttachOptions<State extends Tagged, Event extends Tagged, Details = never> {
  readonly definition: Machine.DefinitionMetadata
  readonly handle: Machine.MachineHandle<State, Event, State>
  readonly projectState?: (state: State) => Details
}

interface InternalPosition<State extends Tagged, Details> {
  readonly state: State
  readonly view: SessionPosition<Details>
}

interface SessionModel<State extends Tagged, Details> {
  readonly status: SessionStatus
  readonly positions: ReadonlyArray<InternalPosition<State, Details>>
  readonly pendingStates: ReadonlyArray<State>
  readonly pendingCommits: ReadonlyArray<Readonly<{ step?: number }>>
  readonly raw: ReadonlyArray<RawInspectionRecord>
  readonly semantic: ReadonlyArray<SemanticStep>
  readonly activeEventStep?: number
  readonly pendingOutcomeStep?: number
  readonly invocations: Readonly<Record<string, number>>
  readonly children: Readonly<Record<string, number>>
}

const freeze = <Value extends object>(value: Value): Readonly<Value> => Object.freeze(value)

const invocationKey = (event: {
  readonly invocation: string
  readonly generation: number
}): string => `${event.invocation}:${event.generation}`

const appendStep = <State extends Tagged, Details>(
  model: SessionModel<State, Details>,
  step: Omit<SemanticStep, "index">,
): readonly [SessionModel<State, Details>, number] => {
  const index = model.semantic.length
  return [
    {
      ...model,
      semantic: [...model.semantic, freeze({ ...step, index })],
    },
    index,
  ]
}

const updateStep = <State extends Tagged, Details>(
  model: SessionModel<State, Details>,
  index: number,
  update: (step: SemanticStep) => SemanticStep,
): SessionModel<State, Details> => ({
  ...model,
  semantic: model.semantic.map((step, candidate) =>
    candidate === index ? freeze(update(step)) : step,
  ),
})

const attachRaw = <State extends Tagged, Details>(
  model: SessionModel<State, Details>,
  index: number,
  rawIndex: number,
  fields: Partial<SemanticStep> = {},
): SessionModel<State, Details> =>
  updateStep(model, index, (step) => ({
    ...step,
    ...fields,
    raw: [...step.raw, rawIndex],
  }))

const statePositionHint = <State extends Tagged, Details>(
  model: SessionModel<State, Details>,
): number => model.positions.length - 1 + model.pendingCommits.length

const reconcileCommits = <State extends Tagged, Details>(
  graph: Graph.Graph,
  projectState: ((state: State) => Details) | undefined,
  model: SessionModel<State, Details>,
): SessionModel<State, Details> => {
  let next = model
  while (next.pendingStates.length > 0 && next.pendingCommits.length > 0) {
    const state = next.pendingStates[0]
    const commit = next.pendingCommits[0]
    const committedPosition = next.positions.length
    next = {
      ...next,
      positions: [...next.positions, position(graph, state, committedPosition, projectState)],
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

const appendInspection = <State extends Tagged, Details>(
  model: SessionModel<State, Details>,
  event: Machine.InspectionEvent,
): SessionModel<State, Details> => {
  const rawIndex = model.raw.length
  let next: SessionModel<State, Details> = {
    ...model,
    raw: [...model.raw, freeze({ index: rawIndex, event })],
  }
  const at = statePositionHint(next)

  switch (event._tag) {
    case "MachineStarted": {
      if (next.semantic.some((step) => step.kind === "machine")) return next
      const [withStep] = appendStep(next, {
        kind: "machine",
        title: `Started ${event.machineId}`,
        statePosition: 0,
        targetStateTag: event.initialStateTag,
        status: "started",
        raw: [rawIndex],
      })
      return withStep
    }
    case "EventReceived": {
      const [withStep, step] = appendStep(next, {
        kind: "event",
        title: event.eventTag,
        statePosition: at,
        sourceStateTag: event.stateTag,
        eventTag: event.eventTag,
        status: "received",
        raw: [rawIndex],
      })
      return { ...withStep, activeEventStep: step }
    }
    case "TransitionSelected": {
      if (next.activeEventStep === undefined) break
      return attachRaw(next, next.activeEventStep, rawIndex, {
        targetStateTag: event.targetStateTag,
        status: "selected",
        ...(event.branch === undefined ? {} : { branch: event.branch }),
      })
    }
    case "EventIgnored": {
      if (next.activeEventStep === undefined) break
      return {
        ...attachRaw(next, next.activeEventStep, rawIndex, { status: "ignored" }),
        activeEventStep: undefined,
      }
    }
    case "StateChanged": {
      const owner = next.activeEventStep ?? next.pendingOutcomeStep
      if (owner !== undefined) {
        next = attachRaw(next, owner, rawIndex, {
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
      const [withStep, step] = appendStep(next, {
        kind: "invocation",
        title: event.invocation,
        statePosition: at,
        sourceStateTag: event.stateTag,
        invocation: event.invocation,
        generation: event.generation,
        status: "started",
        raw: [rawIndex],
      })
      return {
        ...withStep,
        invocations: { ...withStep.invocations, [invocationKey(event)]: step },
      }
    }
    case "InvocationRetryScheduled": {
      const step = next.invocations[invocationKey(event)]
      if (step === undefined) break
      return attachRaw(next, step, rawIndex, {
        status: "retrying",
        attempt: event.attempt,
        delayMillis: event.delayMillis,
      })
    }
    case "InvocationSucceeded":
    case "InvocationFailed": {
      const step = next.invocations[invocationKey(event)]
      if (step === undefined) break
      return {
        ...attachRaw(next, step, rawIndex, {
          status: event._tag === "InvocationSucceeded" ? "succeeded" : "failed",
          ...(event.branch === undefined ? {} : { branch: event.branch }),
        }),
        pendingOutcomeStep: step,
      }
    }
    case "InvocationCancelled":
    case "InvocationDefected": {
      const step = next.invocations[invocationKey(event)]
      if (step === undefined) break
      return attachRaw(next, step, rawIndex, {
        status: event._tag === "InvocationCancelled" ? "cancelled" : "defected",
      })
    }
    case "ChildStarted": {
      const [withStep, step] = appendStep(next, {
        kind: "child",
        title: event.invocation,
        statePosition: at,
        sourceStateTag: event.stateTag,
        invocation: event.invocation,
        generation: event.generation,
        instanceId: event.instanceId,
        status: "started",
        raw: [rawIndex],
      })
      return { ...withStep, children: { ...withStep.children, [event.instanceId]: step } }
    }
    case "ChildEventForwarded":
    case "ChildCompleted":
    case "ChildCancelled":
    case "ChildDefected": {
      const step = next.children[event.instanceId]
      if (step === undefined) break
      const status =
        event._tag === "ChildCompleted"
          ? "completed"
          : event._tag === "ChildCancelled"
            ? "cancelled"
            : event._tag === "ChildDefected"
              ? "defected"
              : undefined
      const updated = attachRaw(next, step, rawIndex, {
        ...(status === undefined ? {} : { status }),
        ...(event._tag === "ChildCompleted" && event.branch !== undefined
          ? { branch: event.branch }
          : {}),
      })
      return event._tag === "ChildCompleted" ? { ...updated, pendingOutcomeStep: step } : updated
    }
    case "MachineCompleted": {
      const [withStep] = appendStep(next, {
        kind: "completion",
        title: `Completed in ${event.finalStateTag}`,
        statePosition: at,
        targetStateTag: event.finalStateTag,
        status: "completed",
        raw: [rawIndex],
      })
      return { ...withStep, status: "completed" }
    }
    case "MachineDefected": {
      if (next.activeEventStep !== undefined) {
        return {
          ...attachRaw(next, next.activeEventStep, rawIndex, { status: "defected" }),
          activeEventStep: undefined,
          status: "defected",
        }
      }
      const [withStep] = appendStep(next, {
        kind: "defect",
        title: `Defected on ${event.eventTag}`,
        statePosition: at,
        sourceStateTag: event.stateTag,
        eventTag: event.eventTag,
        status: "defected",
        raw: [rawIndex],
      })
      return { ...withStep, status: "defected" }
    }
  }

  const [withStep] = appendStep(next, {
    kind: "activity",
    title: event._tag,
    statePosition: at,
    raw: [rawIndex],
  })
  return withStep
}

const stateMetadata = <State extends Tagged, Details>(
  graph: Graph.Graph,
  state: State,
  projectState: ((state: State) => Details) | undefined,
): StateMetadata<Details> => {
  const node = graph.nodes.find((candidate) => candidate.id === state._tag)
  const details = projectState?.(state)
  return freeze({
    tag: state._tag,
    title: node?.title ?? state._tag,
    kind: node?.kind ?? "state",
    ...(node?.description === undefined ? {} : { description: node.description }),
    ...(projectState === undefined ? {} : { details: details as Details }),
  })
}

const position = <State extends Tagged, Details>(
  graph: Graph.Graph,
  state: State,
  index: number,
  projectState: ((state: State) => Details) | undefined,
): InternalPosition<State, Details> => ({
  state,
  view: freeze({
    position: index,
    state: stateMetadata(graph, state, projectState),
  }),
})

const toView = <State extends Tagged, Details>(
  definition: Machine.DefinitionMetadata,
  graph: Graph.Graph,
  model: SessionModel<State, Details>,
): SessionView<Details> => {
  const positions = freeze(model.positions.map((entry) => entry.view))
  const liveHead = positions.length - 1
  return freeze({
    machine: freeze({
      id: definition.id,
      ...(definition.description === undefined ? {} : { description: definition.description }),
    }),
    graph,
    status: model.status,
    liveHead,
    cursor: liveHead,
    isLive: true,
    selected: positions[liveHead],
    positions,
    history: freeze({
      semantic: freeze([...model.semantic]),
      raw: freeze([...model.raw]),
    }),
  })
}

/**
 * Observes an externally owned running machine for the lifetime of the current Scope.
 * Closing the Scope releases only the session fibers; it never interrupts the machine.
 */
export const attach = <State extends Tagged, Event extends Tagged, Details = never>(
  options: AttachOptions<State, Event, Details>,
): Effect.Effect<Session<Details>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const graph = Graph.fromDefinition(options.definition)
    const initial = yield* options.handle.snapshot
    const initialPosition = position(graph, initial, 0, options.projectState)
    const model = yield* SubscriptionRef.make<SessionModel<State, Details>>({
      status: "running",
      positions: [initialPosition],
      pendingStates: [],
      pendingCommits: [],
      raw: [],
      semantic: [],
      invocations: {},
      children: {},
    })
    const subscribed = yield* Deferred.make<void>()

    yield* options.handle.changes.pipe(
      Stream.tap(() => Deferred.succeed(subscribed, undefined)),
      Stream.runForEach((state) =>
        SubscriptionRef.update(model, (current) => {
          const previous = current.positions[current.positions.length - 1]
          if (previous !== undefined && Object.is(previous.state, state)) return current
          return reconcileCommits(graph, options.projectState, {
            ...current,
            pendingStates: [...current.pendingStates, state],
          })
        }),
      ),
      Effect.forkScoped,
    )
    yield* Deferred.await(subscribed)

    const inspectionSubscribed = yield* Deferred.make<void>()
    yield* options.handle.inspection.pipe(
      Stream.tap(() => Deferred.succeed(inspectionSubscribed, undefined)),
      Stream.runForEach((event) =>
        SubscriptionRef.update(model, (current) =>
          reconcileCommits(graph, options.projectState, appendInspection(current, event)),
        ),
      ),
      Effect.forkScoped,
    )
    yield* Deferred.await(inspectionSubscribed)

    yield* options.handle.completion.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        SubscriptionRef.update(model, (current) => ({
          ...current,
          status: Exit.isSuccess(exit)
            ? "completed"
            : Cause.hasInterruptsOnly(exit.cause)
              ? current.status
              : "defected",
        })),
      ),
      Effect.forkScoped,
    )

    return {
      view: SubscriptionRef.get(model).pipe(
        Effect.map((current) => toView(options.definition, graph, current)),
      ),
      changes: SubscriptionRef.changes(model).pipe(
        Stream.map((current) => toView(options.definition, graph, current)),
      ),
    }
  })
