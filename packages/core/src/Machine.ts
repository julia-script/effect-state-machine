import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberMap from "effect/FiberMap"
import * as Fn from "effect/Function"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Source from "./Source.js"

interface Tagged {
  readonly _tag: string
}

/**
 * Schema for a `_tag`-discriminated union whose cases remain available for machine tooling.
 *
 * **Details**
 *
 * The `cases` record lets the builder, graph projection, and codecs inspect each state or event
 * variant without executing machine behavior.
 *
 * @category schemas
 * @since 0.1.0
 */
export type TaggedSchema = Schema.Top &
  Readonly<{
    Type: Tagged
    cases: Readonly<Record<string, Schema.Top>>
  }>

type TaggedUnionMember = Schema.Top & Readonly<{ Type: Tagged }>
type TaggedSchemaSource = TaggedSchema | Schema.Union<ReadonlyArray<TaggedUnionMember>>

type NormalizedTaggedSchema<Source extends TaggedSchemaSource> = Source extends TaggedSchema
  ? Source
  : Source extends Schema.Union<infer Members extends ReadonlyArray<TaggedUnionMember>>
    ? Schema.toTaggedUnion<"_tag", Members>
    : never

/**
 * Definition of one case accepted by {@link taggedUnion}.
 *
 * @category models
 * @since 0.1.0
 */
export interface TaggedUnionCase<Fields extends Schema.Struct.Fields = Schema.Struct.Fields> {
  readonly fields: Fields
  readonly title?: string
  readonly description?: string
}

type TaggedUnionCases<Cases extends Readonly<Record<string, TaggedUnionCase>>> = {
  readonly [Tag in keyof Cases & string]: Schema.TaggedStruct<Tag, Cases[Tag]["fields"]>
}

/**
 * Tagged-union schema inferred from a record of case definitions.
 *
 * @category schemas
 * @since 0.1.0
 */
export type TaggedUnion<Cases extends Readonly<Record<string, TaggedUnionCase>>> =
  Schema.TaggedUnion<TaggedUnionCases<Cases>>

/**
 * Builds an Effect tagged union whose individual cases retain graphable metadata.
 *
 * **When to use**
 *
 * Use when state or event titles and descriptions should be available to graph and Studio
 * tooling. A regular `Schema.Union` of tagged structs is also accepted by {@link builder}.
 *
 * @category constructors
 * @since 0.1.0
 */
export const taggedUnion = <const Cases extends Readonly<Record<string, TaggedUnionCase>>>(
  cases: Cases,
): TaggedUnion<Cases> => {
  const members = Object.entries(cases).map(([tag, definition]) => {
    const member = Schema.TaggedStruct(tag, definition.fields)
    return definition.title === undefined && definition.description === undefined
      ? member
      : member.annotate({
          ...(definition.title === undefined ? {} : { title: definition.title }),
          ...(definition.description === undefined ? {} : { description: definition.description }),
        })
  })

  // TypeScript cannot relate the value-level Union/toTaggedUnion pipeline to the mapped
  // TaggedUnionCases type computed from Cases; the runtime shape is the same by construction.
  return Schema.Union(members).pipe(Schema.toTaggedUnion("_tag")) as unknown as TaggedUnion<Cases>
}

const normalizeTaggedSchema = <Source extends TaggedSchemaSource>(
  schema: Source,
): NormalizedTaggedSchema<Source> =>
  // TypeScript cannot narrow a conditional return type from the "cases" in-check on a generic.
  ("cases" in schema
    ? schema
    : schema.pipe(Schema.toTaggedUnion("_tag"))) as NormalizedTaggedSchema<Source>

type TagOf<Value extends Tagged> = Value["_tag"]
type ByTag<Value extends Tagged, Tag extends string> = Extract<Value, { _tag: Tag }>
type FieldsOf<Value> = Omit<Value, "_tag">

type TransitionArgs<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  state: ByTag<State, Current>
  event: ByTag<Event, EventTag>
}>

/**
 * An event transition that derives a target-state value from the current state and event.
 *
 * @category models
 * @since 0.1.0
 */
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
        reduce: (
          args: TransitionArgs<State, Event, Current, EventTag>,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

/**
 * A named guard branch in a guarded event transition.
 *
 * @category models
 * @since 0.1.0
 */
export type WhenBranch<
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
          source?: Source.Reference
        }>
        target: Target
        description?: string
        reduce: (
          args: TransitionArgs<State, Event, Current, EventTag>,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

/**
 * The final fallback branch in a guarded event transition.
 *
 * @category models
 * @since 0.1.0
 */
export type OtherwiseBranch<
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
        reduce: (
          args: TransitionArgs<State, Event, Current, EventTag>,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

/**
 * An ordered, first-match-wins collection of guarded event transitions.
 *
 * **Gotchas**
 *
 * A fallback, when present, must be the last branch. If no guard matches and no fallback exists,
 * the running machine terminates with a {@link ProtocolDefect}.
 *
 * @category models
 * @since 0.1.0
 */
export type GuardedTransition<
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

/**
 * An explicit instruction to accept an event without changing state.
 *
 * @category models
 * @since 0.1.0
 */
export interface IgnoredTransition {
  readonly ignore: Readonly<{
    description?: string
  }>
}

/**
 * Updates the current state variant without exiting or re-entering its node.
 *
 * @category models
 * @since 0.2.0
 */
export interface StayUpdate<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> {
  readonly stay: (
    args: TransitionArgs<State, Event, Current, EventTag>,
  ) => FieldsOf<ByTag<State, Current>>
}

/**
 * Handling policy for one event in one machine state.
 *
 * @category models
 * @since 0.1.0
 */
export type EventHandler<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> =
  | Transition<State, Event, Current, EventTag>
  | GuardedTransition<State, Event, Current, EventTag>
  | IgnoredTransition
  | StayUpdate<State, Event, Current, EventTag>

/**
 * State-specific event handlers keyed by event tag.
 *
 * @category models
 * @since 0.1.0
 */
export type EventHandlers<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [EventTag in TagOf<Event>]?: EventHandler<State, Event, Current, EventTag>
}>

/**
 * An ordinary machine node that handles events without owning background work.
 *
 * @category models
 * @since 0.1.0
 */
export interface StateNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> {
  readonly kind: "state"
  readonly tag: Current
  readonly source: Source.Reference
  readonly on: EventHandlers<State, Event, Current>
}

/**
 * A terminal machine node whose state value becomes the machine completion value.
 *
 * @category models
 * @since 0.1.0
 */
export interface FinalNode<Current extends string> {
  readonly kind: "final"
  readonly tag: Current
  readonly source: Source.Reference
}

type OutcomeArgs<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Key extends "value" | "error",
> = Readonly<{ state: ByTag<State, Current> }> & Readonly<Record<Key, Value>>

type OutcomeTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Key extends "value" | "error",
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: OutcomeArgs<State, Current, Value, Key>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type OutcomeWhenBranch<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Key extends "value" | "error",
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        when: Readonly<{
          name: string
          description?: string
          guard: (args: OutcomeArgs<State, Current, Value, Key>) => boolean
          source?: Source.Reference
        }>
        target: Target
        description?: string
        reduce: (args: OutcomeArgs<State, Current, Value, Key>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type OutcomeOtherwiseBranch<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Key extends "value" | "error",
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        otherwise: true
        target: Target
        description?: string
        reduce: (args: OutcomeArgs<State, Current, Value, Key>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type GuardedOutcomeTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Key extends "value" | "error",
> = Readonly<{
  branches:
    | readonly [
        OutcomeWhenBranch<State, Current, Value, Key>,
        ...ReadonlyArray<OutcomeWhenBranch<State, Current, Value, Key>>,
      ]
    | readonly [
        OutcomeWhenBranch<State, Current, Value, Key>,
        ...ReadonlyArray<OutcomeWhenBranch<State, Current, Value, Key>>,
        OutcomeOtherwiseBranch<State, Current, Value, Key>,
      ]
}>

type OutcomeHandler<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Key extends "value" | "error",
> =
  | OutcomeTransition<State, Current, Value, Key>
  | GuardedOutcomeTransition<State, Current, Value, Key>

/**
 * Transition selected from the successful output of invoked work or a child machine.
 *
 * @category models
 * @since 0.1.0
 */
export type SuccessTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
> = OutcomeHandler<State, Current, Value, "value">

/**
 * Transition selected from an expected failure of invoked work or its retry policy.
 *
 * @category models
 * @since 0.1.0
 */
export type FailureTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Error,
> = OutcomeHandler<State, Current, Error, "error">

/**
 * Named Effect schedule for retrying an invocation while its node remains active.
 *
 * **When to use**
 *
 * Use for operational retries whose attempts do not need to become machine states. Model retries
 * explicitly when their progress affects application behavior or accepted events.
 *
 * @category configuration
 * @since 0.1.0
 */
export interface RetryPolicy<
  Failure,
  Policy extends Schedule.Schedule<unknown, Failure, unknown, unknown>,
> {
  readonly name: string
  readonly description?: string
  readonly schedule: Policy
}

/** A transition owned by one node entry's timer. */
export type AfterTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        duration: Duration.Input
        description?: string
        target: Target
        reduce: (args: Readonly<{ state: ByTag<State, Current> }>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

/** Common statically inspectable shape of invoked work. */
export interface InvokeSpecBase {
  readonly kind: "effect" | "all" | "race"
  readonly name: string
}

/** Carries inferred requirements without adding runtime data. */
export interface InvokeSpec<Requirements> extends InvokeSpecBase {
  readonly _Requirements?: Requirements
}

type EffectInvokeSpec<
  State extends Tagged,
  Current extends TagOf<State>,
  Output,
  Failure,
  Requirements,
  RetryError,
  RetryEnv,
> = InvokeSpec<Requirements | RetryEnv> &
  Readonly<{
    kind: "effect"
    description?: string
    effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
    retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
    onSuccess: SuccessTransition<State, Current, Output>
    onFailure: FailureTransition<State, Current, Failure | RetryError>
  }>

type TaskShape<State extends Tagged, Current extends TagOf<State>> =
  | ((state: ByTag<State, Current>) => Effect.Effect<unknown, unknown, unknown>)
  | Readonly<{
      description?: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<unknown, unknown, unknown>
    }>

type TaskOutput<Task> = Task extends (
  ...args: never[]
) => Effect.Effect<infer Output, infer _Failure, infer _Requirements>
  ? Output
  : Task extends Readonly<{
        effect: (
          ...args: never[]
        ) => Effect.Effect<infer Output, infer _Failure, infer _Requirements>
      }>
    ? Output
    : never

type TaskFailure<Task> = Task extends (
  ...args: never[]
) => Effect.Effect<infer _Output, infer Failure, infer _Requirements>
  ? Failure
  : Task extends Readonly<{
        effect: (
          ...args: never[]
        ) => Effect.Effect<infer _Output, infer Failure, infer _Requirements>
      }>
    ? Failure
    : never

type TaskRequirements<Task> = Task extends (
  ...args: never[]
) => Effect.Effect<infer _Output, infer _Failure, infer Requirements>
  ? Requirements
  : Task extends Readonly<{
        effect: (
          ...args: never[]
        ) => Effect.Effect<infer _Output, infer _Failure, infer Requirements>
      }>
    ? Requirements
    : never

type TasksOutputs<Tasks> = Readonly<{ [Name in keyof Tasks]: TaskOutput<Tasks[Name]> }>
type TasksFailure<Tasks> = { [Name in keyof Tasks]: TaskFailure<Tasks[Name]> }[keyof Tasks]
type TasksRequirements<Tasks> = {
  [Name in keyof Tasks]: TaskRequirements<Tasks[Name]>
}[keyof Tasks]

type RaceOutcome<Tasks> = {
  [Name in keyof Tasks]: Readonly<{ winner: Name; value: TaskOutput<Tasks[Name]> }>
}[keyof Tasks]

type RaceSuccessTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Outcome,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (
          args: Readonly<{ state: ByTag<State, Current> }> & Outcome,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type AllInvokeSpec<
  State extends Tagged,
  Current extends TagOf<State>,
  Tasks extends Readonly<Record<string, TaskShape<State, Current>>>,
> = InvokeSpec<TasksRequirements<Tasks>> &
  Readonly<{
    kind: "all"
    description?: string
    concurrency?: number | "unbounded"
    tasks: Tasks
    onSuccess: SuccessTransition<State, Current, TasksOutputs<Tasks>>
    onFailure: FailureTransition<State, Current, TasksFailure<Tasks>>
  }>

type RaceInvokeSpec<
  State extends Tagged,
  Current extends TagOf<State>,
  Tasks extends Readonly<Record<string, TaskShape<State, Current>>>,
> = InvokeSpec<TasksRequirements<Tasks>> &
  Readonly<{
    kind: "race"
    description?: string
    tasks: Tasks
    onSuccess: RaceSuccessTransition<State, Current, RaceOutcome<Tasks>>
    onFailure: FailureTransition<State, Current, TasksFailure<Tasks>>
  }>

/**
 * A machine node that owns one Effect invocation and its outcome transitions.
 *
 * **Details**
 *
 * The invocation starts when the node becomes active and is interrupted when another transition
 * leaves the node. Expected failures follow `onFailure`; defects terminate the machine.
 *
 * @category models
 * @since 0.1.0
 */
export interface InvokeNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Output,
  Failure,
  Requirements,
  RetryError = never,
  RetryEnv = never,
> {
  readonly kind: "invoke"
  readonly tag: Current
  readonly name: string
  readonly description?: string
  readonly source: Source.Reference
  readonly effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
  readonly retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
  readonly onSuccess: SuccessTransition<State, Current, Output>
  readonly onFailure: FailureTransition<State, Current, Failure | RetryError>
  readonly on: EventHandlers<State, Event, Current>
  readonly _Requirements?: Requirements | RetryEnv
}

/**
 * Minimum public shape required to invoke another machine as a child.
 *
 * @category models
 * @since 0.1.0
 */
export interface ChildDefinition {
  readonly id: string
  readonly description?: string
  readonly schemas: Readonly<{
    input: Schema.Top
    state: TaggedSchema
    event: TaggedSchema
  }>
  readonly states: Readonly<Record<string, unknown>>
  readonly nodes: DefinitionMetadata["nodes"]
}

type ChildForward<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  ParentEventTag extends TagOf<Event>,
  ChildEvent extends Tagged,
  ChildEventTag extends TagOf<ChildEvent> = TagOf<ChildEvent>,
> =
  ChildEventTag extends TagOf<ChildEvent>
    ? Readonly<{
        target: ChildEventTag
        description?: string
        map: (
          args: TransitionArgs<State, Event, Current, ParentEventTag>,
        ) => ByTag<ChildEvent, ChildEventTag>
      }>
    : never

/**
 * Parent-event mappings forwarded to a child while its node is active.
 *
 * @category models
 * @since 0.1.0
 */
export type ChildForwarders<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  ChildEvent extends Tagged,
> = Readonly<{
  [ParentEventTag in TagOf<Event>]?: ChildForward<State, Event, Current, ParentEventTag, ChildEvent>
}>

/**
 * A machine node that owns a scoped child-machine instance.
 *
 * **Details**
 *
 * The parent derives the child's input on entry, may forward selected parent events, and resumes
 * through `onComplete`. Leaving the node interrupts the child.
 *
 * **Gotchas**
 *
 * The same parent event cannot both be forwarded and handled as a parent transition in this node.
 *
 * @category models
 * @since 0.1.0
 */
export interface ChildNode<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Child extends ChildDefinition,
> {
  readonly kind: "child"
  readonly tag: Current
  readonly name: string
  readonly description?: string
  readonly source: Source.Reference
  readonly definition: Child
  readonly input: (state: ByTag<State, Current>) => MachineInput<Child>
  readonly forward: ChildForwarders<State, Event, Current, MachineEvent<Child>>
  readonly onComplete: SuccessTransition<State, Current, MachineCompletion<Child>>
  readonly on: EventHandlers<State, Event, Current>
  readonly _Requirements?: MachineRequirements<Child>
}

type RegionSlotKeys<Fields> = {
  [Key in keyof Fields]: NonNullable<Fields[Key]> extends Tagged ? Key : never
}[keyof Fields] &
  string

type SlotOf<
  State extends Tagged,
  Current extends TagOf<State>,
  RegionKey extends keyof ByTag<State, Current>,
> = Extract<ByTag<State, Current>[RegionKey], Tagged>

type RegionTransitionArgs<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  state: ByTag<Slot, RegionTag>
  event: ByTag<Event, EventTag>
  parent: ByTag<State, Current>
}>

type RegionTransition<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  EventTag extends TagOf<Event>,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (
          args: RegionTransitionArgs<State, Event, Current, Slot, RegionTag, EventTag>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionStayUpdate<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  EventTag extends TagOf<Event>,
> = Readonly<{
  stay: (
    args: RegionTransitionArgs<State, Event, Current, Slot, RegionTag, EventTag>,
  ) => FieldsOf<ByTag<Slot, RegionTag>>
}>

type RegionEventHandler<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  EventTag extends TagOf<Event>,
> =
  | RegionTransition<State, Event, Current, Slot, RegionTag, EventTag>
  | IgnoredTransition
  | RegionStayUpdate<State, Event, Current, Slot, RegionTag, EventTag>

type RegionEventHandlers<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
> = Readonly<{
  [EventTag in TagOf<Event>]?: RegionEventHandler<State, Event, Current, Slot, RegionTag, EventTag>
}>

type RegionAfterTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        duration: Duration.Input
        description?: string
        target: Target
        reduce: (
          args: Readonly<{ state: ByTag<Slot, RegionTag>; parent: ByTag<State, Current> }>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionSuccessTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  Value,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (
          args: Readonly<{ state: Slot; parent: ByTag<State, Current>; value: Value }>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionFailureTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  Failure,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (
          args: Readonly<{ state: Slot; parent: ByTag<State, Current>; error: Failure }>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionStateConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
> =
  | Readonly<{
      description?: string
      source?: Source.Reference
      on: RegionEventHandlers<State, Event, Current, Slot, RegionTag>
      after?: RegionAfterTransition<State, Current, Slot, RegionTag>
      invoke?: never
      final?: never
    }>
  | Readonly<{
      description?: string
      source?: Source.Reference
      invoke: InvokeSpecBase
      on?: RegionEventHandlers<State, Event, Current, Slot, RegionTag>
      after?: RegionAfterTransition<State, Current, Slot, RegionTag>
      final?: never
    }>
  | Readonly<{
      description?: string
      source?: Source.Reference
      final: true
      on?: never
      after?: never
      invoke?: never
    }>

type RegionConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  RegionKey extends keyof ByTag<State, Current>,
> = Readonly<{
  description?: string
  states: Readonly<{
    [RegionTag in TagOf<SlotOf<State, Current, RegionKey>>]: RegionStateConfig<
      State,
      Event,
      Current,
      SlotOf<State, Current, RegionKey>,
      RegionTag
    >
  }>
}>

type RegionsConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [RegionKey in RegionSlotKeys<FieldsOf<ByTag<State, Current>>> &
    keyof ByTag<State, Current>]?: RegionConfig<State, Event, Current, RegionKey>
}>

type RegionTreesConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [RegionKey in RegionSlotKeys<FieldsOf<ByTag<State, Current>>> &
    keyof ByTag<State, Current>]?: Readonly<{
    [RegionTag in TagOf<SlotOf<State, Current, RegionKey>>]:
      | RegionEventHandlers<State, Event, Current, SlotOf<State, Current, RegionKey>, RegionTag>
      | RegionStateConfig<State, Event, Current, SlotOf<State, Current, RegionKey>, RegionTag>
  }>
}>

type RegionsCompleteTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (args: Readonly<{ state: ByTag<State, Current> }>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type AtomicNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  description?: string
  source: Source.Reference
  on: EventHandlers<State, Event, Current>
  after?: AfterTransition<State, Current>
  invoke?: never
  regions?: never
  child?: never
  onComplete?: never
  final?: never
}>

type InvokeNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  description?: string
  source: Source.Reference
  invoke: InvokeSpecBase
  on?: EventHandlers<State, Event, Current>
  after?: AfterTransition<State, Current>
  regions?: never
  child?: never
  onComplete?: never
  final?: never
}>

type RegionsNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  description?: string
  source: Source.Reference
  regions: RegionsConfig<State, Event, Current>
  on?: EventHandlers<State, Event, Current>
  onComplete?: RegionsCompleteTransition<State, Current>
  invoke?: never
  after?: never
  child?: never
  final?: never
}>

type FinalNodeConfig = Readonly<{
  description?: string
  source: Source.Reference
  final: true
  on?: never
  invoke?: never
  regions?: never
  after?: never
  child?: never
  onComplete?: never
}>

type ChildNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Child extends ChildDefinition = ChildDefinition,
> = Readonly<{
  description?: string
  source: Source.Reference
  child: Readonly<{
    name: string
    description?: string
    definition: Child
    input: (state: ByTag<State, Current>) => MachineInput<Child>
    forward: ChildForwarders<State, Event, Current, MachineEvent<Child>>
    onComplete: SuccessTransition<State, Current, MachineCompletion<Child>>
  }>
  on?: EventHandlers<State, Event, Current>
  invoke?: never
  regions?: never
  after?: never
  final?: never
  readonly _Requirements?: MachineRequirements<Child>
}>

type StateConfig<State extends Tagged, Event extends Tagged, Current extends TagOf<State>> =
  | AtomicNodeConfig<State, Event, Current>
  | InvokeNodeConfig<State, Event, Current>
  | RegionsNodeConfig<State, Event, Current>
  | FinalNodeConfig
  | Omit<ChildNodeConfig<State, Event, Current>, "_Requirements">

type StatesConfig<State extends Tagged, Event extends Tagged> = Readonly<{
  [Current in TagOf<State>]: StateConfig<State, Event, Current>
}>

type LegacyConfigFromNode<
  State extends Tagged,
  Event extends Tagged,
  Node extends Readonly<{ kind: string; tag: string }>,
> =
  Node extends Readonly<{ kind: "final" }>
    ? FinalNodeConfig
    : AtomicNodeConfig<State, Event, Extract<Node["tag"], TagOf<State>>> &
        (Node extends Readonly<{ _Requirements?: infer Requirements }>
          ? Readonly<{ _Requirements?: Requirements }>
          : unknown)

type LegacyStatesFromNodes<
  State extends Tagged,
  Event extends Tagged,
  Nodes extends ReadonlyArray<NodeUnion<State, Event>>,
> = Readonly<{
  [Node in Nodes[number] as Node["tag"]]: LegacyConfigFromNode<State, Event, Node>
}>

type StateNodeUnion<State extends Tagged, Event extends Tagged> = {
  [Current in TagOf<State>]: StateNode<State, Event, Current>
}[TagOf<State>]

interface InvokeNodeShape<State extends Tagged> {
  readonly kind: "invoke"
  readonly tag: TagOf<State>
  readonly name: string
  readonly source: Source.Reference
}

interface ChildNodeShape<State extends Tagged> {
  readonly kind: "child"
  readonly tag: TagOf<State>
  readonly name: string
  readonly source: Source.Reference
}

type NodeUnion<State extends Tagged, Event extends Tagged> =
  | StateNodeUnion<State, Event>
  | FinalNode<TagOf<State>>
  | InvokeNodeShape<State>
  | ChildNodeShape<State>

/**
 * Immutable, synchronously inspectable definition of a machine's schemas and behavior.
 *
 * **Details**
 *
 * Definitions are the shared input to {@link run}, codec helpers, and graph tooling. Inspecting a
 * definition never executes its initializer, reducers, guards, or Effects.
 *
 * @category models
 * @since 0.1.0
 */
export interface MachineDefinition<
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
> {
  readonly id: string
  readonly description?: string
  readonly schemas: Readonly<{
    input: InputSchema
    state: StateSchema
    event: EventSchema
  }>
  readonly initial: (input: Schema.Schema.Type<InputSchema>) => Schema.Schema.Type<StateSchema>
  readonly states: States
  /** @deprecated Compatibility view for consumers written before keyed definitions. */
  readonly nodes: DefinitionMetadata["nodes"]
}

/**
 * Type-erased machine definition metadata consumed by development tooling.
 *
 * **When to use**
 *
 * Use when inspecting topology without depending on a definition's application-specific types.
 * Prefer the full {@link MachineDefinition} when executing a machine.
 *
 * @category models
 * @since 0.1.0
 */
export interface DefinitionMetadata {
  readonly id: string
  readonly description?: string
  readonly schemas: Readonly<{
    state: TaggedSchema
    event: TaggedSchema
  }>
  readonly states: Readonly<Record<string, unknown>>
  readonly nodes: ReadonlyArray<
    | Readonly<{
        kind: "state"
        tag: string
        source: Source.Reference
        description?: string
        after?: TransitionMetadata & Readonly<{ duration: Duration.Input }>
        on: Readonly<Record<string, HandlerMetadata | undefined>>
      }>
    | Readonly<{
        kind: "final"
        tag: string
        source: Source.Reference
        description?: string
      }>
    | Readonly<{
        kind: "invoke"
        tag: string
        name: string
        description?: string
        source: Source.Reference
        workKind?: "effect" | "all" | "race"
        tasks?: Readonly<Record<string, unknown>>
        concurrency?: number | "unbounded"
        after?: TransitionMetadata & Readonly<{ duration: Duration.Input }>
        retry?: Readonly<{
          name: string
          description?: string
        }>
        on: Readonly<Record<string, HandlerMetadata | undefined>>
        onSuccess: TransitionMetadata | GuardedTransitionMetadata
        onFailure: TransitionMetadata | GuardedTransitionMetadata
      }>
    | Readonly<{
        kind: "child"
        tag: string
        name: string
        description?: string
        source: Source.Reference
        definition: DefinitionMetadata
        forward: Readonly<
          Record<
            string,
            | Readonly<{
                target: string
                description?: string
              }>
            | undefined
          >
        >
        on: Readonly<Record<string, HandlerMetadata | undefined>>
        onComplete: TransitionMetadata | GuardedTransitionMetadata
      }>
    | Readonly<{
        kind: "regions"
        tag: string
        source: Source.Reference
        description?: string
        regions: Readonly<Record<string, unknown>>
        on: Readonly<Record<string, HandlerMetadata | undefined>>
        onComplete?: TransitionMetadata
      }>
  >
}

const normalizeStates = (states: Readonly<Record<string, unknown>>): DefinitionMetadata["nodes"] =>
  Object.entries(states).map(([tag, rawNode]) => {
    const node = rawNode as Readonly<Record<string, unknown>>
    if (typeof node.kind === "string" && typeof node.tag === "string") {
      return node as unknown as DefinitionMetadata["nodes"][number]
    }
    if (node.final === true) {
      return {
        kind: "final",
        tag,
        source: node.source as Source.Reference,
        ...(node.description === undefined ? {} : { description: String(node.description) }),
      }
    }
    if (node.invoke !== undefined) {
      const work = node.invoke as Readonly<Record<string, unknown>>
      return {
        ...work,
        kind: "invoke",
        workKind: work.kind,
        tag,
        source: node.source,
        on: node.on ?? {},
        after: node.after,
      } as unknown as DefinitionMetadata["nodes"][number]
    }
    if (node.regions !== undefined) {
      return {
        kind: "regions",
        tag,
        source: node.source,
        description: node.description,
        regions: node.regions,
        on: node.on ?? {},
        onComplete: node.onComplete,
      } as unknown as DefinitionMetadata["nodes"][number]
    }
    if (node.child !== undefined) {
      const child = node.child as Readonly<Record<string, unknown>>
      return {
        kind: "child",
        tag,
        source: node.source,
        ...child,
        on: node.on ?? {},
      } as unknown as DefinitionMetadata["nodes"][number]
    }
    return {
      kind: "state",
      tag,
      source: node.source,
      description: node.description,
      on: node.on ?? {},
      after: node.after,
    } as unknown as DefinitionMetadata["nodes"][number]
  })

/**
 * Returns the homogeneous tooling view of a definition's canonical keyed states.
 *
 * This is the single deliberate type-erasure boundary shared by the interpreter and tooling.
 * Authoring and public utility types continue to use the exact keyed `states` record.
 *
 * @category converting
 * @since 0.2.0
 */
export const definitionNodes = (definition: DefinitionMetadata): DefinitionMetadata["nodes"] =>
  normalizeStates(definition.states)

declare const ActorIdTypeId: unique symbol
declare const DefinitionPathTypeId: unique symbol

/**
 * Runtime identity of one machine instance within a root execution tree.
 *
 * @category observability
 * @since 0.2.0
 */
export type ActorId = string & Readonly<{ [ActorIdTypeId]: "ActorId" }>

/** @category observability @since 0.2.0 */
export const ActorId = {
  make: (value: string): ActorId => value as ActorId,
} as const

/**
 * Static location of a machine definition within its root definition tree.
 *
 * @category observability
 * @since 0.2.0
 */
export type DefinitionPath = string & Readonly<{ [DefinitionPathTypeId]: "DefinitionPath" }>

/**
 * Lifecycle and machine facts retained by a root execution tree.
 *
 * @category observability
 * @since 0.2.0
 */
export type TreeRecordBody =
  | Readonly<{
      _tag: "ActorStarted"
      machineId: string
      parentActorId?: ActorId
      ownerStateTag?: string
      invocation?: string
      instanceId?: string
    }>
  | Readonly<{
      _tag: "Inspection"
      metadata: InspectionEvent
      event?: unknown
    }>
  | Readonly<{
      _tag: "StateSnapshot"
      state: unknown
    }>
  | Readonly<{
      _tag: "ActorTerminated"
      status: "completed" | "cancelled" | "defected"
    }>

/**
 * One globally ordered fact produced by a machine execution tree.
 *
 * @category observability
 * @since 0.2.0
 */
export interface TreeRecord {
  readonly sequence: number
  readonly actorId: ActorId
  readonly definitionPath: DefinitionPath
  readonly body: TreeRecordBody
}

/**
 * Expected failure while routing an event to an actor in a machine tree.
 *
 * @category errors
 * @since 0.2.0
 */
export class ActorDispatchError extends Data.TaggedError("ActorDispatchError")<{
  readonly actorId: ActorId
  readonly reason: "unknown" | "ended" | "unaccepted"
}> {}

/**
 * Type-erased inspection and dispatch surface shared by every actor under a root machine.
 *
 * @category observability
 * @since 0.2.0
 */
export interface MachineTreeHandle {
  readonly rootActorId: ActorId
  readonly records: Stream.Stream<TreeRecord>
  readonly dispatch: (actorId: ActorId, event: unknown) => Effect.Effect<void, ActorDispatchError>
}

/**
 * Effect-native interface to one scoped running machine instance.
 *
 * **Details**
 *
 * `snapshot` reads the current state, `changes` includes the initial state and later commits,
 * `send` waits until the event is processed, and `completion` waits for a final state or defect.
 * The payload-free `inspection` stream is safe for general tooling; `inspect` opts into projecting
 * event details.
 *
 * **Gotchas**
 *
 * The handle is valid only inside the Scope required by {@link run}. Releasing that Scope
 * interrupts active work and ends the instance.
 *
 * @category models
 * @since 0.1.0
 */
export interface MachineHandle<
  State extends Tagged,
  Event extends Tagged,
  Completion extends State = never,
> {
  readonly actorId: ActorId
  readonly definitionPath: DefinitionPath
  readonly tree: MachineTreeHandle
  readonly snapshot: Effect.Effect<State>
  readonly changes: Stream.Stream<State>
  readonly inspection: Stream.Stream<InspectionEvent>
  inspect<EventDetails>(
    projectEvent: (event: Event) => EventDetails,
  ): Stream.Stream<ProjectedInspectionEvent<EventDetails>>
  readonly completion: Effect.Effect<Completion>
  readonly send: (event: Event) => Effect.Effect<void>
  readonly can: (event: Event) => Effect.Effect<boolean>
}

/**
 * Inspection event union whose received events include caller-projected details.
 *
 * @category observability
 * @since 0.1.0
 */
export type ProjectedInspectionEvent<EventDetails> =
  | Exclude<InspectionEvent, Readonly<{ _tag: "EventReceived" }>>
  | (Extract<InspectionEvent, Readonly<{ _tag: "EventReceived" }>> &
      Readonly<{ details: EventDetails }>)

/**
 * Metadata-only record of a meaningful interpreter decision or lifecycle change.
 *
 * **Details**
 *
 * Application state, event payloads, invocation values, and failures are intentionally omitted.
 * Use `MachineHandle.inspect` to opt into event details with an explicit projection.
 *
 * @category observability
 * @since 0.1.0
 */
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
      branch?: SelectedBranch
      ownerPath?: string
      macrostep?: number
    }>
  | Readonly<{
      _tag: "InvocationRetryScheduled"
      machineId: string
      stateTag: string
      invocation: string
      generation: number
      policy: string
      attempt: number
      delayMillis: number
      ownerPath?: string
      workKind?: "effect" | "all" | "race"
      lanes?: ReadonlyArray<string>
    }>
  | Readonly<{
      _tag: "ChildStarted"
      machineId: string
      stateTag: string
      invocation: string
      instanceId: string
      childDefinitionId: string
      generation: number
    }>
  | Readonly<{
      _tag: "ChildEventForwarded"
      machineId: string
      stateTag: string
      invocation: string
      instanceId: string
      parentEventTag: string
      childEventTag: string
      generation: number
    }>
  | Readonly<{
      _tag: "ChildCompleted"
      machineId: string
      stateTag: string
      invocation: string
      instanceId: string
      generation: number
      branch?: SelectedBranch
    }>
  | Readonly<{
      _tag: "ChildCancelled" | "ChildDefected"
      machineId: string
      stateTag: string
      invocation: string
      instanceId: string
      generation: number
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
  | Readonly<{
      _tag: "MachineCompleted"
      machineId: string
      finalStateTag: string
    }>
  | Readonly<{
      _tag: "EventIgnored"
      machineId: string
      stateTag: string
      eventTag: string
    }>
  | Readonly<{
      _tag: "TimerStarted" | "TimerFired" | "TimerCancelled"
      machineId: string
      stateTag: string
      timer: string
      generation: number
      ownerPath: string
      durationMillis: number
    }>
  | Readonly<{
      _tag: "StaleOutcomeIgnored"
      machineId: string
      stateTag: string
      ownerPath: string
      generation: number
      currentGeneration: number
      outcome: "work-success" | "work-failure" | "work-defect" | "timer" | "completion"
    }>
  | Readonly<{
      _tag:
        | "InvocationStarted"
        | "InvocationSucceeded"
        | "InvocationFailed"
        | "InvocationCancelled"
        | "InvocationDefected"
      machineId: string
      stateTag: string
      invocation: string
      generation: number
      branch?: SelectedBranch
      ownerPath?: string
      workKind?: "effect" | "all" | "race"
      lanes?: ReadonlyArray<string>
    }>

interface InternalInspectionRecord<Event extends Tagged> {
  readonly metadata: InspectionEvent
  readonly event?: Event
}

/**
 * Defect raised when an authored machine definition violates a structural invariant.
 *
 * **Gotchas**
 *
 * Most instances are thrown synchronously by `builder().define`; an invalid initializer result dies
 * in {@link run}. This is a programmer error, not a typed Effect failure.
 *
 * @category errors
 * @since 0.1.0
 */
export class MachineDefinitionDefect extends Error {
  readonly name = "MachineDefinitionDefect"
}

/**
 * Defect raised when a known machine event is not accepted by the live state.
 *
 * **Gotchas**
 *
 * Sending such an event terminates the machine instance. Call `MachineHandle.can` first when the
 * sender cannot guarantee that the event is currently accepted.
 *
 * @category errors
 * @since 0.1.0
 */
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

/**
 * Decoded input type inferred from a machine definition.
 *
 * @category utility types
 * @since 0.1.0
 */
export type MachineInput<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ input: infer InputSchema extends Schema.Top }>
  }>
    ? Schema.Schema.Type<InputSchema>
    : never

/**
 * Decoded state union inferred from a machine definition.
 *
 * @category utility types
 * @since 0.1.0
 */
export type MachineState<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ state: infer StateSchema extends TaggedSchema }>
  }>
    ? Schema.Schema.Type<StateSchema>
    : never

/**
 * Decoded event union inferred from a machine definition.
 *
 * @category utility types
 * @since 0.1.0
 */
export type MachineEvent<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ event: infer EventSchema extends TaggedSchema }>
  }>
    ? Schema.Schema.Type<EventSchema>
    : never

type FinalTags<States> = {
  [Tag in keyof States]: States[Tag] extends Readonly<{ final: true }> ? Tag : never
}[keyof States]

/**
 * Union of final-state values inferred from a machine definition.
 *
 * **Details**
 *
 * Definitions without final nodes produce `never`.
 *
 * @category utility types
 * @since 0.1.0
 */
export type MachineCompletion<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ state: infer StateSchema extends TaggedSchema }>
    states: infer States
  }>
    ? Extract<Schema.Schema.Type<StateSchema>, { _tag: FinalTags<States> }>
    : never

type SpecRequirements<Value> = "_Requirements" extends keyof Value
  ? Value extends Readonly<{ _Requirements?: infer Requirements }>
    ? Exclude<Requirements, undefined>
    : never
  : never

type RegionStatesRequirements<RegionStates> = {
  [Tag in keyof RegionStates]: RegionStates[Tag] extends Readonly<{ invoke: infer Spec }>
    ? SpecRequirements<Spec>
    : never
}[keyof RegionStates]

type RegionTreesRequirements<RegionTrees> = {
  [RegionKey in keyof RegionTrees]: RegionStatesRequirements<NonNullable<RegionTrees[RegionKey]>>
}[keyof RegionTrees]

type CanonicalNodeRequirements<Node> =
  | (Node extends Readonly<{ _Requirements?: infer Requirements }>
      ? Exclude<Requirements, undefined>
      : never)
  | (Node extends Readonly<{ invoke: infer Spec }> ? SpecRequirements<Spec> : never)
  | (Node extends Readonly<{ child: Readonly<{ definition: infer Child }> }>
      ? MachineRequirements<Child>
      : never)
  | (Node extends Readonly<{ regions: infer Regions }>
      ? {
          [RegionKey in keyof Regions]: NonNullable<Regions[RegionKey]> extends Readonly<{
            states: infer RegionStates
          }>
            ? RegionStatesRequirements<RegionStates>
            : never
        }[keyof Regions]
      : never)

type RequirementsFromStates<States> = {
  [Tag in keyof States]: CanonicalNodeRequirements<States[Tag]>
}[keyof States]

/**
 * Effect requirements collected from a definition's invocations and child machines.
 *
 * @category utility types
 * @since 0.1.0
 */
export type MachineRequirements<Definition> =
  Definition extends Readonly<{
    states: infer States
  }>
    ? Exclude<RequirementsFromStates<States>, undefined>
    : never

interface DefinitionWithSchema<Key extends "input" | "state" | "event", Value extends Schema.Top> {
  readonly schemas: Readonly<Record<Key, Value>>
}

interface TransitionMetadata {
  readonly target: string
  readonly description?: string
}

interface GuardedTransitionMetadata {
  readonly branches: ReadonlyArray<
    | Readonly<{
        when: Readonly<{
          name: string
          description?: string
          source?: Source.Reference
        }>
        target: string
        description?: string
      }>
    | Readonly<{
        otherwise: true
        target: string
        description?: string
      }>
  >
}

interface StayMetadata {
  readonly stay: unknown
}

type HandlerMetadata =
  | TransitionMetadata
  | GuardedTransitionMetadata
  | IgnoredTransition
  | StayMetadata

/**
 * Named synchronous decision used by guarded transitions and graph tooling.
 *
 * @category guards
 * @since 0.1.0
 */
export interface NamedGuard<Args> {
  readonly name: string
  readonly description?: string
  readonly guard: (args: Args) => boolean
  readonly source: Source.Reference
}

/**
 * Names synchronous decision logic and captures its declaration callsite for development tooling.
 *
 * **When to use**
 *
 * Use for a guarded transition whose decision should remain identifiable in graphs and inspection
 * output. Guards must be deterministic and may not require Effect services.
 *
 * @category guards
 * @since 0.1.0
 */
export const namedGuard = <Args>(
  config: Readonly<{
    name: string
    description?: string
    guard: (args: Args) => boolean
  }>,
): NamedGuard<Args> => ({ ...config, source: Source.capture() })

/**
 * Decodes unknown input with a machine definition's input Schema.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeInput = <InputSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"input", InputSchema>,
  input: unknown,
) => Schema.decodeUnknownEffect(definition.schemas.input)(input)

/**
 * Encodes a decoded machine input with the definition's input Schema.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeInput = <InputSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"input", InputSchema>,
  input: Schema.Schema.Type<InputSchema>,
) => Schema.encodeEffect(definition.schemas.input)(input)

/**
 * Decodes unknown state with a machine definition's state Schema.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeState = <StateSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"state", StateSchema>,
  input: unknown,
) => Schema.decodeUnknownEffect(definition.schemas.state)(input)

/**
 * Encodes a decoded machine state with the definition's state Schema.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeState = <StateSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"state", StateSchema>,
  input: Schema.Schema.Type<StateSchema>,
) => Schema.encodeEffect(definition.schemas.state)(input)

/**
 * Decodes an unknown event with a machine definition's event Schema.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decodeEvent = <EventSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"event", EventSchema>,
  input: unknown,
) => Schema.decodeUnknownEffect(definition.schemas.event)(input)

/**
 * Encodes a decoded machine event with the definition's event Schema.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encodeEvent = <EventSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"event", EventSchema>,
  input: Schema.Schema.Type<EventSchema>,
) => Schema.encodeEffect(definition.schemas.event)(input)

/**
 * Creates a schema-bound API for authoring a typed machine definition.
 *
 * **Details**
 *
 * The returned `state`, `invoke`, `regions`, `child`, and `final` constructors share the input,
 * state, and event vocabulary. `define` accepts one exhaustive record keyed by state tag and
 * validates targets, branch ordering, stable names, region topology, and declared work without
 * executing authored callbacks.
 *
 * **Gotchas**
 *
 * Invalid topology throws {@link MachineDefinitionDefect} synchronously from `define`.
 *
 * **Example** (Defining a counter)
 *
 * ```ts
 * import * as Schema from "effect/Schema"
 * import * as Machine from "effect-state-machine/Machine"
 *
 * const State = Machine.taggedUnion({
 *   Active: { fields: { count: Schema.Number } },
 * })
 * const Event = Machine.taggedUnion({
 *   Increment: { fields: { amount: Schema.Number } },
 * })
 * const counter = Machine.builder({ input: Schema.Number, state: State, event: Event })
 *
 * const definition = counter.define(
 *   { id: "counter", initial: (count) => ({ _tag: "Active", count }) },
 *   {
 *     Active: counter.state({
 *       Increment: {
 *         target: "Active",
 *         reduce: ({ state, event }) => ({ count: state.count + event.amount }),
 *       },
 *     }),
 *   },
 * )
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const builder = <
  const InputSchema extends Schema.Top,
  const StateSchemaSource extends TaggedSchemaSource,
  const EventSchemaSource extends TaggedSchemaSource,
>(
  schemaSources: Readonly<{
    input: InputSchema
    state: StateSchemaSource
    event: EventSchemaSource
  }>,
) => {
  type StateSchema = NormalizedTaggedSchema<StateSchemaSource>
  type EventSchema = NormalizedTaggedSchema<EventSchemaSource>
  type State = Schema.Schema.Type<StateSchema>
  type Event = Schema.Schema.Type<EventSchema>

  const schemas: Readonly<{
    input: InputSchema
    state: StateSchema
    event: EventSchema
  }> = {
    input: schemaSources.input,
    state: normalizeTaggedSchema(schemaSources.state),
    event: normalizeTaggedSchema(schemaSources.event),
  }

  function state<Current extends TagOf<State>>(
    on: EventHandlers<State, Event, Current>,
    options?: Readonly<{
      description?: string
      after?: AfterTransition<State, Current>
    }>,
  ): AtomicNodeConfig<State, Event, Current>
  /** @deprecated Use the tagless keyed-state overload. */
  function state<Current extends TagOf<State>>(
    tag: Current,
    config: Readonly<{ on?: EventHandlers<State, Event, Current> }>,
  ): StateNode<State, Event, Current>
  function state<Current extends TagOf<State>>(
    first: Current | EventHandlers<State, Event, Current>,
    second?:
      | Readonly<{ on?: EventHandlers<State, Event, Current> }>
      | Readonly<{ description?: string; after?: AfterTransition<State, Current> }>,
  ): StateNode<State, Event, Current> | AtomicNodeConfig<State, Event, Current> {
    const source = Source.capture()
    if (typeof first === "string") {
      const config = second as Readonly<{ on?: EventHandlers<State, Event, Current> }>
      return {
        kind: "state",
        tag: first,
        source,
        on: config.on ?? ({} as EventHandlers<State, Event, Current>),
      }
    }
    const options = second as
      | Readonly<{ description?: string; after?: AfterTransition<State, Current> }>
      | undefined
    return {
      source,
      on: first,
      description: options?.description,
      after: options?.after,
    }
  }

  function final(options?: Readonly<{ description?: string }>): FinalNodeConfig
  /** @deprecated Use the tagless keyed-state overload. */
  function final<Current extends TagOf<State>>(tag: Current): FinalNode<Current>
  function final<Current extends TagOf<State>>(
    value?: Current | Readonly<{ description?: string }>,
  ): FinalNodeConfig | FinalNode<Current> {
    return typeof value === "string"
      ? { kind: "final", tag: value, source: Source.capture() }
      : { final: true, description: value?.description, source: Source.capture() }
  }

  const invokeEffectNew = <
    Current extends TagOf<State>,
    Output,
    Failure,
    Requirements,
    RetryError = never,
    RetryEnv = never,
  >(
    config: Readonly<{
      name: string
      description?: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: SuccessTransition<State, Current, Output>
      onFailure: FailureTransition<State, Current, Failure | RetryError>
    }>,
    on?: EventHandlers<State, Event, Current>,
    options?: Readonly<{ after?: AfterTransition<State, Current> }>,
  ): InvokeNodeConfig<State, Event, Current> &
    Readonly<{
      invoke: EffectInvokeSpec<State, Current, Output, Failure, Requirements, RetryError, RetryEnv>
    }> => ({
    source: Source.capture(),
    invoke: {
      kind: "effect",
      name: config.name,
      description: config.description,
      effect: config.effect,
      retry: config.retry,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
    },
    on,
    after: options?.after,
  })

  function invokeEffect<
    Current extends TagOf<State>,
    Output,
    Failure,
    Requirements,
    RetryError = never,
    RetryEnv = never,
  >(
    config: Readonly<{
      name: string
      description?: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: SuccessTransition<State, Current, Output>
      onFailure: FailureTransition<State, Current, Failure | RetryError>
    }>,
    on?: EventHandlers<State, Event, Current>,
    options?: Readonly<{ after?: AfterTransition<State, Current> }>,
  ): InvokeNodeConfig<State, Event, Current> &
    Readonly<{
      invoke: EffectInvokeSpec<State, Current, Output, Failure, Requirements, RetryError, RetryEnv>
    }>
  /** @deprecated Use the tagless keyed-state overload. */
  function invokeEffect<
    Current extends TagOf<State>,
    Output,
    Failure,
    Requirements,
    RetryError = never,
    RetryEnv = never,
  >(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: SuccessTransition<State, Current, Output>
      onFailure: FailureTransition<State, Current, Failure | RetryError>
      on?: EventHandlers<State, Event, Current>
    }>,
  ): InvokeNode<State, Event, Current, Output, Failure, Requirements, RetryError, RetryEnv>
  function invokeEffect(
    first: string | Readonly<Record<string, unknown>>,
    second?: Readonly<Record<string, unknown>>,
    third?: Readonly<Record<string, unknown>>,
  ): unknown {
    if (typeof first !== "string") {
      return invokeEffectNew(first as never, second as never, third as never)
    }
    const config = second as Readonly<Record<string, unknown>>
    return {
      kind: "invoke",
      tag: first,
      name: config.name,
      description: config.description,
      source: Source.capture(),
      effect: config.effect,
      retry: config.retry,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
      on: config.on ?? {},
    }
  }

  const invokeAll = <
    Current extends TagOf<State>,
    const Tasks extends Readonly<Record<string, TaskShape<State, Current>>>,
  >(
    config: Readonly<{
      name: string
      description?: string
      concurrency?: number | "unbounded"
      tasks: Tasks
      onSuccess: SuccessTransition<State, Current, TasksOutputs<Tasks>>
      onFailure: FailureTransition<State, Current, TasksFailure<Tasks>>
    }>,
    on?: EventHandlers<State, Event, Current>,
    options?: Readonly<{ after?: AfterTransition<State, Current> }>,
  ): InvokeNodeConfig<State, Event, Current> &
    Readonly<{ invoke: AllInvokeSpec<State, Current, Tasks> }> => ({
    source: Source.capture(),
    invoke: {
      kind: "all",
      name: config.name,
      description: config.description,
      concurrency: config.concurrency,
      tasks: config.tasks,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
    },
    on,
    after: options?.after,
  })

  const invokeRace = <
    Current extends TagOf<State>,
    const Tasks extends Readonly<Record<string, TaskShape<State, Current>>>,
  >(
    config: Readonly<{
      name: string
      description?: string
      tasks: Tasks
      onSuccess: RaceSuccessTransition<State, Current, RaceOutcome<Tasks>>
      onFailure: FailureTransition<State, Current, TasksFailure<Tasks>>
    }>,
    on?: EventHandlers<State, Event, Current>,
    options?: Readonly<{ after?: AfterTransition<State, Current> }>,
  ): InvokeNodeConfig<State, Event, Current> &
    Readonly<{ invoke: RaceInvokeSpec<State, Current, Tasks> }> => ({
    source: Source.capture(),
    invoke: {
      kind: "race",
      name: config.name,
      description: config.description,
      tasks: config.tasks,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
    },
    on,
    after: options?.after,
  })

  const invoke = Object.assign(invokeEffect, { all: invokeAll, race: invokeRace })

  const regions = <
    Current extends TagOf<State>,
    const RegionTrees extends RegionTreesConfig<State, Event, Current>,
  >(
    regionTrees: RegionTrees,
    on?: EventHandlers<State, Event, Current>,
    options?: Readonly<{
      description?: string
      onComplete?: RegionsCompleteTransition<State, Current>
    }>,
  ): RegionsNodeConfig<State, Event, Current> &
    Readonly<{ _Requirements?: RegionTreesRequirements<RegionTrees> }> => {
    const source = Source.capture()
    const runtimeTrees = regionTrees as Readonly<
      Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
    >
    return {
      source,
      regions: Object.fromEntries(
        Object.entries(runtimeTrees).map(([key, regionStates]) => [
          key,
          {
            states: Object.fromEntries(
              Object.entries(regionStates).map(([tag, node]) => [
                tag,
                Object.hasOwn(node, "on") ||
                Object.hasOwn(node, "invoke") ||
                Object.hasOwn(node, "final")
                  ? { source, ...node }
                  : { source, on: node },
              ]),
            ),
          },
        ]),
      ) as RegionsConfig<State, Event, Current>,
      on,
      description: options?.description,
      onComplete: options?.onComplete,
    }
  }

  const invokeRegion = <
    Current extends TagOf<State>,
    Slot extends Tagged,
    RegionTag extends TagOf<Slot>,
    Output,
    Failure,
    Requirements,
    RetryError = never,
    RetryEnv = never,
  >(
    config: Readonly<{
      name: string
      description?: string
      effect: (
        state: ByTag<Slot, RegionTag>,
        parent: ByTag<State, Current>,
      ) => Effect.Effect<Output, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: RegionSuccessTransition<State, Current, Slot, Output>
      onFailure: RegionFailureTransition<State, Current, Slot, Failure | RetryError>
    }>,
    on?: RegionEventHandlers<State, Event, Current, Slot, RegionTag>,
    options?: Readonly<{ after?: RegionAfterTransition<State, Current, Slot, RegionTag> }>,
  ): Readonly<{
    source: Source.Reference
    invoke: InvokeSpec<Requirements | RetryEnv> &
      Readonly<{
        kind: "effect"
        name: string
        description?: string
        effect: (
          state: ByTag<Slot, RegionTag>,
          parent: ByTag<State, Current>,
        ) => Effect.Effect<Output, Failure, Requirements>
        retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
        onSuccess: RegionSuccessTransition<State, Current, Slot, Output>
        onFailure: RegionFailureTransition<State, Current, Slot, Failure | RetryError>
      }>
    on?: RegionEventHandlers<State, Event, Current, Slot, RegionTag>
    after?: RegionAfterTransition<State, Current, Slot, RegionTag>
  }> => ({
    source: Source.capture(),
    invoke: {
      kind: "effect",
      name: config.name,
      description: config.description,
      effect: config.effect,
      retry: config.retry,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
    },
    on,
    after: options?.after,
  })

  function child<Current extends TagOf<State>, Child extends ChildDefinition>(
    config: Readonly<{
      name: string
      description?: string
      definition: Child
      input: (state: ByTag<State, Current>) => MachineInput<Child>
      forward?: ChildForwarders<State, Event, Current, MachineEvent<Child>>
      onComplete: SuccessTransition<State, Current, MachineCompletion<Child>>
    }>,
    on?: EventHandlers<State, Event, Current>,
  ): ChildNodeConfig<State, Event, Current, Child>
  /** @deprecated Use the tagless keyed-state overload. */
  function child<Current extends TagOf<State>, Child extends ChildDefinition>(
    tag: Current,
    config: Readonly<{
      name: string
      description?: string
      definition: Child
      input: (state: ByTag<State, Current>) => MachineInput<Child>
      forward?: ChildForwarders<State, Event, Current, MachineEvent<Child>>
      onComplete: SuccessTransition<State, Current, MachineCompletion<Child>>
      on?: EventHandlers<State, Event, Current>
    }>,
  ): ChildNode<State, Event, Current, Child>
  function child(
    first: string | Readonly<Record<string, unknown>>,
    second?: Readonly<Record<string, unknown>>,
  ): unknown {
    const source = Source.capture()
    if (typeof first === "string") {
      const config = second as Readonly<Record<string, unknown>>
      return {
        kind: "child",
        tag: first,
        name: config.name,
        description: config.description,
        source,
        definition: config.definition,
        input: config.input,
        forward: config.forward ?? {},
        onComplete: config.onComplete,
        on: config.on ?? {},
      }
    }
    return {
      source,
      child: {
        name: first.name,
        description: first.description,
        definition: first.definition,
        input: first.input,
        forward: first.forward ?? {},
        onComplete: first.onComplete,
      },
      on: second,
    }
  }

  const define = <const States extends StatesConfig<State, Event>>(
    config: Readonly<{
      id: string
      description?: string
      initial: (input: Schema.Schema.Type<InputSchema>) => State
    }>,
    states: States,
  ): MachineDefinition<InputSchema, StateSchema, EventSchema, States> => {
    const declaredTags = Object.keys(states)
    const schemaTags = Object.keys(schemas.state.cases)
    const missingTags = schemaTags.filter((tag) => !Object.hasOwn(states, tag))
    const extraTags = declaredTags.filter((tag) => !Object.hasOwn(schemas.state.cases, tag))
    if (missingTags.length > 0 || extraTags.length > 0) {
      throw new MachineDefinitionDefect(
        `Machine ${config.id} state keys do not match its schema` +
          `${missingTags.length === 0 ? "" : `; missing ${missingTags.join(", ")}`}` +
          `${extraTags.length === 0 ? "" : `; unknown ${extraTags.join(", ")}`}`,
      )
    }
    if (declaredTags.some((tag) => tag.trim().length === 0)) {
      throw new MachineDefinitionDefect(`Machine ${config.id} declares a blank state tag`)
    }
    const nodes = normalizeStates(states)

    const tags = new Set(Object.keys(states))
    const validateTarget = (
      owner: string,
      transition: unknown,
      allowedTargets: ReadonlySet<string> = tags,
    ): void => {
      if (typeof transition !== "object" || transition === null) return
      const value = transition as Readonly<Record<string, unknown>>
      if (Array.isArray(value.branches)) {
        for (const [index, branch] of value.branches.entries()) {
          const branchValue = branch as Readonly<Record<string, unknown>>
          if (branchValue.otherwise === true && index !== value.branches.length - 1) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} declares a fallback before the final branch in ${owner}`,
            )
          }
          const when = branchValue.when as Readonly<Record<string, unknown>> | undefined
          if (when !== undefined && String(when.name ?? "").trim().length === 0) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} declares a guard without a stable name in ${owner}`,
            )
          }
          validateTarget(owner, branchValue, allowedTargets)
        }
        return
      }
      if (typeof value.target === "string" && !allowedTargets.has(value.target)) {
        throw new MachineDefinitionDefect(
          `Machine ${config.id} targets missing state ${value.target} from ${owner}`,
        )
      }
    }

    for (const node of nodes) {
      const value = node as Readonly<Record<string, unknown>>
      const owner = String(value.tag)
      if (value.kind === "final") {
        const raw = states[owner as keyof States] as Readonly<Record<string, unknown>>
        if (
          ["on", "after", "invoke", "regions", "child", "onComplete"].some(
            (key) => raw[key] !== undefined,
          )
        ) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} final state ${owner} declares owned behavior`,
          )
        }
        continue
      }
      for (const handler of Object.values(
        (value.on as Readonly<Record<string, unknown>> | undefined) ?? {},
      )) {
        validateTarget(owner, handler)
      }
      validateTarget(owner, value.after)
      if (value.kind === "invoke") {
        if (String(value.name ?? "").trim().length === 0) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} declares an invocation without a stable name in ${owner}`,
          )
        }
        const retry = value.retry as Readonly<Record<string, unknown>> | undefined
        if (retry !== undefined && String(retry.name ?? "").trim().length === 0) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} declares a retry policy without a stable name in ${owner}`,
          )
        }
        const tasks = value.tasks as Readonly<Record<string, unknown>> | undefined
        if (
          value.workKind !== "effect" &&
          (tasks === undefined || Object.keys(tasks).length === 0)
        ) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} invocation ${String(value.name)} has no named tasks`,
          )
        }
        if (tasks !== undefined && Object.keys(tasks).some((lane) => lane.trim().length === 0)) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} invocation ${String(value.name)} declares a blank task name`,
          )
        }
        if (
          typeof value.concurrency === "number" &&
          (!Number.isInteger(value.concurrency) || value.concurrency <= 0)
        ) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} invocation ${String(value.name)} has invalid concurrency`,
          )
        }
        validateTarget(owner, value.onSuccess)
        validateTarget(owner, value.onFailure)
      }
      if (value.kind === "child") {
        if (String(value.name ?? "").trim().length === 0) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} declares a child without a stable name in ${owner}`,
          )
        }
        validateTarget(owner, value.onComplete)
      }
      if (value.kind === "regions") {
        validateTarget(owner, value.onComplete)
        const regionSlots = value.regions as Readonly<
          Record<
            string,
            Readonly<{ states: Readonly<Record<string, Readonly<Record<string, unknown>>>> }>
          >
        >
        for (const [slot, region] of Object.entries(regionSlots)) {
          if (slot.trim().length === 0 || Object.keys(region.states).length === 0) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} declares an invalid region slot in ${owner}`,
            )
          }
          const regionTags = new Set(Object.keys(region.states))
          for (const [regionTag, regionNode] of Object.entries(region.states)) {
            const regionOwner = `${owner}/${slot}/${regionTag}`
            if (regionTag.trim().length === 0) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} declares a blank region state in ${owner}/${slot}`,
              )
            }
            if (regionNode.final === true) {
              if (["on", "after", "invoke"].some((key) => regionNode[key] !== undefined)) {
                throw new MachineDefinitionDefect(
                  `Machine ${config.id} final region state ${regionOwner} declares owned behavior`,
                )
              }
              continue
            }
            for (const handler of Object.values(
              (regionNode.on as Readonly<Record<string, unknown>> | undefined) ?? {},
            )) {
              validateTarget(regionOwner, handler, regionTags)
            }
            validateTarget(regionOwner, regionNode.after, regionTags)
            const regionInvoke = regionNode.invoke as Readonly<Record<string, unknown>> | undefined
            if (regionInvoke !== undefined) {
              if (String(regionInvoke.name ?? "").trim().length === 0) {
                throw new MachineDefinitionDefect(
                  `Machine ${config.id} declares region work without a stable name in ${regionOwner}`,
                )
              }
              const retry = regionInvoke.retry as Readonly<Record<string, unknown>> | undefined
              if (retry !== undefined && String(retry.name ?? "").trim().length === 0) {
                throw new MachineDefinitionDefect(
                  `Machine ${config.id} declares region retry without a stable name in ${regionOwner}`,
                )
              }
              validateTarget(regionOwner, regionInvoke.onSuccess, regionTags)
              validateTarget(regionOwner, regionInvoke.onFailure, regionTags)
            }
          }
        }
      }
    }

    return {
      id: config.id,
      description: config.description,
      schemas,
      initial: config.initial,
      states,
      nodes: nodes as DefinitionMetadata["nodes"],
    }
  }

  const make = <const Nodes extends ReadonlyArray<NodeUnion<State, Event>>>(
    config: Readonly<{
      id: string
      description?: string
      initial: (input: Schema.Schema.Type<InputSchema>) => State
      nodes: Nodes
    }>,
  ): MachineDefinition<
    InputSchema,
    StateSchema,
    EventSchema,
    LegacyStatesFromNodes<State, Event, Nodes> & StatesConfig<State, Event>
  > => {
    // Same erasure boundary as the interpreter: validation only needs the homogeneous node shape.
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
      if (node.kind === "final") continue
      for (const handler of Object.values(node.on)) {
        if (handler === undefined || "ignore" in handler || "stay" in handler) continue
        if (!("branches" in handler)) {
          if (!tags.has(handler.target)) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} targets missing state ${handler.target}`,
            )
          }
          continue
        }
        for (const [index, branch] of handler.branches.entries()) {
          if ("otherwise" in branch) {
            if (index !== handler.branches.length - 1) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} declares a fallback before the final branch`,
              )
            }
          } else if (branch.when.name.trim().length === 0) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} declares a guard without a stable name`,
            )
          }
          if (!tags.has(branch.target)) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} targets missing state ${branch.target}`,
            )
          }
        }
      }
      if (node.kind === "invoke") {
        if (node.name.trim().length === 0) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} declares an invocation without a stable name`,
          )
        }
        if (node.retry !== undefined && node.retry.name.trim().length === 0) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} declares a retry policy without a stable name`,
          )
        }
        for (const outcomeHandler of [node.onSuccess, node.onFailure]) {
          if (!("branches" in outcomeHandler)) {
            if (!tags.has(outcomeHandler.target)) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} targets missing state ${outcomeHandler.target}`,
              )
            }
            continue
          }
          for (const [index, outcome] of outcomeHandler.branches.entries()) {
            if ("otherwise" in outcome) {
              if (index !== outcomeHandler.branches.length - 1) {
                throw new MachineDefinitionDefect(
                  `Machine ${config.id} declares an outcome fallback before the final branch`,
                )
              }
            } else if (outcome.when.name.trim().length === 0) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} declares an outcome guard without a stable name`,
              )
            }
            if (!tags.has(outcome.target)) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} targets missing state ${outcome.target}`,
              )
            }
          }
        }
      }
      if (node.kind === "child") {
        if (node.name.trim().length === 0) {
          throw new MachineDefinitionDefect(
            `Machine ${config.id} declares a child invocation without a stable name`,
          )
        }
        for (const [eventTag, forwarded] of Object.entries(node.forward)) {
          if (forwarded === undefined) continue
          if (node.on[eventTag] !== undefined) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} both forwards and transitions on ${eventTag} in ${node.tag}`,
            )
          }
          if (node.definition.schemas.event.cases[forwarded.target] === undefined) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} forwards ${eventTag} to missing child event ${forwarded.target}`,
            )
          }
        }
        const outcomeHandler = node.onComplete
        if (!("branches" in outcomeHandler)) {
          if (!tags.has(outcomeHandler.target)) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} targets missing state ${outcomeHandler.target}`,
            )
          }
        } else {
          for (const [index, outcome] of outcomeHandler.branches.entries()) {
            if ("otherwise" in outcome) {
              if (index !== outcomeHandler.branches.length - 1) {
                throw new MachineDefinitionDefect(
                  `Machine ${config.id} declares a child completion fallback before the final branch`,
                )
              }
            } else if (outcome.when.name.trim().length === 0) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} declares a child completion guard without a stable name`,
              )
            }
            if (!tags.has(outcome.target)) {
              throw new MachineDefinitionDefect(
                `Machine ${config.id} targets missing state ${outcome.target}`,
              )
            }
          }
        }
      }
    }

    return {
      id: config.id,
      description: config.description,
      schemas,
      initial: config.initial,
      states: Object.fromEntries(
        config.nodes.map((node) => [node.tag, node]),
      ) as LegacyStatesFromNodes<State, Event, Nodes> & StatesConfig<State, Event>,
      nodes: config.nodes as DefinitionMetadata["nodes"],
    }
  }

  return {
    child,
    define,
    final,
    guard: namedGuard,
    invoke,
    make,
    region: { invoke: invokeRegion },
    regions,
    state,
  }
}

interface RuntimeTransition<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly description?: string
  readonly reduce: (
    args: Readonly<{ state: State; event: Event }>,
  ) => Readonly<Record<string, unknown>>
}

interface RuntimeStay<State extends Tagged, Event extends Tagged> {
  readonly stay: (
    args: Readonly<{ state: State; event: Event }>,
  ) => Readonly<Record<string, unknown>>
}

interface RuntimeWhenBranch<State extends Tagged, Event extends Tagged>
  extends RuntimeTransition<State, Event> {
  readonly when: Readonly<{
    name: string
    description?: string
    guard: (args: Readonly<{ state: State; event: Event }>) => boolean
  }>
}

interface RuntimeOtherwiseBranch<State extends Tagged, Event extends Tagged>
  extends RuntimeTransition<State, Event> {
  readonly otherwise: true
}

interface RuntimeGuardedTransition<State extends Tagged, Event extends Tagged> {
  readonly branches: ReadonlyArray<
    RuntimeWhenBranch<State, Event> | RuntimeOtherwiseBranch<State, Event>
  >
}

type RuntimeEventHandler<State extends Tagged, Event extends Tagged> =
  | RuntimeTransition<State, Event>
  | RuntimeGuardedTransition<State, Event>
  | IgnoredTransition
  | RuntimeStay<State, Event>

interface RuntimeOutcomeTransition<State extends Tagged, Value, Key extends "value" | "error"> {
  readonly target: string
  readonly description?: string
  readonly reduce: (
    args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>,
  ) => Readonly<Record<string, unknown>>
}

interface RuntimeOutcomeWhenBranch<State extends Tagged, Value, Key extends "value" | "error">
  extends RuntimeOutcomeTransition<State, Value, Key> {
  readonly when: Readonly<{
    name: string
    description?: string
    guard: (args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>) => boolean
  }>
}

interface RuntimeOutcomeOtherwiseBranch<State extends Tagged, Value, Key extends "value" | "error">
  extends RuntimeOutcomeTransition<State, Value, Key> {
  readonly otherwise: true
}

interface RuntimeGuardedOutcomeTransition<
  State extends Tagged,
  Value,
  Key extends "value" | "error",
> {
  readonly branches: ReadonlyArray<
    RuntimeOutcomeWhenBranch<State, Value, Key> | RuntimeOutcomeOtherwiseBranch<State, Value, Key>
  >
}

type RuntimeOutcomeHandler<State extends Tagged, Value, Key extends "value" | "error"> =
  | RuntimeOutcomeTransition<State, Value, Key>
  | RuntimeGuardedOutcomeTransition<State, Value, Key>

type RuntimeChildDefinition = DefinitionMetadata &
  MachineDefinition<
    Schema.Top,
    TaggedSchema,
    TaggedSchema,
    Readonly<Record<string, StateConfig<Tagged, Tagged, string>>>
  >

interface RuntimeForward<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly description?: string
  readonly map: (args: Readonly<{ state: State; event: Event }>) => Tagged
}

interface RuntimeAfter<State extends Tagged> {
  readonly duration: Duration.Input
  readonly description?: string
  readonly target: string
  readonly reduce: (args: Readonly<{ state: State }>) => Readonly<Record<string, unknown>>
}

type RuntimeTask<State extends Tagged, Requirements> =
  | ((state: State) => Effect.Effect<unknown, unknown, Requirements>)
  | Readonly<{
      description?: string
      effect: (state: State) => Effect.Effect<unknown, unknown, Requirements>
    }>

interface RuntimeRegionTransition<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly description?: string
  readonly reduce: (
    args: Readonly<{ state: Tagged; event: Event; parent: State }>,
  ) => Readonly<Record<string, unknown>>
}

interface RuntimeRegionStay<State extends Tagged, Event extends Tagged> {
  readonly stay: (
    args: Readonly<{ state: Tagged; event: Event; parent: State }>,
  ) => Readonly<Record<string, unknown>>
}

type RuntimeRegionHandler<State extends Tagged, Event extends Tagged> =
  | RuntimeRegionTransition<State, Event>
  | RuntimeRegionStay<State, Event>
  | IgnoredTransition

interface RuntimeRegionOutcome<State extends Tagged, Key extends "value" | "error"> {
  readonly target: string
  readonly description?: string
  readonly reduce: (
    args: Readonly<{ state: Tagged; parent: State }> & Readonly<Record<Key, unknown>>,
  ) => Readonly<Record<string, unknown>>
}

interface RuntimeRegionNode<State extends Tagged, Event extends Tagged, Requirements> {
  readonly source?: Source.Reference
  readonly description?: string
  readonly final?: true
  readonly on?: Readonly<Record<string, RuntimeRegionHandler<State, Event> | undefined>>
  readonly after?: Readonly<{
    duration: Duration.Input
    target: string
    reduce: (args: Readonly<{ state: Tagged; parent: State }>) => Readonly<Record<string, unknown>>
  }>
  readonly invoke?: Readonly<{
    kind: "effect"
    name: string
    effect: (state: Tagged, parent: State) => Effect.Effect<unknown, unknown, Requirements>
    retry?: Readonly<{
      name: string
      schedule: Schedule.Schedule<unknown, unknown, unknown, Requirements>
    }>
    onSuccess: RuntimeRegionOutcome<State, "value">
    onFailure: RuntimeRegionOutcome<State, "error">
  }>
}

interface RuntimeRegion<State extends Tagged, Event extends Tagged, Requirements> {
  readonly states: Readonly<Record<string, RuntimeRegionNode<State, Event, Requirements>>>
}

interface RuntimeRegionsComplete<State extends Tagged> {
  readonly target: string
  readonly description?: string
  readonly reduce: (args: Readonly<{ state: State }>) => Readonly<Record<string, unknown>>
}

type RuntimeNode<State extends Tagged, Event extends Tagged, Requirements = unknown> =
  | Readonly<{
      kind: "state"
      tag: string
      on: Readonly<Record<string, RuntimeEventHandler<State, Event> | undefined>>
      after?: RuntimeAfter<State>
    }>
  | Readonly<{
      kind: "regions"
      tag: string
      regions: Readonly<Record<string, RuntimeRegion<State, Event, Requirements>>>
      on: Readonly<Record<string, RuntimeEventHandler<State, Event> | undefined>>
      onComplete?: RuntimeRegionsComplete<State>
    }>
  | Readonly<{
      kind: "child"
      tag: string
      name: string
      description?: string
      definition: RuntimeChildDefinition
      input: (state: State) => unknown
      forward: Readonly<Record<string, RuntimeForward<State, Event> | undefined>>
      onComplete: RuntimeOutcomeHandler<State, Tagged, "value">
      on: Readonly<Record<string, RuntimeEventHandler<State, Event> | undefined>>
      after?: RuntimeAfter<State>
    }>
  | Readonly<{
      kind: "final"
      tag: string
    }>
  | Readonly<{
      kind: "invoke"
      tag: string
      workKind?: "effect" | "all" | "race"
      name: string
      description?: string
      effect?: (state: State) => Effect.Effect<unknown, unknown, Requirements>
      tasks?: Readonly<Record<string, RuntimeTask<State, Requirements>>>
      concurrency?: number | "unbounded"
      retry?: Readonly<{
        name: string
        description?: string
        schedule: Schedule.Schedule<unknown, unknown, unknown, Requirements>
      }>
      onSuccess: RuntimeOutcomeHandler<State, unknown, "value">
      onFailure: RuntimeOutcomeHandler<State, unknown, "error">
      on: Readonly<Record<string, RuntimeEventHandler<State, Event> | undefined>>
      after?: RuntimeAfter<State>
    }>

interface ExternalEnvelope<Event extends Tagged> {
  readonly kind: "external"
  readonly event: Event
  readonly reply: Deferred.Deferred<void>
}

type InvocationEnvelope = Readonly<{
  kind: "invocation-success"
  stateTag: string
  generation: number
  value: unknown
}>

type TimerEnvelope = Readonly<{
  kind: "timer"
  stateTag: string
  generation: number
}>

type RegionEnvelope =
  | Readonly<{
      kind: "region-success"
      stateTag: string
      generation: number
      slot: string
      regionTag: string
      slotGeneration: number
      value: unknown
    }>
  | Readonly<{
      kind: "region-failure"
      stateTag: string
      generation: number
      slot: string
      regionTag: string
      slotGeneration: number
      value: unknown
    }>
  | Readonly<{
      kind: "region-defect"
      stateTag: string
      generation: number
      slot: string
      regionTag: string
      slotGeneration: number
      cause: Cause.Cause<never>
    }>
  | Readonly<{
      kind: "region-timer"
      stateTag: string
      generation: number
      slot: string
      regionTag: string
      slotGeneration: number
    }>
  | Readonly<{
      kind: "regions-complete"
      stateTag: string
      generation: number
    }>
  | Readonly<{
      kind: "invocation-failure"
      stateTag: string
      generation: number
      error: unknown
    }>
  | Readonly<{
      kind: "invocation-defect"
      stateTag: string
      generation: number
      cause: Cause.Cause<never>
    }>

type ChildEnvelope =
  | Readonly<{
      kind: "child-complete"
      stateTag: string
      generation: number
      invocation: string
      instanceId: string
      value: Tagged
    }>
  | Readonly<{
      kind: "child-defect"
      stateTag: string
      generation: number
      invocation: string
      instanceId: string
      cause: Cause.Cause<never>
    }>

type Envelope<Event extends Tagged> =
  | ExternalEnvelope<Event>
  | InvocationEnvelope
  | ChildEnvelope
  | TimerEnvelope
  | RegionEnvelope

interface ActiveChild {
  readonly stateTag: string
  readonly generation: number
  readonly invocation: string
  readonly instanceId: string
  readonly actorId: ActorId
  readonly scope: Scope.Closeable
  readonly handle: MachineHandle<Tagged, Tagged, Tagged>
}

/**
 * Guard or fallback branch selected while processing a transition.
 *
 * @category observability
 * @since 0.1.0
 */
export type SelectedBranch =
  | Readonly<{
      kind: "guard"
      index: number
      name: string
    }>
  | Readonly<{
      kind: "otherwise"
      index: number
    }>

type SelectedHandler<State extends Tagged, Event extends Tagged> =
  | Readonly<{
      kind: "transition"
      transition: RuntimeTransition<State, Event>
      branch?: SelectedBranch
    }>
  | Readonly<{
      kind: "ignore"
    }>
  | Readonly<{
      kind: "stay"
      update: RuntimeStay<State, Event>
    }>

const selectHandler = <State extends Tagged, Event extends Tagged>(
  handler: RuntimeEventHandler<State, Event> | undefined,
  state: State,
  event: Event,
): SelectedHandler<State, Event> | undefined => {
  if (handler === undefined) return undefined
  if ("ignore" in handler) return { kind: "ignore" }
  if ("stay" in handler) return { kind: "stay", update: handler }
  if (!("branches" in handler)) {
    return { kind: "transition", transition: handler }
  }

  for (const [index, branch] of handler.branches.entries()) {
    if ("otherwise" in branch) {
      return {
        kind: "transition",
        transition: branch,
        branch: { kind: "otherwise", index },
      }
    }
    if (branch.when.guard({ state, event })) {
      return {
        kind: "transition",
        transition: branch,
        branch: { kind: "guard", index, name: branch.when.name },
      }
    }
  }
  return undefined
}

interface SelectedOutcome<State extends Tagged, Value, Key extends "value" | "error"> {
  readonly transition: RuntimeOutcomeTransition<State, Value, Key>
  readonly branch?: SelectedBranch
}

const selectOutcome = <State extends Tagged, Value, Key extends "value" | "error">(
  handler: RuntimeOutcomeHandler<State, Value, Key>,
  args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>,
): SelectedOutcome<State, Value, Key> | undefined => {
  if (!("branches" in handler)) return { transition: handler }

  for (const [index, branch] of handler.branches.entries()) {
    if ("otherwise" in branch) {
      return {
        transition: branch,
        branch: { kind: "otherwise", index },
      }
    }
    if (branch.when.guard(args)) {
      return {
        transition: branch,
        branch: { kind: "guard", index, name: branch.when.name },
      }
    }
  }
  return undefined
}

interface ActorAdapter {
  readonly definitionPath: DefinitionPath
  readonly can: (event: unknown) => Effect.Effect<boolean>
  readonly send: (event: unknown) => Effect.Effect<void>
}

type ActorRegistryEntry =
  | Readonly<{ status: "live"; adapter: ActorAdapter }>
  | Readonly<{ status: "ended"; definitionPath: DefinitionPath }>

interface TreeRuntime {
  readonly handle: MachineTreeHandle
  readonly allocateActor: Effect.Effect<ActorId>
  readonly append: (
    actorId: ActorId,
    definitionPath: DefinitionPath,
    body: TreeRecordBody,
  ) => Effect.Effect<TreeRecord>
  readonly register: (actorId: ActorId, adapter: ActorAdapter) => Effect.Effect<void>
  readonly terminate: (
    actorId: ActorId,
    definitionPath: DefinitionPath,
    status: "completed" | "cancelled" | "defected",
  ) => Effect.Effect<void>
}

interface ActorParent {
  readonly actorId: ActorId
  readonly ownerStateTag: string
  readonly invocation: string
  readonly instanceId: string
}

interface ActorContext {
  readonly runtime: TreeRuntime
  readonly actorId: ActorId
  readonly definitionPath: DefinitionPath
  readonly parent?: ActorParent
}

const makeActorId = (sequence: number): ActorId => `actor:${sequence}` as ActorId

const rootDefinitionPath = "root" as DefinitionPath

const childDefinitionPath = (
  parent: DefinitionPath,
  ownerStateTag: string,
  invocation: string,
): DefinitionPath =>
  `${parent}/${encodeURIComponent(ownerStateTag)}:${encodeURIComponent(invocation)}` as DefinitionPath

/**
 * Constructors for the canonical structural paths shared by runtime actors and development tools.
 *
 * @category observability
 * @since 0.2.0
 */
export const DefinitionPath = {
  root: rootDefinitionPath,
  child: childDefinitionPath,
  make: (value: string): DefinitionPath => value as DefinitionPath,
} as const

const makeTreeRuntime = (): Effect.Effect<TreeRuntime> =>
  Effect.gen(function* () {
    const rootActorId = makeActorId(0)
    const actorSequence = yield* Ref.make(1)
    const journal = yield* SubscriptionRef.make<ReadonlyArray<TreeRecord>>([])
    const registry = yield* Ref.make<ReadonlyMap<ActorId, ActorRegistryEntry>>(new Map())

    const append: TreeRuntime["append"] = Effect.fnUntraced(
      function* (actorId, definitionPath, body) {
        return yield* SubscriptionRef.modify(journal, (records) => {
          const record: TreeRecord = {
            sequence: records.length,
            actorId,
            definitionPath,
            body,
          }
          return [record, [...records, record]]
        })
      },
    )

    const register: TreeRuntime["register"] = Effect.fnUntraced(function* (actorId, adapter) {
      yield* Ref.update(registry, (entries) =>
        new Map(entries).set(actorId, { status: "live", adapter }),
      )
    })

    const terminate: TreeRuntime["terminate"] = Effect.fnUntraced(
      function* (actorId, definitionPath, status) {
        yield* append(actorId, definitionPath, { _tag: "ActorTerminated", status })
        yield* Ref.update(registry, (entries) =>
          new Map(entries).set(actorId, { status: "ended", definitionPath }),
        )
      },
    )

    const dispatch: MachineTreeHandle["dispatch"] = Effect.fnUntraced(function* (actorId, event) {
      const entry = (yield* Ref.get(registry)).get(actorId)
      if (entry === undefined) {
        return yield* new ActorDispatchError({ actorId, reason: "unknown" })
      }
      if (entry.status === "ended") {
        return yield* new ActorDispatchError({ actorId, reason: "ended" })
      }
      if (!(yield* entry.adapter.can(event))) {
        return yield* new ActorDispatchError({ actorId, reason: "unaccepted" })
      }
      return yield* entry.adapter.send(event)
    })

    const records = SubscriptionRef.changes(journal).pipe(
      Stream.mapAccum(
        () => 0,
        (seen, retained) => [retained.length, retained.slice(seen)],
      ),
    )

    return {
      handle: { rootActorId, records, dispatch },
      allocateActor: Ref.getAndUpdate(actorSequence, (sequence) => sequence + 1).pipe(
        Effect.map(makeActorId),
      ),
      append,
      register,
      terminate,
    }
  })

// Stays an annotated dual over Effect.gen instead of Effect.fnUntraced: run is generic and
// self-recursive (startChild runs child definitions), so the generator form cannot carry the
// pinned public signature without circular inference or new casts.
type RunEffect<
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
> = Effect.Effect<
  MachineHandle<
    Schema.Schema.Type<StateSchema>,
    Schema.Schema.Type<EventSchema>,
    Extract<Schema.Schema.Type<StateSchema>, { _tag: FinalTags<States> }>
  >,
  never,
  Scope.Scope | Exclude<RequirementsFromStates<States>, undefined>
>

/**
 * Starts a scoped machine instance and returns its Effect-native handle.
 *
 * **Details**
 *
 * The initializer runs once, external events and concurrent completions are serialized through a
 * single queue, and invocation requirements remain in the returned Effect environment. Entering a
 * final node resolves `completion`, interrupts owned work, and ends the state-change stream.
 * Supports both `run(definition, input)` and `pipe(definition, run(input))`.
 *
 * **Gotchas**
 *
 * A missing initial node dies with {@link MachineDefinitionDefect}. Sending an event rejected by
 * the live state dies with {@link ProtocolDefect}; expected invocation failures instead follow the
 * definition's `onFailure` transition.
 *
 * @see {@link MachineHandle} for the running instance API.
 * @category running
 * @since 0.1.0
 */
export const run: {
  <const Input>(input: Input): <
    InputSchema extends Schema.Top,
    StateSchema extends TaggedSchema,
    EventSchema extends TaggedSchema,
    States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
  >(
    definition: MachineDefinition<InputSchema, StateSchema, EventSchema, States> &
      (Input extends Schema.Schema.Type<InputSchema> ? unknown : never),
  ) => RunEffect<StateSchema, EventSchema, States>
  <
    InputSchema extends Schema.Top,
    StateSchema extends TaggedSchema,
    EventSchema extends TaggedSchema,
    States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
  >(
    definition: MachineDefinition<InputSchema, StateSchema, EventSchema, States>,
    input: Schema.Schema.Type<InputSchema>,
  ): RunEffect<StateSchema, EventSchema, States>
} = Fn.dual(2, <
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
>(
  definition: MachineDefinition<InputSchema, StateSchema, EventSchema, States>,
  input: Schema.Schema.Type<InputSchema>,
): RunEffect<StateSchema, EventSchema, States> =>
  Effect.gen(function* () {
    const runtime = yield* makeTreeRuntime()
    return yield* runActor(definition, input, {
      runtime,
      actorId: runtime.handle.rootActorId,
      definitionPath: rootDefinitionPath,
    })
  }))

const runActor = <
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
>(
  definition: MachineDefinition<InputSchema, StateSchema, EventSchema, States>,
  input: Schema.Schema.Type<InputSchema>,
  actorContext: ActorContext,
): Effect.Effect<
  MachineHandle<
    Schema.Schema.Type<StateSchema>,
    Schema.Schema.Type<EventSchema>,
    Extract<Schema.Schema.Type<StateSchema>, { _tag: FinalTags<States> }>
  >,
  never,
  Scope.Scope | Exclude<RequirementsFromStates<States>, undefined>
> =>
  Effect.gen(function* () {
    type State = Schema.Schema.Type<StateSchema>
    type Event = Schema.Schema.Type<EventSchema>
    type Completion = Extract<State, { _tag: FinalTags<States> }>
    type Requirements = Exclude<RequirementsFromStates<States>, undefined>

    const { runtime: treeRuntime, actorId, definitionPath, parent: actorParent } = actorContext

    const environment = yield* Effect.context<Requirements>()
    const parentScope = yield* Scope.Scope
    const validateState = (candidate: unknown): Effect.Effect<State> =>
      Schema.decodeUnknownEffect(
        definition.schemas.state as TaggedSchema &
          Readonly<{ Type: State; DecodingServices: never }>,
      )(candidate).pipe(
        Effect.mapError(
          (error) =>
            new MachineDefinitionDefect(
              `Machine ${definition.id} produced invalid state: ${String(error)}`,
            ),
        ),
        Effect.orDie,
      )
    const initial = yield* validateState(definition.initial(input))
    if (!Object.hasOwn(definition.states, initial._tag)) {
      return yield* Effect.die(
        new MachineDefinitionDefect(
          `Machine ${definition.id} initialized to missing state ${initial._tag}`,
        ),
      )
    }

    const stateRef = yield* SubscriptionRef.make(initial)
    const inbox = yield* Queue.unbounded<Envelope<Event>>()
    const inspectionRef = yield* SubscriptionRef.make<
      ReadonlyArray<InternalInspectionRecord<Event>>
    >([])
    const terminated = yield* Deferred.make<void>()
    const completion = yield* Deferred.make<Completion>()
    const status = yield* Ref.make<"Running" | "Completed" | "Defected">("Running")
    const activeFibers = yield* FiberMap.make<string, void, never>()
    // The public builder proves this shape. definitionNodes is the one erasure boundary where
    // exact keyed states become a homogeneous interpreter/tooling view.
    const runtimeNodes = definitionNodes(definition) as ReadonlyArray<
      RuntimeNode<State, Event, Requirements>
    >
    const nodes = new Map(runtimeNodes.map((node) => [node.tag, node]))
    const finalTags = new Set(
      runtimeNodes.flatMap((node) => (node.kind === "final" ? [node.tag] : [])),
    )
    let generation = 0
    const regionGenerations = new Map<string, number>()
    let childInstanceSequence = 0
    let activeChild: ActiveChild | undefined

    const emit = (metadata: InspectionEvent, event?: Event) =>
      SubscriptionRef.update(inspectionRef, (events) => [
        ...events,
        { metadata, ...(event === undefined ? {} : { event }) },
      ]).pipe(
        Effect.andThen(
          treeRuntime.append(actorId, definitionPath, {
            _tag: "Inspection",
            metadata,
            ...(event === undefined ? {} : { event }),
          }),
        ),
        Effect.asVoid,
      )

    const inspection = <EventDetails>(
      projectEvent?: (event: Event) => EventDetails,
    ): Stream.Stream<InspectionEvent | ProjectedInspectionEvent<EventDetails>> =>
      SubscriptionRef.changes(inspectionRef).pipe(
        Stream.mapAccum(
          () => 0,
          (seen, records) => [
            records.length,
            records
              .slice(seen)
              .map((record) =>
                projectEvent === undefined || record.event === undefined
                  ? record.metadata
                  : { ...record.metadata, details: projectEvent(record.event) },
              ),
          ],
        ),
      )

    const startInvocation: (state: State) => Effect.Effect<void> = Effect.fnUntraced(function* (
      state: State,
    ) {
      const node = nodes.get(state._tag)
      if (node?.kind !== "invoke") return

      const invocationGeneration = generation
      yield* emit({
        _tag: "InvocationStarted",
        machineId: definition.id,
        stateTag: state._tag,
        invocation: node.name,
        generation: invocationGeneration,
        ownerPath: state._tag,
        workKind: node.workKind ?? "effect",
        ...(node.tasks === undefined ? {} : { lanes: Object.keys(node.tasks) }),
      })

      const workKind = node.workKind ?? "effect"
      const operation = (() => {
        if (workKind === "effect") {
          if (node.effect === undefined) {
            return Effect.die(
              new MachineDefinitionDefect(
                `Machine ${definition.id} invocation ${node.name} has no Effect`,
              ),
            )
          }
          return node.effect(state)
        }

        const tasks = node.tasks ?? {}
        const entries = Object.entries(tasks)
        if (entries.length === 0) {
          return Effect.die(
            new MachineDefinitionDefect(
              `Machine ${definition.id} invocation ${node.name} has no tasks`,
            ),
          )
        }
        const effects = Object.fromEntries(
          entries.map(([lane, task]) => {
            const laneEffect = typeof task === "function" ? task(state) : task.effect(state)
            return [lane, laneEffect]
          }),
        ) as Readonly<Record<string, Effect.Effect<unknown, unknown, Requirements>>>
        if (workKind === "all") {
          return Effect.all(effects, { concurrency: node.concurrency ?? "unbounded" })
        }
        return Effect.raceAll(
          Object.entries(effects).map(([winner, effect]) =>
            Effect.map(effect, (value) => ({ winner, value })),
          ),
        )
      })()
      const retry = node.retry
      const retryingOperation =
        retry === undefined
          ? operation
          : Effect.retry(
              operation,
              retry.schedule.pipe(
                Schedule.tap((metadata) =>
                  emit({
                    _tag: "InvocationRetryScheduled",
                    machineId: definition.id,
                    stateTag: state._tag,
                    invocation: node.name,
                    generation: invocationGeneration,
                    policy: retry.name,
                    attempt: metadata.attempt,
                    delayMillis: Duration.toMillis(metadata.duration),
                    ownerPath: state._tag,
                    workKind,
                    ...(node.tasks === undefined ? {} : { lanes: Object.keys(node.tasks) }),
                  }),
                ),
              ),
            )

      const invocation = retryingOperation.pipe(
        Effect.provideContext(environment),
        Effect.matchEffect({
          onFailure: (error) =>
            Queue.offer(inbox, {
              kind: "invocation-failure" as const,
              stateTag: state._tag,
              generation: invocationGeneration,
              error,
            }).pipe(Effect.asVoid),
          onSuccess: (value) =>
            Queue.offer(inbox, {
              kind: "invocation-success" as const,
              stateTag: state._tag,
              generation: invocationGeneration,
              value,
            }).pipe(Effect.asVoid),
        }),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
            ? emit({
                _tag: "InvocationCancelled",
                machineId: definition.id,
                stateTag: state._tag,
                invocation: node.name,
                generation: invocationGeneration,
                ownerPath: state._tag,
                workKind,
                ...(node.tasks === undefined ? {} : { lanes: Object.keys(node.tasks) }),
              })
            : Effect.void,
        ),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void
          }
          return Queue.offer(inbox, {
            kind: "invocation-defect" as const,
            stateTag: state._tag,
            generation: invocationGeneration,
            cause,
          }).pipe(Effect.asVoid)
        }),
      )

      yield* FiberMap.run(activeFibers, "work")(invocation)
    })

    const startChild: (state: State) => Effect.Effect<void> = Effect.fnUntraced(function* (
      state: State,
    ) {
      const node = nodes.get(state._tag)
      if (node?.kind !== "child") return

      const childScope = yield* Scope.make()
      yield* Scope.addFinalizer(parentScope, Scope.close(childScope, Exit.void))
      const childGeneration = generation
      const instanceId = `${definition.id}:${node.name}:${++childInstanceSequence}`
      const childActorId = yield* treeRuntime.allocateActor
      const childHandle = yield* runActor(node.definition, node.input(state), {
        runtime: treeRuntime,
        actorId: childActorId,
        definitionPath: childDefinitionPath(definitionPath, state._tag, node.name),
        parent: {
          actorId,
          ownerStateTag: state._tag,
          invocation: node.name,
          instanceId,
        },
      }).pipe(Effect.provideService(Scope.Scope, childScope), Effect.provideContext(environment))
      activeChild = {
        stateTag: state._tag,
        generation: childGeneration,
        invocation: node.name,
        instanceId,
        actorId: childActorId,
        scope: childScope,
        handle: childHandle,
      }

      yield* emit({
        _tag: "ChildStarted",
        machineId: definition.id,
        stateTag: state._tag,
        invocation: node.name,
        instanceId,
        childDefinitionId: node.definition.id,
        generation: childGeneration,
      })

      const watchCompletion = childHandle.completion.pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Queue.offer(inbox, {
              kind: "child-defect" as const,
              stateTag: state._tag,
              generation: childGeneration,
              invocation: node.name,
              instanceId,
              cause,
            }).pipe(Effect.asVoid),
          onSuccess: (value) =>
            Queue.offer(inbox, {
              kind: "child-complete" as const,
              stateTag: state._tag,
              generation: childGeneration,
              invocation: node.name,
              instanceId,
              value,
            }).pipe(Effect.asVoid),
        }),
      )
      yield* FiberMap.run(activeFibers, "child-completion")(watchCompletion)
    })

    const startTimer: (state: State) => Effect.Effect<void> = Effect.fnUntraced(function* (
      state: State,
    ) {
      const node = nodes.get(state._tag)
      if (
        node === undefined ||
        node.kind === "final" ||
        node.kind === "regions" ||
        node.after === undefined
      ) {
        return
      }
      const timerGeneration = generation
      yield* emit({
        _tag: "TimerStarted",
        machineId: definition.id,
        stateTag: state._tag,
        timer: "after",
        generation: timerGeneration,
        ownerPath: state._tag,
        durationMillis: Duration.toMillis(node.after.duration),
      })
      const timer = Effect.sleep(node.after.duration).pipe(
        Effect.andThen(
          Queue.offer(inbox, {
            kind: "timer" as const,
            stateTag: state._tag,
            generation: timerGeneration,
          }),
        ),
        Effect.asVoid,
      )
      yield* FiberMap.run(activeFibers, "timer")(timer)
    })

    const regionsAreComplete = (state: State): boolean => {
      const node = nodes.get(state._tag)
      if (node?.kind !== "regions") return false
      return Object.entries(node.regions).every(([slot, region]) => {
        const slotState = (state as Readonly<Record<string, unknown>>)[slot]
        return (
          typeof slotState === "object" &&
          slotState !== null &&
          region.states[(slotState as Tagged)._tag]?.final === true
        )
      })
    }

    const startRegionSlot: (state: State, slot: string) => Effect.Effect<void> = Effect.fnUntraced(
      function* (state: State, slot: string) {
        const parentNode = nodes.get(state._tag)
        if (parentNode?.kind !== "regions") return
        const slotState = (state as Readonly<Record<string, unknown>>)[slot]
        if (typeof slotState !== "object" || slotState === null || !("_tag" in slotState)) return
        const regionState = slotState as Tagged
        const regionNode = parentNode.regions[slot]?.states[regionState._tag]
        if (regionNode === undefined || regionNode.final === true) return
        const ownerGeneration = generation
        const slotGeneration = regionGenerations.get(slot) ?? 0
        const key = `region:${slot}`

        if (regionNode.invoke !== undefined) {
          const invoke = regionNode.invoke
          yield* emit({
            _tag: "InvocationStarted",
            machineId: definition.id,
            stateTag: state._tag,
            invocation: invoke.name,
            generation: ownerGeneration,
            ownerPath: `${state._tag}/${slot}/${regionState._tag}`,
            workKind: "effect",
          })
          const operation = invoke.effect(regionState, state)
          const retrying =
            invoke.retry === undefined
              ? operation
              : Effect.retry(
                  operation,
                  invoke.retry.schedule.pipe(
                    Schedule.tap((metadata) =>
                      emit({
                        _tag: "InvocationRetryScheduled",
                        machineId: definition.id,
                        stateTag: state._tag,
                        invocation: invoke.name,
                        generation: ownerGeneration,
                        policy: invoke.retry?.name ?? "retry",
                        attempt: metadata.attempt,
                        delayMillis: Duration.toMillis(metadata.duration),
                        ownerPath: `${state._tag}/${slot}/${regionState._tag}`,
                        workKind: "effect",
                      }),
                    ),
                  ),
                )
          const work = retrying.pipe(
            Effect.provideContext(environment),
            Effect.matchEffect({
              onFailure: (error) =>
                Queue.offer(inbox, {
                  kind: "region-failure" as const,
                  stateTag: state._tag,
                  generation: ownerGeneration,
                  slot,
                  regionTag: regionState._tag,
                  slotGeneration,
                  value: error,
                }).pipe(Effect.asVoid),
              onSuccess: (value) =>
                Queue.offer(inbox, {
                  kind: "region-success" as const,
                  stateTag: state._tag,
                  generation: ownerGeneration,
                  slot,
                  regionTag: regionState._tag,
                  slotGeneration,
                  value,
                }).pipe(Effect.asVoid),
            }),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Queue.offer(inbox, {
                    kind: "region-defect" as const,
                    stateTag: state._tag,
                    generation: ownerGeneration,
                    slot,
                    regionTag: regionState._tag,
                    slotGeneration,
                    cause,
                  }).pipe(Effect.asVoid),
            ),
          )
          yield* FiberMap.run(activeFibers, `${key}:work`)(work)
        }

        if (regionNode.after !== undefined) {
          yield* emit({
            _tag: "TimerStarted",
            machineId: definition.id,
            stateTag: state._tag,
            timer: "after",
            generation: ownerGeneration,
            ownerPath: `${state._tag}/${slot}/${regionState._tag}`,
            durationMillis: Duration.toMillis(regionNode.after.duration),
          })
          const timer = Effect.sleep(regionNode.after.duration).pipe(
            Effect.andThen(
              Queue.offer(inbox, {
                kind: "region-timer" as const,
                stateTag: state._tag,
                generation: ownerGeneration,
                slot,
                regionTag: regionState._tag,
                slotGeneration,
              }),
            ),
            Effect.asVoid,
          )
          yield* FiberMap.run(activeFibers, `${key}:timer`)(timer)
        }
      },
    )

    const startRegions: (state: State) => Effect.Effect<void> = Effect.fnUntraced(function* (
      state: State,
    ) {
      const node = nodes.get(state._tag)
      if (node?.kind !== "regions") return
      const slots = Object.keys(node.regions)
      for (const slot of slots) {
        regionGenerations.set(slot, (regionGenerations.get(slot) ?? 0) + 1)
      }
      yield* Effect.forEach(slots, (slot) => startRegionSlot(state, slot), {
        discard: true,
      })
      if (regionsAreComplete(state) && node.onComplete !== undefined) {
        yield* Queue.offer(inbox, {
          kind: "regions-complete",
          stateTag: state._tag,
          generation,
        })
      }
    })

    const startOwnedBehavior = (state: State): Effect.Effect<void> =>
      Effect.all(
        [startInvocation(state), startChild(state), startTimer(state), startRegions(state)],
        {
          concurrency: "unbounded",
          discard: true,
        },
      )

    const closeActiveChild: (cancelled: boolean) => Effect.Effect<void> = Effect.fnUntraced(
      function* (cancelled: boolean) {
        const child = activeChild
        if (child === undefined) return
        activeChild = undefined
        if (cancelled) {
          yield* emit({
            _tag: "ChildCancelled",
            machineId: definition.id,
            stateTag: child.stateTag,
            invocation: child.invocation,
            instanceId: child.instanceId,
            generation: child.generation,
          })
        }
        yield* Scope.close(child.scope, Exit.void)
      },
    )

    const commit: (previous: State, next: State, firedTimer?: boolean) => Effect.Effect<boolean> =
      Effect.fnUntraced(function* (previous: State, next: State, firedTimer = false) {
        next = yield* validateState(next)
        const previousNode = nodes.get(previous._tag)
        if (
          !firedTimer &&
          previousNode !== undefined &&
          previousNode.kind !== "final" &&
          previousNode.kind !== "regions" &&
          previousNode.after !== undefined
        ) {
          yield* emit({
            _tag: "TimerCancelled",
            machineId: definition.id,
            stateTag: previous._tag,
            timer: "after",
            generation,
            ownerPath: previous._tag,
            durationMillis: Duration.toMillis(previousNode.after.duration),
          })
        }
        if (previousNode?.kind === "regions") {
          for (const [slot, region] of Object.entries(previousNode.regions)) {
            const slotState = (previous as Readonly<Record<string, unknown>>)[slot]
            if (typeof slotState !== "object" || slotState === null || !("_tag" in slotState)) {
              continue
            }
            const regionNode = region.states[(slotState as Tagged)._tag]
            const ownerPath = `${previous._tag}/${slot}/${(slotState as Tagged)._tag}`
            if (regionNode?.invoke !== undefined) {
              yield* emit({
                _tag: "InvocationCancelled",
                machineId: definition.id,
                stateTag: previous._tag,
                invocation: regionNode.invoke.name,
                generation,
                ownerPath,
                workKind: "effect",
              })
            }
            if (regionNode?.after !== undefined) {
              yield* emit({
                _tag: "TimerCancelled",
                machineId: definition.id,
                stateTag: previous._tag,
                timer: "after",
                generation,
                ownerPath,
                durationMillis: Duration.toMillis(regionNode.after.duration),
              })
            }
          }
        }
        generation += 1
        yield* FiberMap.clear(activeFibers)
        yield* closeActiveChild(true)
        yield* SubscriptionRef.set(stateRef, next)
        yield* emit({
          _tag: "StateChanged",
          machineId: definition.id,
          previousStateTag: previous._tag,
          nextStateTag: next._tag,
        })
        yield* treeRuntime.append(actorId, definitionPath, {
          _tag: "StateSnapshot",
          state: next,
        })
        const isFinal = finalTags.has(next._tag)
        if (isFinal) {
          yield* Ref.set(status, "Completed")
          yield* emit({
            _tag: "MachineCompleted",
            machineId: definition.id,
            finalStateTag: next._tag,
          })
          yield* treeRuntime.terminate(actorId, definitionPath, "completed")
          // finalTags membership proves the Completion narrowing that Set.has cannot express.
          yield* Deferred.succeed(completion, next as Completion)
        } else {
          yield* startOwnedBehavior(next)
        }
        return !isFinal
      })

    const commitStay: (
      previous: State,
      fields: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void> = Effect.fnUntraced(function* (
      previous: State,
      fields: Readonly<Record<string, unknown>>,
    ) {
      const next = yield* validateState({ ...previous, ...fields, _tag: previous._tag })
      yield* SubscriptionRef.set(stateRef, next)
      yield* emit({
        _tag: "StateChanged",
        machineId: definition.id,
        previousStateTag: previous._tag,
        nextStateTag: next._tag,
      })
      yield* treeRuntime.append(actorId, definitionPath, {
        _tag: "StateSnapshot",
        state: next,
      })
    })

    const commitRegion: (
      previous: State,
      updates: Readonly<Record<string, Tagged>>,
      reenteredSlots: ReadonlySet<string>,
      settled?: Readonly<{ slot: string; kind: "work" | "timer" }>,
    ) => Effect.Effect<State> = Effect.fnUntraced(function* (
      previous: State,
      updates: Readonly<Record<string, Tagged>>,
      reenteredSlots: ReadonlySet<string>,
      settled,
    ) {
      for (const slot of reenteredSlots) {
        const parentNode = nodes.get(previous._tag)
        const slotState = (previous as Readonly<Record<string, unknown>>)[slot]
        const regionNode =
          parentNode?.kind === "regions" &&
          typeof slotState === "object" &&
          slotState !== null &&
          "_tag" in slotState
            ? parentNode.regions[slot]?.states[(slotState as Tagged)._tag]
            : undefined
        const ownerPath = `${previous._tag}/${slot}/${(slotState as Tagged | undefined)?._tag ?? "unknown"}`
        if (
          regionNode?.invoke !== undefined &&
          !(settled?.slot === slot && settled.kind === "work")
        ) {
          yield* emit({
            _tag: "InvocationCancelled",
            machineId: definition.id,
            stateTag: previous._tag,
            invocation: regionNode.invoke.name,
            generation,
            ownerPath,
            workKind: "effect",
          })
        }
        if (
          regionNode?.after !== undefined &&
          !(settled?.slot === slot && settled.kind === "timer")
        ) {
          yield* emit({
            _tag: "TimerCancelled",
            machineId: definition.id,
            stateTag: previous._tag,
            timer: "after",
            generation,
            ownerPath,
            durationMillis: Duration.toMillis(regionNode.after.duration),
          })
        }
        yield* FiberMap.remove(activeFibers, `region:${slot}:work`)
        yield* FiberMap.remove(activeFibers, `region:${slot}:timer`)
        regionGenerations.set(slot, (regionGenerations.get(slot) ?? 0) + 1)
      }
      const next = yield* validateState({ ...previous, ...updates })
      yield* SubscriptionRef.set(stateRef, next)
      yield* emit({
        _tag: "StateChanged",
        machineId: definition.id,
        previousStateTag: previous._tag,
        nextStateTag: next._tag,
      })
      yield* treeRuntime.append(actorId, definitionPath, {
        _tag: "StateSnapshot",
        state: next,
      })
      yield* Effect.forEach(reenteredSlots, (slot) => startRegionSlot(next, slot), {
        discard: true,
      })
      const node = nodes.get(next._tag)
      if (node?.kind === "regions" && node.onComplete !== undefined && regionsAreComplete(next)) {
        yield* Queue.offer(inbox, {
          kind: "regions-complete",
          stateTag: next._tag,
          generation,
        })
      }
      return next
    })

    const process: (envelope: Envelope<Event>) => Effect.Effect<boolean> = Effect.fnUntraced(
      function* (envelope: Envelope<Event>) {
        const current = yield* SubscriptionRef.get(stateRef)
        const currentNode = nodes.get(current._tag)

        if (envelope.kind === "child-complete" || envelope.kind === "child-defect") {
          const child = activeChild
          if (
            envelope.generation !== generation ||
            envelope.stateTag !== current._tag ||
            currentNode?.kind !== "child" ||
            child?.instanceId !== envelope.instanceId
          ) {
            return true
          }

          if (envelope.kind === "child-defect") {
            yield* emit({
              _tag: "ChildDefected",
              machineId: definition.id,
              stateTag: current._tag,
              invocation: currentNode.name,
              instanceId: envelope.instanceId,
              generation,
            })
            yield* closeActiveChild(false)
            return yield* Effect.failCause(envelope.cause)
          }

          const selectedOutcome = selectOutcome(currentNode.onComplete, {
            state: current,
            value: envelope.value,
          })
          if (selectedOutcome === undefined) {
            return yield* Effect.die(
              new ProtocolDefect(definition.id, current._tag, "child-completion"),
            )
          }
          yield* emit({
            _tag: "ChildCompleted",
            machineId: definition.id,
            stateTag: current._tag,
            invocation: currentNode.name,
            instanceId: envelope.instanceId,
            generation,
            ...(selectedOutcome.branch === undefined ? {} : { branch: selectedOutcome.branch }),
          })
          const transition = selectedOutcome.transition
          const fields = transition.reduce({ state: current, value: envelope.value })
          const next = { ...fields, _tag: transition.target } as State
          yield* closeActiveChild(false)
          return yield* commit(current, next)
        }

        if (
          envelope.kind === "region-success" ||
          envelope.kind === "region-failure" ||
          envelope.kind === "region-defect" ||
          envelope.kind === "region-timer"
        ) {
          const slotState = (current as Readonly<Record<string, unknown>>)[envelope.slot]
          if (
            envelope.generation !== generation ||
            envelope.stateTag !== current._tag ||
            currentNode?.kind !== "regions" ||
            envelope.slotGeneration !== (regionGenerations.get(envelope.slot) ?? 0) ||
            typeof slotState !== "object" ||
            slotState === null ||
            (slotState as Tagged)._tag !== envelope.regionTag
          ) {
            yield* emit({
              _tag: "StaleOutcomeIgnored",
              machineId: definition.id,
              stateTag: current._tag,
              ownerPath: `${envelope.stateTag}/${envelope.slot}/${envelope.regionTag}`,
              generation: envelope.generation,
              currentGeneration: generation,
              outcome:
                envelope.kind === "region-success"
                  ? "work-success"
                  : envelope.kind === "region-failure"
                    ? "work-failure"
                    : envelope.kind === "region-defect"
                      ? "work-defect"
                      : "timer",
            })
            return true
          }
          if (envelope.kind === "region-defect") {
            yield* emit({
              _tag: "InvocationDefected",
              machineId: definition.id,
              stateTag: current._tag,
              invocation:
                currentNode.regions[envelope.slot]?.states[envelope.regionTag]?.invoke?.name ??
                "region-work",
              generation,
              ownerPath: `${current._tag}/${envelope.slot}/${envelope.regionTag}`,
              workKind: "effect",
            })
            return yield* Effect.failCause(envelope.cause)
          }
          const regionState = slotState as Tagged
          const regionNode = currentNode.regions[envelope.slot]?.states[regionState._tag]
          if (regionNode === undefined) return true

          let transition: RuntimeRegionOutcome<State, "value" | "error"> | undefined
          let fields: Readonly<Record<string, unknown>>
          if (envelope.kind === "region-timer") {
            const after = regionNode.after
            if (after === undefined) return true
            yield* emit({
              _tag: "TimerFired",
              machineId: definition.id,
              stateTag: current._tag,
              timer: "after",
              generation,
              ownerPath: `${current._tag}/${envelope.slot}/${envelope.regionTag}`,
              durationMillis: Duration.toMillis(after.duration),
            })
            fields = after.reduce({ state: regionState, parent: current })
            transition = after as unknown as RuntimeRegionOutcome<State, "value" | "error">
          } else if (envelope.kind === "region-success") {
            const outcome = regionNode.invoke?.onSuccess
            if (outcome === undefined) return true
            yield* emit({
              _tag: "InvocationSucceeded",
              machineId: definition.id,
              stateTag: current._tag,
              invocation: regionNode.invoke?.name ?? "region-work",
              generation,
              ownerPath: `${current._tag}/${envelope.slot}/${envelope.regionTag}`,
              workKind: "effect",
            })
            fields = outcome.reduce({ state: regionState, parent: current, value: envelope.value })
            transition = outcome as RuntimeRegionOutcome<State, "value" | "error">
          } else {
            const outcome = regionNode.invoke?.onFailure
            if (outcome === undefined) return true
            yield* emit({
              _tag: "InvocationFailed",
              machineId: definition.id,
              stateTag: current._tag,
              invocation: regionNode.invoke?.name ?? "region-work",
              generation,
              ownerPath: `${current._tag}/${envelope.slot}/${envelope.regionTag}`,
              workKind: "effect",
            })
            fields = outcome.reduce({ state: regionState, parent: current, error: envelope.value })
            transition = outcome as RuntimeRegionOutcome<State, "value" | "error">
          }
          yield* emit({
            _tag: "TransitionSelected",
            machineId: definition.id,
            sourceStateTag: `${current._tag}/${envelope.slot}/${envelope.regionTag}`,
            targetStateTag: `${current._tag}/${envelope.slot}/${transition.target}`,
            eventTag:
              envelope.kind === "region-timer"
                ? "@after"
                : envelope.kind === "region-success"
                  ? "@success"
                  : "@failure",
            ownerPath: `${current._tag}/${envelope.slot}`,
            macrostep: generation,
          })
          const nextSlot = { ...fields, _tag: transition.target } as Tagged
          yield* commitRegion(current, { [envelope.slot]: nextSlot }, new Set([envelope.slot]), {
            slot: envelope.slot,
            kind: envelope.kind === "region-timer" ? "timer" : "work",
          })
          return true
        }

        if (envelope.kind === "regions-complete") {
          if (
            envelope.generation !== generation ||
            envelope.stateTag !== current._tag ||
            currentNode?.kind !== "regions" ||
            currentNode.onComplete === undefined ||
            !regionsAreComplete(current)
          ) {
            if (envelope.generation !== generation || envelope.stateTag !== current._tag) {
              yield* emit({
                _tag: "StaleOutcomeIgnored",
                machineId: definition.id,
                stateTag: current._tag,
                ownerPath: envelope.stateTag,
                generation: envelope.generation,
                currentGeneration: generation,
                outcome: "completion",
              })
            }
            return true
          }
          const transition = currentNode.onComplete
          yield* emit({
            _tag: "TransitionSelected",
            machineId: definition.id,
            sourceStateTag: current._tag,
            targetStateTag: transition.target,
            eventTag: "@complete",
            ownerPath: current._tag,
            macrostep: generation,
          })
          const fields = transition.reduce({ state: current })
          const next = { ...fields, _tag: transition.target } as State
          return yield* commit(current, next)
        }

        if (envelope.kind === "timer") {
          if (
            envelope.generation !== generation ||
            envelope.stateTag !== current._tag ||
            currentNode === undefined ||
            currentNode.kind === "final" ||
            currentNode.kind === "regions" ||
            currentNode.after === undefined
          ) {
            if (envelope.generation !== generation || envelope.stateTag !== current._tag) {
              yield* emit({
                _tag: "StaleOutcomeIgnored",
                machineId: definition.id,
                stateTag: current._tag,
                ownerPath: envelope.stateTag,
                generation: envelope.generation,
                currentGeneration: generation,
                outcome: "timer",
              })
            }
            return true
          }
          const transition = currentNode.after
          yield* emit({
            _tag: "TimerFired",
            machineId: definition.id,
            stateTag: current._tag,
            timer: "after",
            generation,
            ownerPath: current._tag,
            durationMillis: Duration.toMillis(transition.duration),
          })
          yield* emit({
            _tag: "TransitionSelected",
            machineId: definition.id,
            sourceStateTag: current._tag,
            targetStateTag: transition.target,
            eventTag: "@after",
            ownerPath: current._tag,
            macrostep: generation,
          })
          const fields = transition.reduce({ state: current })
          const next = { ...fields, _tag: transition.target } as State
          return yield* commit(current, next, true)
        }

        if (envelope.kind !== "external") {
          if (
            envelope.generation !== generation ||
            envelope.stateTag !== current._tag ||
            currentNode?.kind !== "invoke"
          ) {
            yield* emit({
              _tag: "StaleOutcomeIgnored",
              machineId: definition.id,
              stateTag: current._tag,
              ownerPath: envelope.stateTag,
              generation: envelope.generation,
              currentGeneration: generation,
              outcome:
                envelope.kind === "invocation-success"
                  ? "work-success"
                  : envelope.kind === "invocation-failure"
                    ? "work-failure"
                    : "work-defect",
            })
            return true
          }

          if (envelope.kind === "invocation-defect") {
            yield* emit({
              _tag: "InvocationDefected",
              machineId: definition.id,
              stateTag: current._tag,
              invocation: currentNode.name,
              generation,
              ownerPath: current._tag,
              workKind: currentNode.workKind ?? "effect",
              ...(currentNode.tasks === undefined ? {} : { lanes: Object.keys(currentNode.tasks) }),
            })
            return yield* Effect.failCause(envelope.cause)
          }

          const isSuccess = envelope.kind === "invocation-success"
          const selectedOutcome = isSuccess
            ? selectOutcome(currentNode.onSuccess, { state: current, value: envelope.value })
            : selectOutcome(currentNode.onFailure, { state: current, error: envelope.error })
          if (selectedOutcome === undefined) {
            return yield* Effect.die(
              new ProtocolDefect(
                definition.id,
                current._tag,
                isSuccess ? "invocation-success" : "invocation-failure",
              ),
            )
          }
          yield* emit({
            _tag: isSuccess ? "InvocationSucceeded" : "InvocationFailed",
            machineId: definition.id,
            stateTag: current._tag,
            invocation: currentNode.name,
            generation,
            ownerPath: current._tag,
            workKind: currentNode.workKind ?? "effect",
            ...(currentNode.tasks === undefined ? {} : { lanes: Object.keys(currentNode.tasks) }),
            ...(selectedOutcome.branch === undefined ? {} : { branch: selectedOutcome.branch }),
          })
          const transition = selectedOutcome.transition
          // isSuccess correlates the envelope kind with the value/error reducer key;
          // TypeScript cannot track that correlation across the shared selectOutcome call.
          const fields = isSuccess
            ? currentNode.workKind === "race" &&
              typeof envelope.value === "object" &&
              envelope.value !== null
              ? (
                  transition as unknown as {
                    reduce: (
                      args: Readonly<Record<string, unknown>>,
                    ) => Readonly<Record<string, unknown>>
                  }
                ).reduce({ state: current, ...envelope.value })
              : (transition as RuntimeOutcomeTransition<State, unknown, "value">).reduce({
                  state: current,
                  value: envelope.value,
                })
            : (transition as RuntimeOutcomeTransition<State, unknown, "error">).reduce({
                state: current,
                error: envelope.error,
              })
          const next = { ...fields, _tag: transition.target } as State
          return yield* commit(current, next)
        }

        yield* emit(
          {
            _tag: "EventReceived",
            machineId: definition.id,
            stateTag: current._tag,
            eventTag: envelope.event._tag,
          },
          envelope.event,
        )

        if (currentNode?.kind === "child") {
          const forwarded = currentNode.forward[envelope.event._tag]
          if (forwarded !== undefined) {
            const child = activeChild
            if (child === undefined) {
              return yield* Effect.die(
                new MachineDefinitionDefect(
                  `Machine ${definition.id} has no active instance for child ${currentNode.name}`,
                ),
              )
            }
            const childEvent = forwarded.map({ state: current, event: envelope.event })
            if (childEvent._tag !== forwarded.target) {
              return yield* Effect.die(
                new MachineDefinitionDefect(
                  `Machine ${definition.id} forwards to ${forwarded.target} but returned ${childEvent._tag}`,
                ),
              )
            }
            yield* emit({
              _tag: "ChildEventForwarded",
              machineId: definition.id,
              stateTag: current._tag,
              invocation: currentNode.name,
              instanceId: child.instanceId,
              parentEventTag: envelope.event._tag,
              childEventTag: childEvent._tag,
              generation,
            })
            yield* child.handle.send(childEvent).pipe(
              Effect.catchCause((cause) =>
                Effect.andThen(
                  emit({
                    _tag: "ChildDefected",
                    machineId: definition.id,
                    stateTag: current._tag,
                    invocation: currentNode.name,
                    instanceId: child.instanceId,
                    generation,
                  }),
                  Effect.failCause(cause),
                ),
              ),
            )
            yield* Deferred.succeed(envelope.reply, undefined)
            return true
          }
        }
        if (currentNode?.kind === "regions") {
          const plans: Array<
            Readonly<{
              slot: string
              active: Tagged
              handler: RuntimeRegionHandler<State, Event>
            }>
          > = []
          const updates: Record<string, Tagged> = {}
          const reentered = new Set<string>()
          for (const [slot, region] of Object.entries(currentNode.regions)) {
            const slotState = (current as Readonly<Record<string, unknown>>)[slot]
            if (typeof slotState !== "object" || slotState === null || !("_tag" in slotState)) {
              continue
            }
            const active = slotState as Tagged
            const handler = region.states[active._tag]?.on?.[envelope.event._tag]
            if (handler === undefined) continue
            plans.push({ slot, active, handler })
          }
          // Selection is complete before any reducer runs. Every sibling plan therefore observes
          // the same immutable pre-event parent snapshot.
          for (const { slot, active, handler } of plans) {
            if ("ignore" in handler) continue
            if ("stay" in handler) {
              const fields = handler.stay({ state: active, event: envelope.event, parent: current })
              updates[slot] = { ...active, ...fields, _tag: active._tag }
              continue
            }
            const fields = handler.reduce({ state: active, event: envelope.event, parent: current })
            updates[slot] = { ...fields, _tag: handler.target } as Tagged
            reentered.add(slot)
            yield* emit({
              _tag: "TransitionSelected",
              machineId: definition.id,
              sourceStateTag: `${current._tag}/${slot}/${active._tag}`,
              targetStateTag: `${current._tag}/${slot}/${handler.target}`,
              eventTag: envelope.event._tag,
              ownerPath: `${current._tag}/${slot}`,
              macrostep: generation,
            })
          }
          if (plans.length > 0) {
            if (Object.keys(updates).length > 0) {
              yield* commitRegion(current, updates, reentered)
            }
            yield* Deferred.succeed(envelope.reply, undefined)
            return true
          }
        }
        const handler =
          currentNode?.kind === "state" ||
          currentNode?.kind === "invoke" ||
          currentNode?.kind === "child" ||
          currentNode?.kind === "regions"
            ? currentNode.on[envelope.event._tag]
            : undefined
        const selected = selectHandler(handler, current, envelope.event)

        if (selected === undefined) {
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

        if (selected.kind === "ignore") {
          yield* emit({
            _tag: "EventIgnored",
            machineId: definition.id,
            stateTag: current._tag,
            eventTag: envelope.event._tag,
          })
          yield* Deferred.succeed(envelope.reply, undefined)
          return true
        }

        if (selected.kind === "stay") {
          yield* commitStay(
            current,
            selected.update.stay({ state: current, event: envelope.event }),
          )
          yield* Deferred.succeed(envelope.reply, undefined)
          return true
        }

        const transition = selected.transition

        yield* emit({
          _tag: "TransitionSelected",
          machineId: definition.id,
          sourceStateTag: current._tag,
          targetStateTag: transition.target,
          eventTag: envelope.event._tag,
          ...(selected.branch === undefined ? {} : { branch: selected.branch }),
        })
        const fields = transition.reduce({ state: current, event: envelope.event })
        const next = { ...fields, _tag: transition.target } as State
        const continueRunning = yield* commit(current, next)
        yield* Deferred.succeed(envelope.reply, undefined)
        return continueRunning
      },
    )

    const can = Effect.fnUntraced(function* (event: Event) {
      const current = yield* SubscriptionRef.get(stateRef)
      const node = nodes.get(current._tag)
      if (node?.kind === "child") {
        const forwarded = node.forward[event._tag]
        if (forwarded !== undefined) {
          const child = activeChild
          if (child === undefined) return false
          const childEvent = forwarded.map({ state: current, event })
          if (childEvent._tag !== forwarded.target) return false
          return yield* child.handle.can(childEvent)
        }
      }
      if (node?.kind === "regions") {
        for (const [slot, region] of Object.entries(node.regions)) {
          const slotState = (current as Readonly<Record<string, unknown>>)[slot]
          if (
            typeof slotState === "object" &&
            slotState !== null &&
            region.states[(slotState as Tagged)._tag]?.on?.[event._tag] !== undefined
          ) {
            return true
          }
        }
        return selectHandler(node.on[event._tag], current, event) !== undefined
      }
      if (node?.kind !== "state" && node?.kind !== "invoke" && node?.kind !== "child") {
        return false
      }
      return selectHandler(node.on[event._tag], current, event) !== undefined
    })

    const send = Effect.fnUntraced(function* (event: Event) {
      const currentStatus = yield* Ref.get(status)
      if (currentStatus === "Completed") {
        const current = yield* SubscriptionRef.get(stateRef)
        return yield* Effect.die(new ProtocolDefect(definition.id, current._tag, event._tag))
      }
      if (currentStatus === "Defected") {
        return yield* Deferred.await(terminated)
      }
      const reply = yield* Deferred.make<void>()
      yield* Queue.offer(inbox, { kind: "external", event, reply })
      yield* Effect.raceFirst(Deferred.await(reply), Deferred.await(terminated))
    })

    // This is the single interpreter-owned erasure boundary for heterogeneous child events.
    yield* treeRuntime.register(actorId, {
      definitionPath,
      can: (event) => can(event as Event),
      send: (event) => send(event as Event),
    })
    yield* treeRuntime.append(actorId, definitionPath, {
      _tag: "ActorStarted",
      machineId: definition.id,
      ...(actorParent === undefined
        ? {}
        : {
            parentActorId: actorParent.actorId,
            ownerStateTag: actorParent.ownerStateTag,
            invocation: actorParent.invocation,
            instanceId: actorParent.instanceId,
          }),
    })
    yield* emit({
      _tag: "MachineStarted",
      machineId: definition.id,
      initialStateTag: initial._tag,
    })
    yield* treeRuntime.append(actorId, definitionPath, {
      _tag: "StateSnapshot",
      state: initial,
    })

    const initialIsFinal = finalTags.has(initial._tag)
    if (initialIsFinal) {
      yield* Ref.set(status, "Completed")
      // finalTags membership proves the Completion narrowing that Set.has cannot express.
      yield* Deferred.succeed(completion, initial as Completion)
      yield* Deferred.succeed(terminated, undefined)
      yield* treeRuntime.terminate(actorId, definitionPath, "completed")
    } else {
      let continueRunning = true
      yield* Effect.whileLoop({
        while: () => continueRunning,
        body: () => Queue.take(inbox).pipe(Effect.flatMap(process)),
        step: (next) => {
          continueRunning = next
        },
      }).pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit)) {
              yield* Ref.set(status, "Defected")
              yield* treeRuntime.terminate(
                actorId,
                definitionPath,
                Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "defected",
              )
              yield* Deferred.failCause(completion, exit.cause)
              yield* Deferred.failCause(terminated, exit.cause)
            } else {
              yield* Deferred.succeed(terminated, undefined)
            }
          }),
        ),
        Effect.forkScoped,
      )
      yield* startOwnedBehavior(initial)
    }

    return {
      actorId,
      definitionPath,
      tree: treeRuntime.handle,
      snapshot: SubscriptionRef.get(stateRef),
      changes: Stream.takeUntil(SubscriptionRef.changes(stateRef), (state) =>
        finalTags.has(state._tag),
      ),
      // inspection() returns the union of the plain and projected element types; the presence
      // (or absence) of projectEvent decides which one, which TypeScript cannot track.
      inspection: inspection() as Stream.Stream<InspectionEvent>,
      inspect: (projectEvent) =>
        inspection(projectEvent) as Stream.Stream<
          ProjectedInspectionEvent<ReturnType<typeof projectEvent>>
        >,
      completion: Deferred.await(completion),
      can,
      send,
    }
  })
