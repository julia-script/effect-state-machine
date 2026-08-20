/**
 * Throwaway public-API prototype for ticket 01.
 *
 * The types and values in this module exist only to test the proposed authoring
 * surface. They deliberately contain no interpreter.
 */
import type * as Effect from "effect/Effect"
import type * as Schedule from "effect/Schedule"
import type * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"

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
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => ByTag<State, Target>
      }>
    : never

type WhenBranch<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        when: Readonly<{
          name: string
          description?: string
          guard: (args: TransitionArgs<State, Event, Current, EventTag>) => boolean
        }>
        target: Target
        description?: string
        reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => ByTag<State, Target>
      }>
    : never

type OtherwiseBranch<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        otherwise: true
        target: Target
        description?: string
        reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => ByTag<State, Target>
      }>
    : never

type GuardedTransition<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  branches:
    | readonly [
        WhenBranch<State, Event, Current, EventTag>,
        ...ReadonlyArray<WhenBranch<State, Event, Current, EventTag>>,
      ]
    | readonly [
        WhenBranch<State, Event, Current, EventTag>,
        ...ReadonlyArray<WhenBranch<State, Event, Current, EventTag>>,
        OtherwiseBranch<State, Event, Current, EventTag>,
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

type SuccessTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: { state: ByTag<State, Current>; value: Value }) => ByTag<State, Target>
      }>
    : never

type FailureTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Failure,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: { state: ByTag<State, Current>; error: Failure }) => ByTag<State, Target>
      }>
    : never

export interface WorkExecutionMetadata {
  readonly executionKey: string
  readonly instanceId: string
  readonly entryId: string
  readonly ownerPath: string
  readonly invocationName: string
  readonly laneName?: string
  readonly deliveryAttempt: number
}

type WorkSchema = Schema.Codec<unknown, unknown, unknown, unknown>

type WorkSchemaRequirements<Value extends WorkSchema> =
  | Value["DecodingServices"]
  | Value["EncodingServices"]

type WorkEffect<
  State extends Tagged,
  Current extends TagOf<State>,
  Success extends WorkSchema,
  Failure,
  Requirements,
> = (
  state: ByTag<State, Current>,
  metadata?: WorkExecutionMetadata,
) => Effect.Effect<Schema.Schema.Type<Success>, Failure, Requirements>

type EffectOf<Value> = Value extends (...args: any[]) => infer Result ? Result : never
type EffectSuccessOf<Value> = Effect.Success<EffectOf<Value>>
type EffectFailureOf<Value> = Effect.Error<EffectOf<Value>>
type EffectRequirementsOf<Value> = Effect.Services<EffectOf<Value>>

type ValidateWorkEffect<EffectFn, Success extends WorkSchema, AllowedFailure extends WorkSchema> = [
  EffectSuccessOf<EffectFn>,
] extends [Schema.Schema.Type<Success>]
  ? [Schema.Schema.Type<Success>] extends [EffectSuccessOf<EffectFn>]
    ? [EffectFailureOf<EffectFn>] extends [Schema.Schema.Type<AllowedFailure>]
      ? unknown
      : never
    : never
  : never

export interface RetryPolicy<
  Failure,
  Retry extends Schedule.Schedule<unknown, Failure, unknown, unknown>,
> {
  readonly name: string
  readonly description?: string
  readonly schedule: Retry
}

type AnyRetry<Failure> = Schedule.Schedule<unknown, Failure, unknown, unknown>

type RetrySchedule<Retry> =
  Retry extends Readonly<{
    schedule: infer Value extends Schedule.Schedule<any, any, any, any>
  }>
    ? Value
    : never
type RetryRequirements<Retry> = Schedule.Env<RetrySchedule<Retry>>
type RetryError<Retry> = Schedule.Error<RetrySchedule<Retry>>

export interface InvokeNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Success extends WorkSchema,
  AllowedFailure extends WorkSchema,
  EffectFailure,
  EffectRequirements,
  Retry extends RetryPolicy<EffectFailure, AnyRetry<EffectFailure>> | undefined,
> extends Node<
    Current,
    | EffectRequirements
    | RetryRequirements<Retry>
    | WorkSchemaRequirements<Success>
    | WorkSchemaRequirements<AllowedFailure>
  > {
  readonly kind: "invoke"
  readonly workKind: "effect"
  readonly name: string
  readonly description?: string
  readonly success: Success
  readonly error: AllowedFailure
  readonly effect: WorkEffect<State, Current, Success, EffectFailure, EffectRequirements>
  readonly retry?: Retry
  readonly onSuccess: SuccessTransition<State, Current, Schema.Schema.Type<Success>>
  readonly onFailure: FailureTransition<State, Current, Schema.Schema.Type<AllowedFailure>>
  readonly on: EventHandlers<State, Event, Current>
}

type LaneShape<State extends Tagged, Current extends TagOf<State>> = Readonly<{
  description?: string
  success: WorkSchema
  error: WorkSchema
  effect: WorkEffect<State, Current, WorkSchema, unknown, unknown>
}>

type ValidateLane<State extends Tagged, Current extends TagOf<State>, Lane> =
  Lane extends Readonly<{
    success: infer Success extends WorkSchema
    error: infer Failure extends WorkSchema
    effect: (
      state: ByTag<State, Current>,
      metadata?: WorkExecutionMetadata,
    ) => Effect.Effect<infer Output, infer EffectFailure, unknown>
  }>
    ? [Output] extends [Schema.Schema.Type<Success>]
      ? [Schema.Schema.Type<Success>] extends [Output]
        ? [EffectFailure] extends [Schema.Schema.Type<Failure>]
          ? Lane
          : never
        : never
      : never
    : never

type ValidateLanes<State extends Tagged, Current extends TagOf<State>, Lanes> = Readonly<{
  [Name in keyof Lanes]: ValidateLane<State, Current, Lanes[Name]>
}>

type LaneSuccess<Lane> =
  Lane extends Readonly<{ success: infer Success extends WorkSchema }>
    ? Schema.Schema.Type<Success>
    : never

type LaneFailure<Lane> =
  Lane extends Readonly<{ error: infer Failure extends WorkSchema }>
    ? Schema.Schema.Type<Failure>
    : never

type LaneRequirements<Lane> =
  Lane extends Readonly<{
    success: infer Success extends WorkSchema
    error: infer Failure extends WorkSchema
    effect: (...args: never[]) => Effect.Effect<unknown, unknown, infer Requirements>
  }>
    ? Requirements | WorkSchemaRequirements<Success> | WorkSchemaRequirements<Failure>
    : never

type LanesSuccess<Lanes> = Readonly<{
  [Name in keyof Lanes]: LaneSuccess<Lanes[Name]>
}>

type LanesFailure<Lanes> = LaneFailure<Lanes[keyof Lanes]>
type LanesRequirements<Lanes> = LaneRequirements<Lanes[keyof Lanes]>

export type RaceOutcome<Lanes> = {
  [Name in keyof Lanes]: Readonly<{ winner: Name; value: LaneSuccess<Lanes[Name]> }>
}[keyof Lanes]

export interface AllInvokeNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Lanes extends Readonly<Record<string, LaneShape<State, Current>>>,
> extends Node<Current, LanesRequirements<Lanes>> {
  readonly kind: "invoke"
  readonly workKind: "all"
  readonly name: string
  readonly description?: string
  readonly concurrency?: number | "unbounded"
  readonly tasks: Lanes
  readonly onSuccess: SuccessTransition<State, Current, LanesSuccess<Lanes>>
  readonly onFailure: FailureTransition<State, Current, LanesFailure<Lanes>>
  readonly on: EventHandlers<State, Event, Current>
}

export interface RaceInvokeNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Lanes extends Readonly<Record<string, LaneShape<State, Current>>>,
> extends Node<Current, LanesRequirements<Lanes>> {
  readonly kind: "invoke"
  readonly workKind: "race"
  readonly name: string
  readonly description?: string
  readonly tasks: Lanes
  readonly onSuccess: SuccessTransition<State, Current, RaceOutcome<Lanes>>
  readonly onFailure: FailureTransition<State, Current, LanesFailure<Lanes>>
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

type ForwardableTag<ParentEvent extends Tagged, ChildEvent extends Tagged> = {
  [Tag in Extract<TagOf<ParentEvent>, TagOf<ChildEvent>>]: ByTag<ParentEvent, Tag> extends ByTag<
    ChildEvent,
    Tag
  >
    ? Tag
    : never
}[Extract<TagOf<ParentEvent>, TagOf<ChildEvent>>]

type ChildCompletionTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Output,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: { state: ByTag<State, Current>; output: Output }) => ByTag<State, Target>
      }>
    : never

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
  readonly forward: ReadonlyArray<ForwardableTag<Event, MachineEvent<ChildDefinition>>>
  readonly onDone: ChildCompletionTransition<State, Current, MachineCompletion<ChildDefinition>>
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
    const Success extends WorkSchema,
    const AllowedFailure extends WorkSchema,
    const EffectFn extends (...args: any[]) => Effect.Effect<any, any, any>,
    Retry extends
      | RetryPolicy<EffectFailureOf<EffectFn>, AnyRetry<EffectFailureOf<EffectFn>>>
      | undefined = undefined,
  >(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      success: Success
      error: AllowedFailure
      effect: EffectFn &
        WorkEffect<State, Current, Success, Schema.Schema.Type<AllowedFailure>, unknown>
      retry?: Retry
      onSuccess: SuccessTransition<State, Current, Schema.Schema.Type<Success>>
      onFailure: FailureTransition<State, Current, Schema.Schema.Type<AllowedFailure>>
      on?: EventHandlers<State, Event, Current>
    }> &
      ValidateWorkEffect<EffectFn, Success, AllowedFailure> &
      ([RetryError<Retry>] extends [Schema.Schema.Type<AllowedFailure>]
        ? unknown
        : Readonly<{ retry?: never }>),
  ): InvokeNode<
    State,
    Event,
    Current,
    Success,
    AllowedFailure,
    EffectFailureOf<EffectFn>,
    EffectRequirementsOf<EffectFn>,
    Retry
  > => ({
    kind: "invoke",
    workKind: "effect",
    tag,
    name: config.name,
    description: config.description,
    success: config.success,
    error: config.error,
    effect: config.effect,
    retry: config.retry,
    onSuccess: config.onSuccess,
    onFailure: config.onFailure,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const invokeAll = <
    Current extends TagOf<State>,
    const Lanes extends Readonly<Record<string, LaneShape<State, Current>>>,
  >(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      concurrency?: number | "unbounded"
      tasks: Lanes & ValidateLanes<State, Current, Lanes>
      onSuccess: SuccessTransition<State, Current, LanesSuccess<Lanes>>
      onFailure: FailureTransition<State, Current, LanesFailure<Lanes>>
      on?: EventHandlers<State, Event, Current>
    }>,
  ): AllInvokeNode<State, Event, Current, Lanes> => ({
    kind: "invoke",
    workKind: "all",
    tag,
    name: config.name,
    description: config.description,
    concurrency: config.concurrency,
    tasks: config.tasks,
    onSuccess: config.onSuccess,
    onFailure: config.onFailure,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const invokeRace = <
    Current extends TagOf<State>,
    const Lanes extends Readonly<Record<string, LaneShape<State, Current>>>,
  >(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      tasks: Lanes & ValidateLanes<State, Current, Lanes>
      onSuccess: SuccessTransition<State, Current, RaceOutcome<Lanes>>
      onFailure: FailureTransition<State, Current, LanesFailure<Lanes>>
      on?: EventHandlers<State, Event, Current>
    }>,
  ): RaceInvokeNode<State, Event, Current, Lanes> => ({
    kind: "invoke",
    workKind: "race",
    tag,
    name: config.name,
    description: config.description,
    tasks: config.tasks,
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
      forward: ReadonlyArray<ForwardableTag<Event, MachineEvent<ChildDefinition>>>
      onDone: ChildCompletionTransition<State, Current, MachineCompletion<ChildDefinition>>
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

  return { child, final, invoke, invokeAll, invokeRace, make, state }
}

export const Machine = { builder } as const
