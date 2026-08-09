/**
 * Throwaway public-API prototype for ticket 01.
 *
 * The types and values in this module exist only to test the proposed authoring
 * surface. They deliberately contain no interpreter.
 */
import type { Effect, Schedule, Schema, Stream } from "effect"

type Tagged = Readonly<{ _tag: string }>
type TaggedSchema = Schema.Top & Readonly<{ Type: Tagged }>
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

type Transition<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  target: TagOf<State>
  description?: string
  reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => State
}>

type WhenBranch<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  when: Readonly<{
    name: string
    description?: string
    guard: (args: TransitionArgs<State, Event, Current, EventTag>) => boolean
  }>
  target: TagOf<State>
  description?: string
  reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => State
}>

type OtherwiseBranch<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  otherwise: true
  target: TagOf<State>
  description?: string
  reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => State
}>

type GuardedTransition<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  branches: readonly [
    WhenBranch<State, Event, Current, EventTag>,
    ...ReadonlyArray<
      WhenBranch<State, Event, Current, EventTag> | OtherwiseBranch<State, Event, Current, EventTag>
    >,
  ]
}>

type IgnoredTransition = Readonly<{
  ignore: Readonly<{
    description?: string
  }>
}>

type EventHandler<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> =
  | Transition<State, Event, Current, EventTag>
  | GuardedTransition<State, Event, Current, EventTag>
  | IgnoredTransition

type EventHandlers<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [EventTag in TagOf<Event>]?: EventHandler<State, Event, Current, EventTag>
}>

interface Node<Tag extends string = string, Requirements = never> {
  readonly kind: "state" | "invoke" | "child" | "final"
  readonly tag: Tag
  readonly _Requirements?: Requirements
}

export interface StateNode<State extends Tagged, Event extends Tagged, Current extends TagOf<State>>
  extends Node<Current, never> {
  readonly kind: "state"
  readonly on: EventHandlers<State, Event, Current>
}

export interface FinalNode<Current extends string> extends Node<Current, never> {
  readonly kind: "final"
}

interface DefinitionShape {
  readonly schemas: Readonly<{
    input: Schema.Top
    state: TaggedSchema
    event: TaggedSchema
  }>
  readonly nodes: ReadonlyArray<Node<string, unknown>>
}

type SuccessTransition<State extends Tagged, Current extends TagOf<State>, Value> = Readonly<{
  target: TagOf<State>
  description?: string
  reduce: (args: { state: ByTag<State, Current>; value: Value }) => State
}>

type FailureTransition<State extends Tagged, Current extends TagOf<State>, Failure> = Readonly<{
  target: TagOf<State>
  description?: string
  reduce: (args: { state: ByTag<State, Current>; error: Failure }) => State
}>

export interface RetryPolicy<
  Failure,
  Retry extends Schedule.Schedule<unknown, Failure, unknown, unknown>,
> {
  readonly name: string
  readonly description?: string
  readonly schedule: Retry
}

export interface InvokeNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Output,
  Failure,
  Requirements,
> extends Node<Current, Requirements> {
  readonly kind: "invoke"
  readonly name: string
  readonly description?: string
  readonly effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
  readonly retry?: Readonly<{
    name: string
    description?: string
    schedule: Schedule.Schedule<unknown, Failure, unknown, unknown>
  }>
  readonly onSuccess: SuccessTransition<State, Current, Output>
  readonly onFailure: FailureTransition<State, Current, Failure>
  readonly on: EventHandlers<State, Event, Current>
}

export type MachineInput<Definition extends DefinitionShape> = Schema.Schema.Type<
  Definition["schemas"]["input"]
>

export type MachineState<Definition extends DefinitionShape> = Schema.Schema.Type<
  Definition["schemas"]["state"]
>

export type MachineEvent<Definition extends DefinitionShape> = Schema.Schema.Type<
  Definition["schemas"]["event"]
>

export interface MachineDefinition<
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  Nodes extends ReadonlyArray<Node<string, unknown>>,
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

type RequirementsOfNode<Value> =
  Value extends Node<string, infer Requirements> ? Exclude<Requirements, undefined> : never

type FinalTagOfNode<Value> = Value extends FinalNode<infer Tag> ? Tag : never

export type MachineRequirements<
  Definition extends { readonly nodes: ReadonlyArray<Node<string, unknown>> },
> = RequirementsOfNode<Definition["nodes"][number]>

export type MachineCompletion<Definition extends DefinitionShape> = Extract<
  Schema.Schema.Type<Definition["schemas"]["state"]>,
  { _tag: FinalTagOfNode<Definition["nodes"][number]> }
>

export interface ChildNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  ChildDefinition extends DefinitionShape,
> extends Node<Current, MachineRequirements<ChildDefinition>> {
  readonly kind: "child"
  readonly name: string
  readonly description?: string
  readonly machine: ChildDefinition
  readonly input: (state: ByTag<State, Current>) => MachineInput<ChildDefinition>
  readonly forward: ReadonlyArray<Extract<TagOf<Event>, TagOf<MachineEvent<ChildDefinition>>>>
  readonly onDone: Readonly<{
    target: TagOf<State>
    description?: string
    reduce: (args: {
      state: ByTag<State, Current>
      output: MachineCompletion<ChildDefinition>
    }) => State
  }>
  readonly on: EventHandlers<State, Event, Current>
}

export interface InspectionEvent {
  readonly _tag: string
  readonly machineId: string
  readonly instanceId: string
  readonly timestamp: number
}

export interface MachineHandle<Definition extends DefinitionShape> {
  readonly snapshot: Effect.Effect<MachineState<Definition>>
  readonly changes: Stream.Stream<MachineState<Definition>>
  readonly send: (event: MachineEvent<Definition>) => Effect.Effect<void>
  readonly can: (event: MachineEvent<Definition>) => Effect.Effect<boolean>
  readonly completion: Effect.Effect<MachineCompletion<Definition>>
  readonly inspection: Stream.Stream<InspectionEvent>
}

const builder = <
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
    config: Readonly<{
      on?: EventHandlers<State, Event, Current>
    }>,
  ): StateNode<State, Event, Current> => ({
    kind: "state",
    tag,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const final = <Current extends TagOf<State>>(tag: Current): FinalNode<Current> => ({
    kind: "final",
    tag,
  })

  const invoke = <
    Current extends TagOf<State>,
    Output,
    Failure,
    EffectRequirements,
    Retry extends Schedule.Schedule<unknown, Failure, unknown, unknown> = Schedule.Schedule<
      never,
      Failure,
      never,
      never
    >,
  >(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, EffectRequirements>
      retry?: RetryPolicy<Failure, Retry>
      onSuccess: SuccessTransition<State, Current, Output>
      onFailure: FailureTransition<State, Current, Failure>
      on?: EventHandlers<State, Event, Current>
    }>,
  ): InvokeNode<
    State,
    Event,
    Current,
    Output,
    Failure,
    EffectRequirements | Schedule.Env<Retry>
  > => ({
    kind: "invoke",
    tag,
    name: config.name,
    description: config.description,
    effect: config.effect as (
      state: ByTag<State, Current>,
    ) => Effect.Effect<Output, Failure, EffectRequirements | Schedule.Env<Retry>>,
    retry: config.retry,
    onSuccess: config.onSuccess,
    onFailure: config.onFailure,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const child = <Current extends TagOf<State>, ChildDefinition extends DefinitionShape>(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      machine: ChildDefinition
      input: (state: ByTag<State, Current>) => MachineInput<ChildDefinition>
      forward: ReadonlyArray<Extract<TagOf<Event>, TagOf<MachineEvent<ChildDefinition>>>>
      onDone: Readonly<{
        target: TagOf<State>
        description?: string
        reduce: (args: {
          state: ByTag<State, Current>
          output: MachineCompletion<ChildDefinition>
        }) => State
      }>
      on?: EventHandlers<State, Event, Current>
    }>,
  ): ChildNode<State, Event, Current, ChildDefinition> => ({
    kind: "child",
    tag,
    name: config.name,
    description: config.description,
    machine: config.machine,
    input: config.input,
    forward: config.forward,
    onDone: config.onDone,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const make = <const Nodes extends ReadonlyArray<Node<string, unknown>>>(
    config: Readonly<{
      id: string
      description?: string
      initial: (input: Schema.Schema.Type<InputSchema>) => State
      nodes: Nodes
    }>,
  ): MachineDefinition<InputSchema, StateSchema, EventSchema, Nodes> => ({
    id: config.id,
    description: config.description,
    schemas,
    initial: config.initial,
    nodes: config.nodes,
  })

  return { child, final, invoke, make, state }
}

export const Machine = { builder } as const
