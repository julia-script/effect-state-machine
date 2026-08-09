import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import type * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"

interface Tagged {
  readonly _tag: string
}

export type TaggedSchema = Schema.Top &
  Readonly<{
    Type: Tagged
    cases: Readonly<Record<string, Schema.Top>>
  }>
type TagOf<Value extends Tagged> = Value["_tag"]
type ByTag<Value extends Tagged, Tag extends string> = Extract<Value, { _tag: Tag }>

type TransitionArgs<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  state: ByTag<State, Current>
  event: ByTag<Event, EventTag>
}>

export type Transition<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => ByTag<State, Target>
      }>
    : never

export type EventHandlers<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [EventTag in TagOf<Event>]?: Transition<State, Event, Current, EventTag>
}>

export interface StateNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> {
  readonly kind: "state"
  readonly tag: Current
  readonly on: EventHandlers<State, Event, Current>
}

type StateNodeUnion<State extends Tagged, Event extends Tagged> = {
  [Current in TagOf<State>]: StateNode<State, Event, Current>
}[TagOf<State>]

export interface MachineDefinition<
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  Nodes extends ReadonlyArray<
    StateNodeUnion<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>
  >,
> {
  readonly id: string
  readonly description?: string
  readonly schemas: Readonly<{
    input: InputSchema
    state: StateSchema
    event: EventSchema
  }>
  readonly initial: (input: Schema.Schema.Type<InputSchema>) => Schema.Schema.Type<StateSchema>
  readonly nodes: Nodes
}

export interface DefinitionMetadata {
  readonly id: string
  readonly description?: string
  readonly schemas: Readonly<{
    state: TaggedSchema
    event: TaggedSchema
  }>
  readonly nodes: ReadonlyArray<
    Readonly<{
      kind: "state"
      tag: string
      on: Readonly<
        Record<
          string,
          | Readonly<{
              target: string
              description?: string
            }>
          | undefined
        >
      >
    }>
  >
}

export interface MachineHandle<State extends Tagged, Event extends Tagged> {
  readonly snapshot: Effect.Effect<State>
  readonly changes: Stream.Stream<State>
  readonly inspection: Stream.Stream<InspectionEvent>
  readonly send: (event: Event) => Effect.Effect<void>
  readonly can: (event: Event) => Effect.Effect<boolean>
}

export type InspectionEvent =
  | Readonly<{
      _tag: "MachineStarted"
      machineId: string
      initialStateTag: string
    }>
  | Readonly<{
      _tag: "EventReceived"
      machineId: string
      stateTag: string
      eventTag: string
    }>
  | Readonly<{
      _tag: "TransitionSelected"
      machineId: string
      sourceStateTag: string
      targetStateTag: string
      eventTag: string
    }>
  | Readonly<{
      _tag: "StateChanged"
      machineId: string
      previousStateTag: string
      nextStateTag: string
    }>
  | Readonly<{
      _tag: "MachineDefected"
      machineId: string
      stateTag: string
      eventTag: string
      defect: "ProtocolDefect"
    }>

export class MachineDefinitionDefect extends Error {
  readonly name = "MachineDefinitionDefect"
}

export class ProtocolDefect extends Error {
  readonly name = "ProtocolDefect"

  constructor(
    readonly machineId: string,
    readonly stateTag: string,
    readonly eventTag: string,
  ) {
    super(`Machine ${machineId} does not accept ${eventTag} in ${stateTag}`)
  }
}

export type MachineInput<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ input: infer InputSchema extends Schema.Top }>
  }>
    ? Schema.Schema.Type<InputSchema>
    : never

export type MachineState<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ state: infer StateSchema extends TaggedSchema }>
  }>
    ? Schema.Schema.Type<StateSchema>
    : never

export type MachineEvent<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ event: infer EventSchema extends TaggedSchema }>
  }>
    ? Schema.Schema.Type<EventSchema>
    : never

export const builder = <
  const InputSchema extends Schema.Top,
  const StateSchema extends TaggedSchema,
  const EventSchema extends TaggedSchema,
>(
  schemas: Readonly<{
    input: InputSchema
    state: StateSchema
    event: EventSchema
  }>,
) => {
  type State = Schema.Schema.Type<StateSchema>
  type Event = Schema.Schema.Type<EventSchema>

  const state = <Current extends TagOf<State>>(
    tag: Current,
    config: Readonly<{ on?: EventHandlers<State, Event, Current> }>,
  ): StateNode<State, Event, Current> => ({
    kind: "state",
    tag,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const make = <const Nodes extends ReadonlyArray<StateNodeUnion<State, Event>>>(
    config: Readonly<{
      id: string
      description?: string
      initial: (input: Schema.Schema.Type<InputSchema>) => State
      nodes: Nodes
    }>,
  ): MachineDefinition<InputSchema, StateSchema, EventSchema, Nodes> => {
    const runtimeNodes = config.nodes as ReadonlyArray<RuntimeNode<State, Event>>
    const tags = new Set<string>()

    for (const node of runtimeNodes) {
      if (tags.has(node.tag)) {
        throw new MachineDefinitionDefect(
          `Machine ${config.id} declares state ${node.tag} more than once`,
        )
      }
      tags.add(node.tag)
    }

    for (const node of runtimeNodes) {
      for (const transition of Object.values(node.on)) {
        if (transition !== undefined && !tags.has(transition.target)) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} targets missing state ${transition.target}`,
          )
        }
      }
    }

    return {
      id: config.id,
      description: config.description,
      schemas,
      initial: config.initial,
      nodes: config.nodes,
    }
  }

  return { make, state }
}

interface RuntimeTransition<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly reduce: (args: Readonly<{ state: State; event: Event }>) => State
}

interface RuntimeNode<State extends Tagged, Event extends Tagged> {
  readonly tag: string
  readonly on: Readonly<Record<string, RuntimeTransition<State, Event> | undefined>>
}

interface Envelope<Event extends Tagged> {
  readonly event: Event
  readonly reply: Deferred.Deferred<void>
}

export const run = <
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  Nodes extends ReadonlyArray<
    StateNodeUnion<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>
  >,
>(
  definition: MachineDefinition<InputSchema, StateSchema, EventSchema, Nodes>,
  input: Schema.Schema.Type<InputSchema>,
): Effect.Effect<
  MachineHandle<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    type State = Schema.Schema.Type<StateSchema>
    type Event = Schema.Schema.Type<EventSchema>

    const initial = definition.initial(input)
    if (!definition.nodes.some((node) => node.tag === initial._tag)) {
      return yield* Effect.die(
        new MachineDefinitionDefect(
          `Machine ${definition.id} initialized to missing state ${initial._tag}`,
        ),
      )
    }

    const stateRef = yield* SubscriptionRef.make(initial)
    const inbox = yield* Queue.unbounded<Envelope<Event>>()
    const inspectionPubSub = yield* PubSub.unbounded<InspectionEvent>()
    const terminated = yield* Deferred.make<void>()
    // The public builder proves this shape. The cast restores erased per-tag reducer types
    // at the single interpreter boundary where nodes become a homogeneous lookup table.
    const runtimeNodes = definition.nodes as ReadonlyArray<RuntimeNode<State, Event>>
    const nodes = new Map(runtimeNodes.map((node) => [node.tag, node]))

    const emit = (event: InspectionEvent) =>
      PubSub.publish(inspectionPubSub, event).pipe(Effect.asVoid)

    const process = (envelope: Envelope<Event>) =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(stateRef)
        yield* emit({
          _tag: "EventReceived",
          machineId: definition.id,
          stateTag: current._tag,
          eventTag: envelope.event._tag,
        })
        const transition = nodes.get(current._tag)?.on[envelope.event._tag]

        if (transition === undefined) {
          const defect = new ProtocolDefect(definition.id, current._tag, envelope.event._tag)
          yield* emit({
            _tag: "MachineDefected",
            machineId: definition.id,
            stateTag: current._tag,
            eventTag: envelope.event._tag,
            defect: "ProtocolDefect",
          })
          yield* Deferred.die(envelope.reply, defect)
          return yield* Effect.die(defect)
        }

        yield* emit({
          _tag: "TransitionSelected",
          machineId: definition.id,
          sourceStateTag: current._tag,
          targetStateTag: transition.target,
          eventTag: envelope.event._tag,
        })
        const next = transition.reduce({ state: current, event: envelope.event })
        if (next._tag !== transition.target) {
          return yield* Effect.die(
            new MachineDefinitionDefect(
              `Machine ${definition.id} reducer targeted ${transition.target} but returned ${next._tag}`,
            ),
          )
        }
        yield* SubscriptionRef.set(stateRef, next)
        yield* emit({
          _tag: "StateChanged",
          machineId: definition.id,
          previousStateTag: current._tag,
          nextStateTag: next._tag,
        })
        yield* Deferred.succeed(envelope.reply, undefined)
      })

    yield* Queue.take(inbox).pipe(
      Effect.flatMap(process),
      Effect.forever,
      Effect.onExit((exit) => Deferred.done(terminated, exit).pipe(Effect.asVoid)),
      Effect.forkScoped,
    )

    const started: InspectionEvent = {
      _tag: "MachineStarted",
      machineId: definition.id,
      initialStateTag: initial._tag,
    }

    return {
      snapshot: SubscriptionRef.get(stateRef),
      changes: SubscriptionRef.changes(stateRef),
      inspection: Stream.concat(Stream.succeed(started), Stream.fromPubSub(inspectionPubSub)),
      can: (event) =>
        Effect.map(SubscriptionRef.get(stateRef), (current) => {
          return nodes.get(current._tag)?.on[event._tag] !== undefined
        }),
      send: (event) =>
        Effect.gen(function* () {
          const reply = yield* Deferred.make<void>()
          yield* Queue.offer(inbox, { event, reply })
          yield* Effect.raceFirst(Deferred.await(reply), Deferred.await(terminated))
        }),
    }
  })
