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
}

const freeze = <Value extends object>(value: Value): Readonly<Value> => Object.freeze(value)

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
    })
    const subscribed = yield* Deferred.make<void>()

    yield* options.handle.changes.pipe(
      Stream.tap(() => Deferred.succeed(subscribed, undefined)),
      Stream.runForEach((state) =>
        SubscriptionRef.update(model, (current) => {
          const previous = current.positions[current.positions.length - 1]
          if (previous !== undefined && Object.is(previous.state, state)) return current
          return {
            ...current,
            positions: [
              ...current.positions,
              position(graph, state, current.positions.length, options.projectState),
            ],
          }
        }),
      ),
      Effect.forkScoped,
    )
    yield* Deferred.await(subscribed)

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
