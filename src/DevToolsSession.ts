import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Graph from "./Graph.js"
import type * as Machine from "./Machine.js"
import type * as SourceLocation from "./SourceLocation.js"

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

interface QuickEventBase {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly group?: string
}

export type QuickEvent<Event> =
  | (QuickEventBase & Readonly<{ event: Event }>)
  | (QuickEventBase & Readonly<{ make: () => Event }>)

export interface QuickEventControl extends QuickEventBase {
  readonly kind: "event" | "factory"
  readonly available?: boolean
}

export type QuickEventFailureReason = "not-found" | "unavailable" | "factory-threw"

export class QuickEventFailure extends Data.TaggedError("QuickEventFailure")<{
  readonly quickEventId: string
  readonly reason: QuickEventFailureReason
  readonly cause?: unknown
}> {}

export interface ControlFailure {
  readonly quickEventId: string
  readonly reason: QuickEventFailureReason
}

export interface SessionView<Details = never> {
  readonly machine: Readonly<{
    id: string
    description?: string
  }>
  readonly graph: Graph.Graph
  readonly focus: Readonly<{
    depth: Graph.FocusDepth
    graph: Graph.Graph
    activity: Graph.ActivityOverlay
  }>
  readonly status: SessionStatus
  readonly liveHead: number
  readonly cursor: number
  readonly isLive: boolean
  readonly selected: SessionPosition<Details>
  readonly positions: ReadonlyArray<SessionPosition<Details>>
  readonly history: SessionHistory
  readonly quickEvents: ReadonlyArray<QuickEventControl>
  readonly controlFailure?: ControlFailure
}

export interface Session<Details = never> {
  readonly view: Effect.Effect<SessionView<Details>>
  readonly changes: Stream.Stream<SessionView<Details>>
  readonly previous: Effect.Effect<void>
  readonly next: Effect.Effect<void>
  readonly selectPosition: (position: number) => Effect.Effect<boolean>
  readonly selectStep: (step: number) => Effect.Effect<boolean>
  readonly returnToLive: Effect.Effect<void>
  readonly setFocusDepth: (depth: Graph.FocusDepth) => Effect.Effect<void>
  readonly dispatchQuickEvent: (id: string) => Effect.Effect<void, QuickEventFailure>
}

export interface AttachOptions<State extends Tagged, Event extends Tagged, Details = never> {
  readonly definition: Machine.DefinitionMetadata
  readonly handle: Machine.MachineHandle<State, Event, State>
  readonly projectState?: (state: State) => Details
  readonly quickEvents?: ReadonlyArray<QuickEvent<Event>>
  readonly mapSource?: SourceLocation.Mapper
}

interface InternalPosition<State extends Tagged, Details> {
  readonly state: State
  readonly view: SessionPosition<Details>
}

interface SessionModel<State extends Tagged, Details> {
  readonly status: SessionStatus
  readonly positions: ReadonlyArray<InternalPosition<State, Details>>
  readonly cursor: number
  readonly focusDepth: Graph.FocusDepth
  readonly pendingStates: ReadonlyArray<State>
  readonly pendingCommits: ReadonlyArray<Readonly<{ step?: number }>>
  readonly raw: ReadonlyArray<RawInspectionRecord>
  readonly semantic: ReadonlyArray<SemanticStep>
  readonly activeEventStep?: number
  readonly pendingOutcomeStep?: number
  readonly invocations: Readonly<Record<string, number>>
  readonly children: Readonly<Record<string, number>>
  readonly controlFailure?: ControlFailure
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
      cursor: next.cursor === next.positions.length - 1 ? committedPosition : next.cursor,
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
  quickEvents: ReadonlyArray<QuickEventControl>,
): SessionView<Details> => {
  const positions = freeze(model.positions.map((entry) => entry.view))
  const liveHead = positions.length - 1
  const selected = positions[model.cursor]
  const focusedGraph = Graph.focus(graph, selected.state.tag, model.focusDepth)
  const transitions = model.semantic.flatMap(
    (step): ReadonlyArray<Graph.TransitionActivity> =>
      step.committedPosition !== undefined &&
      step.committedPosition <= model.cursor &&
      step.sourceStateTag !== undefined &&
      step.targetStateTag !== undefined
        ? [
            {
              source: step.sourceStateTag,
              target: step.targetStateTag,
              ...(step.eventTag === undefined ? {} : { event: step.eventTag }),
              ...(step.branch === undefined ? {} : { branchIndex: step.branch.index }),
            },
          ]
        : [],
  )
  return freeze({
    machine: freeze({
      id: definition.id,
      ...(definition.description === undefined ? {} : { description: definition.description }),
    }),
    graph,
    focus: freeze({
      depth: model.focusDepth,
      graph: focusedGraph,
      activity: Graph.activity(focusedGraph, selected.state.tag, transitions),
    }),
    status: model.status,
    liveHead,
    cursor: model.cursor,
    isLive: model.cursor === liveHead,
    selected,
    positions,
    history: freeze({
      semantic: freeze([...model.semantic]),
      raw: freeze([...model.raw]),
    }),
    quickEvents: freeze(
      quickEvents.map((quickEvent) =>
        freeze({
          ...quickEvent,
          ...(model.status === "running" ? {} : { available: false }),
        }),
      ),
    ),
    ...(model.controlFailure === undefined
      ? {}
      : { controlFailure: freeze({ ...model.controlFailure }) }),
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
    const graph = Graph.fromDefinition(options.definition, { mapSource: options.mapSource })
    const quickEvents = options.quickEvents ?? []
    const quickEventIds = new Set<string>()
    for (const quickEvent of quickEvents) {
      if (quickEventIds.has(quickEvent.id)) {
        return yield* Effect.die(
          new Error(`Duplicate devtools quick event identifier: ${quickEvent.id}`),
        )
      }
      quickEventIds.add(quickEvent.id)
    }
    const quickEventControls = quickEvents.map(
      (quickEvent): QuickEventControl =>
        freeze({
          id: quickEvent.id,
          label: quickEvent.label,
          ...(quickEvent.description === undefined ? {} : { description: quickEvent.description }),
          ...(quickEvent.group === undefined ? {} : { group: quickEvent.group }),
          kind: "make" in quickEvent ? "factory" : "event",
        }),
    )
    const initial = yield* options.handle.snapshot
    const initialPosition = position(graph, initial, 0, options.projectState)
    const model = yield* SubscriptionRef.make<SessionModel<State, Details>>({
      status: "running",
      positions: [initialPosition],
      cursor: 0,
      focusDepth: 1,
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
        Effect.map((current) => toView(options.definition, graph, current, quickEventControls)),
      ),
      changes: SubscriptionRef.changes(model).pipe(
        Stream.map((current) => toView(options.definition, graph, current, quickEventControls)),
      ),
      previous: SubscriptionRef.update(model, (current) => ({
        ...current,
        cursor: Math.max(0, current.cursor - 1),
      })),
      next: SubscriptionRef.update(model, (current) => ({
        ...current,
        cursor: Math.min(current.positions.length - 1, current.cursor + 1),
      })),
      selectPosition: (selectedPosition) =>
        SubscriptionRef.modify(model, (current) => {
          if (
            !Number.isInteger(selectedPosition) ||
            selectedPosition < 0 ||
            selectedPosition >= current.positions.length
          ) {
            return [false, current]
          }
          return [true, { ...current, cursor: selectedPosition }]
        }),
      selectStep: (selectedStep) =>
        SubscriptionRef.modify(model, (current) => {
          const step = current.semantic[selectedStep]
          if (step === undefined) return [false, current]
          return [true, { ...current, cursor: step.statePosition }]
        }),
      returnToLive: SubscriptionRef.update(model, (current) => ({
        ...current,
        cursor: current.positions.length - 1,
      })),
      setFocusDepth: (focusDepth) =>
        SubscriptionRef.update(model, (current) => ({ ...current, focusDepth })),
      dispatchQuickEvent: (id) =>
        Effect.gen(function* () {
          const quickEvent = quickEvents.find((candidate) => candidate.id === id)
          const current = yield* SubscriptionRef.get(model)
          if (quickEvent === undefined || current.status !== "running") {
            const failure = new QuickEventFailure({
              quickEventId: id,
              reason: quickEvent === undefined ? "not-found" : "unavailable",
            })
            yield* SubscriptionRef.update(model, (state) => ({
              ...state,
              controlFailure: { quickEventId: id, reason: failure.reason },
            }))
            return yield* Effect.fail(failure)
          }

          const event = yield* "make" in quickEvent
            ? Effect.try({
                try: quickEvent.make,
                catch: (cause) =>
                  new QuickEventFailure({
                    quickEventId: id,
                    reason: "factory-threw",
                    cause,
                  }),
              }).pipe(
                Effect.catchTag("QuickEventFailure", (failure) =>
                  Effect.andThen(
                    SubscriptionRef.update(model, (state) => ({
                      ...state,
                      controlFailure: {
                        quickEventId: id,
                        reason: failure.reason,
                      },
                    })),
                    Effect.fail(failure),
                  ),
                ),
              )
            : Effect.succeed(quickEvent.event)
          const available = yield* options.handle.can(event)
          if (!available) {
            const failure = new QuickEventFailure({
              quickEventId: id,
              reason: "unavailable",
            })
            yield* SubscriptionRef.update(model, (state) => ({
              ...state,
              controlFailure: { quickEventId: id, reason: failure.reason },
            }))
            return yield* Effect.fail(failure)
          }

          yield* SubscriptionRef.update(model, (state) => ({
            ...state,
            controlFailure: undefined,
          }))
          yield* options.handle.send(event)
        }),
    }
  })
