import * as Data from "effect/Data"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fn from "effect/Function"
import type * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import { encodeComponent } from "./Internal.js"
import { MachineEngine as MachineEngineAccess } from "./MachineEngineService.js"
import type { MachineError, Migration } from "./MachineRuntimeProtocol.js"
import * as MachineStore from "./MachineStore.js"
import * as Source from "./Source.js"

export interface Tagged {
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
export type TaggedSchemaSource = TaggedSchema | Schema.Union<ReadonlyArray<TaggedUnionMember>>

export type NormalizedTaggedSchema<Source extends TaggedSchemaSource> = Source extends TaggedSchema
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

export type TagOf<Value extends Tagged> = Value["_tag"]
export type ByTag<Value extends Tagged, Tag extends string> = Extract<Value, { _tag: Tag }>
export type FieldsOf<Value> = Omit<Value, "_tag">

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

/** Named synchronous logic that computes one timer duration when a node entry starts. */
export interface NamedDuration<State> {
  readonly name: string
  readonly description?: string
  readonly compute: (state: State) => Duration.Input
}

type AfterArgs<State extends Tagged, Current extends TagOf<State>> = Readonly<{
  state: ByTag<State, Current>
}>

type SingleAfterTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        reduce: (args: AfterArgs<State, Current>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type AfterWhenBranch<
  State extends Tagged,
  Current extends TagOf<State>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        when: Readonly<{
          name: string
          description?: string
          guard: (args: AfterArgs<State, Current>) => boolean
          source?: Source.Reference
        }>
        target: Target
        description?: string
        reduce: (args: AfterArgs<State, Current>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type AfterOtherwiseBranch<
  State extends Tagged,
  Current extends TagOf<State>,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        otherwise: true
        target: Target
        description?: string
        reduce: (args: AfterArgs<State, Current>) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type GuardedAfterTransition<State extends Tagged, Current extends TagOf<State>> = Readonly<{
  branches:
    | readonly [AfterWhenBranch<State, Current>, ...ReadonlyArray<AfterWhenBranch<State, Current>>]
    | readonly [
        AfterWhenBranch<State, Current>,
        ...ReadonlyArray<AfterWhenBranch<State, Current>>,
        AfterOtherwiseBranch<State, Current>,
      ]
}>

/** A transition owned by one node entry's timer. */
export type AfterTransition<State extends Tagged, Current extends TagOf<State>> = Readonly<{
  duration: Duration.Input | NamedDuration<ByTag<State, Current>>
  description?: string
}> &
  (SingleAfterTransition<State, Current> | GuardedAfterTransition<State, Current>)

/** Common statically inspectable shape of invoked work. */
export interface InvokeSpecBase {
  readonly kind: "effect" | "all" | "race"
  readonly name: string
}

/** Carries inferred requirements without adding runtime data. */
export interface InvokeSpec<Requirements> extends InvokeSpecBase {
  readonly _Requirements?: Requirements
}

/**
 * Stable execution identity supplied to every invoked-work callback.
 *
 * **When to use**
 *
 * Pass `id` to an idempotent API, queue, or Workflow integration when work crosses into another
 * durability domain.
 *
 * **Details**
 *
 * The same machine entry and lane keep one execution ID across lease loss and at-least-once
 * redelivery. `deliveryAttempt` increases for each claim; explicit state re-entry creates a new
 * entry identity and execution ID. The runtime always supplies this argument, including when the
 * engine uses an in-memory store.
 *
 * **Gotchas**
 *
 * The ID makes an external idempotency strategy possible; it does not make an arbitrary side effect
 * exactly once. Callbacks may ignore this argument, but callbacks that reference it never need an
 * `undefined` branch.
 *
 * @category models
 * @since 0.2.0
 */
export interface WorkExecution {
  readonly id: MachineStore.ExecutionId
  readonly instanceId: MachineStore.MachineInstanceId
  readonly entryId: MachineStore.EntryId
  readonly ownerPath: string
  readonly invocationName: string
  readonly laneName?: string
  readonly deliveryAttempt: number
}

export type WorkSchema = Schema.Codec<unknown, unknown, unknown, unknown>
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
  execution: WorkExecution,
) => Effect.Effect<Schema.Schema.Type<Success>, Failure, Requirements>

type EffectInvokeSpec<
  State extends Tagged,
  Current extends TagOf<State>,
  Success extends WorkSchema,
  AllowedFailure extends WorkSchema,
  Failure,
  Requirements,
  RetryError,
  RetryEnv,
> = InvokeSpec<
  Requirements | RetryEnv | WorkSchemaRequirements<Success> | WorkSchemaRequirements<AllowedFailure>
> &
  Readonly<{
    kind: "effect"
    description?: string
    success: Success
    error: AllowedFailure
    effect: WorkEffect<State, Current, Success, Failure, Requirements>
    retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
    onSuccess: SuccessTransition<State, Current, Schema.Schema.Type<Success>>
    onFailure: FailureTransition<State, Current, Schema.Schema.Type<AllowedFailure>>
  }>

type TaskShape<State extends Tagged, Current extends TagOf<State>> = Readonly<{
  description?: string
  success: WorkSchema
  error: WorkSchema
  effect: WorkEffect<State, Current, WorkSchema, unknown, unknown>
}>

type ValidateTask<State extends Tagged, Current extends TagOf<State>, Task> =
  Task extends Readonly<{
    success: infer Success extends WorkSchema
    error: infer Failure extends WorkSchema
    effect: (
      state: ByTag<State, Current>,
      execution: WorkExecution,
    ) => Effect.Effect<infer Output, infer EffectFailure, unknown>
  }>
    ? [Output] extends [Schema.Schema.Type<Success>]
      ? [Schema.Schema.Type<Success>] extends [Output]
        ? [EffectFailure] extends [Schema.Schema.Type<Failure>]
          ? Task
          : never
        : never
      : never
    : never

type ValidateTasks<State extends Tagged, Current extends TagOf<State>, Tasks> = Readonly<{
  [Name in keyof Tasks]: ValidateTask<State, Current, Tasks[Name]>
}>

type TaskOutput<Task> =
  Task extends Readonly<{
    success: infer Success extends WorkSchema
  }>
    ? Schema.Schema.Type<Success>
    : never

type TaskFailure<Task> =
  Task extends Readonly<{
    error: infer Failure extends WorkSchema
  }>
    ? Schema.Schema.Type<Failure>
    : never

type TaskRequirements<Task> =
  Task extends Readonly<{
    success: infer Success extends WorkSchema
    error: infer Failure extends WorkSchema
    effect: (...args: never[]) => Effect.Effect<unknown, unknown, infer Requirements>
  }>
    ? Requirements | WorkSchemaRequirements<Success> | WorkSchemaRequirements<Failure>
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
> = Readonly<{
  duration:
    | Duration.Input
    | NamedDuration<Readonly<{ state: ByTag<Slot, RegionTag>; parent: ByTag<State, Current> }>>
  description?: string
}> &
  (
    | RegionAfterSingleTransition<State, Current, Slot, RegionTag>
    | RegionGuardedAfterTransition<State, Current, Slot, RegionTag>
  )

type RegionAfterSingleTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        target: Target
        reduce: (
          args: Readonly<{ state: ByTag<Slot, RegionTag>; parent: ByTag<State, Current> }>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionAfterWhenBranch<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        when: Readonly<{
          name: string
          description?: string
          guard: (
            args: Readonly<{
              state: ByTag<Slot, RegionTag>
              parent: ByTag<State, Current>
            }>,
          ) => boolean
          source?: Source.Reference
        }>
        target: Target
        description?: string
        reduce: (
          args: Readonly<{ state: ByTag<Slot, RegionTag>; parent: ByTag<State, Current> }>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionAfterOtherwiseBranch<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
  Target extends TagOf<Slot> = TagOf<Slot>,
> =
  Target extends TagOf<Slot>
    ? Readonly<{
        otherwise: true
        target: Target
        description?: string
        reduce: (
          args: Readonly<{ state: ByTag<Slot, RegionTag>; parent: ByTag<State, Current> }>,
        ) => FieldsOf<ByTag<Slot, Target>>
      }>
    : never

type RegionGuardedAfterTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
> = Readonly<{
  branches:
    | readonly [
        RegionAfterWhenBranch<State, Current, Slot, RegionTag>,
        ...ReadonlyArray<RegionAfterWhenBranch<State, Current, Slot, RegionTag>>,
      ]
    | readonly [
        RegionAfterWhenBranch<State, Current, Slot, RegionTag>,
        ...ReadonlyArray<RegionAfterWhenBranch<State, Current, Slot, RegionTag>>,
        RegionAfterOtherwiseBranch<State, Current, Slot, RegionTag>,
      ]
}>

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

export type StatesConfig<State extends Tagged, Event extends Tagged> = Readonly<{
  [Current in TagOf<State>]: StateConfig<State, Event, Current>
}>

/**
 * Immutable, synchronously inspectable definition of a machine's schemas and behavior.
 *
 * **Details**
 *
 * Definitions expose `run` for execution and are also shared with codec helpers and graph tooling.
 * Inspecting a definition never executes its initializer, reducers, guards, or Effects.
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
  readonly idempotencyKey: (input: Schema.Schema.Type<InputSchema>) => string
  readonly version: string
  readonly migrations: ReadonlyArray<Migration>
  readonly schemas: Readonly<{
    input: InputSchema
    state: StateSchema
    event: EventSchema
  }>
  readonly initial: (input: Schema.Schema.Type<InputSchema>) => Schema.Schema.Type<StateSchema>
  readonly states: States
  readonly instanceId: (input: Schema.Schema.Type<InputSchema>) => MachineStore.MachineInstanceId
  readonly run: (
    input: Schema.Schema.Type<InputSchema>,
  ) => RunEffect<StateSchema, EventSchema, States>
  readonly open: (
    input: Schema.Schema.Type<InputSchema>,
  ) => RunEffect<StateSchema, EventSchema, States>
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
  readonly version: string
  readonly migrations: ReadonlyArray<Migration>
  readonly schemas: Readonly<{
    state: TaggedSchema
    event: TaggedSchema
  }>
  readonly states: Readonly<Record<string, unknown>>
}

/**
 * Safe, serializable annotations projected from an invoked-work outcome Schema.
 *
 * @category models
 * @since 0.2.0
 */
export interface WorkSchemaMetadata {
  readonly kind: string
  readonly identifier?: string
  readonly title?: string
  readonly description?: string
}

/**
 * Projects safe tooling metadata from an Effect Schema value.
 *
 * **When to use**
 *
 * Use when rendering or inspecting invoked-work definitions without retaining executable Schema
 * objects. Non-Schema inputs return `undefined`.
 *
 * **Details**
 *
 * The projection includes the AST kind and resolved string-valued identifier, title, and
 * description annotations. It does not expose transformations, refinements, or executable hooks.
 *
 * @see {@link WorkSchemaMetadata} for the projected shape.
 * @category converting
 * @since 0.2.0
 */
export const workSchemaMetadata = (schema: unknown): WorkSchemaMetadata | undefined => {
  if (
    (typeof schema !== "object" && typeof schema !== "function") ||
    schema === null ||
    !("ast" in schema)
  ) {
    return undefined
  }
  const value = schema as Schema.Top
  const annotations = Schema.resolveAnnotations(value)
  const identifier = annotations?.identifier
  const title = annotations?.title
  const description = annotations?.description
  return {
    kind: value.ast._tag,
    ...(typeof identifier === "string" ? { identifier } : {}),
    ...(typeof title === "string" ? { title } : {}),
    ...(typeof description === "string" ? { description } : {}),
  }
}

/**
 * Homogeneous tooling view of one definition state, keyed by its authored tag.
 *
 * @category models
 * @since 0.2.0
 */
export type DefinitionNode =
  | Readonly<{
      kind: "state"
      tag: string
      source: Source.Reference
      description?: string
      after?: AfterTransitionMetadata
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
      successSchema?: WorkSchemaMetadata
      errorSchema?: WorkSchemaMetadata
      taskSchemas?: Readonly<
        Record<
          string,
          Readonly<{
            description?: string
            success?: WorkSchemaMetadata
            error?: WorkSchemaMetadata
          }>
        >
      >
      concurrency?: number | "unbounded"
      after?: AfterTransitionMetadata
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

const normalizeStates = (
  states: Readonly<Record<string, unknown>>,
): ReadonlyArray<DefinitionNode> =>
  Object.entries(states).map(([tag, rawNode]) => {
    const node = rawNode as Readonly<Record<string, unknown>>
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
      const tasks = work.tasks as
        | Readonly<Record<string, Readonly<Record<string, unknown>>>>
        | undefined
      return {
        ...work,
        kind: "invoke",
        workKind: work.kind,
        successSchema: workSchemaMetadata(work.success),
        errorSchema: workSchemaMetadata(work.error),
        ...(tasks === undefined
          ? {}
          : {
              taskSchemas: Object.fromEntries(
                Object.entries(tasks).map(([lane, task]) => {
                  const success = workSchemaMetadata(task.success)
                  const error = workSchemaMetadata(task.error)
                  return [
                    lane,
                    {
                      ...(task.description === undefined
                        ? {}
                        : { description: String(task.description) }),
                      ...(success === undefined ? {} : { success }),
                      ...(error === undefined ? {} : { error }),
                    },
                  ]
                }),
              ),
            }),
        tag,
        source: node.source,
        on: node.on ?? {},
        after: node.after,
      } as unknown as DefinitionNode
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
      } as unknown as DefinitionNode
    }
    if (node.child !== undefined) {
      const child = node.child as Readonly<Record<string, unknown>>
      return {
        kind: "child",
        tag,
        source: node.source,
        ...child,
        on: node.on ?? {},
      } as unknown as DefinitionNode
    }
    return {
      kind: "state",
      tag,
      source: node.source,
      description: node.description,
      on: node.on ?? {},
      after: node.after,
    } as unknown as DefinitionNode
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
export const definitionNodes = (definition: DefinitionMetadata): ReadonlyArray<DefinitionNode> =>
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
      /** Event encoded through the owning definition's JSON codec. */
      event?: Schema.Schema.Type<typeof Schema.Json>
    }>
  | Readonly<{
      _tag: "StateSnapshot"
      /** State encoded through the owning definition's JSON codec. */
      state: Schema.Schema.Type<typeof Schema.Json>
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
 * The handle is valid only inside the Scope required by `definition.run`. Releasing that Scope
 * interrupts active work and ends the instance.
 *
 * @category models
 * @since 0.1.0
 */
export interface MachineHandle<
  State extends Tagged,
  Event extends Tagged,
  Completion extends State = never,
  Error = never,
> {
  readonly instanceId: MachineStore.MachineInstanceId
  readonly actorId: ActorId
  readonly definitionPath: DefinitionPath
  readonly tree: MachineTreeHandle
  readonly snapshot: Effect.Effect<State, Error>
  readonly changes: Stream.Stream<State, Error>
  readonly inspection: Stream.Stream<InspectionEvent>
  inspect<EventDetails>(
    projectEvent: (event: Event) => EventDetails,
  ): Stream.Stream<ProjectedInspectionEvent<EventDetails>>
  readonly completion: Effect.Effect<Completion, Error>
  readonly send: (
    event: Event,
    options?: Readonly<{ idempotencyKey?: string }>,
  ) => Effect.Effect<void, Error>
  readonly can: (event: Event) => Effect.Effect<boolean, Error>
  readonly status: Effect.Effect<"running" | "completed" | "defected", Error>
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

/**
 * Defect raised when an authored machine definition violates a structural invariant.
 *
 * **Gotchas**
 *
 * Instances are thrown synchronously by `builder().define`. Failures discovered only while starting
 * an instance, such as an initializer returning an undeclared state, use the typed execution error
 * channel instead.
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

interface NamedDurationMetadata {
  readonly name: string
  readonly description?: string
  readonly compute: unknown
}

type AfterTransitionMetadata = Readonly<{
  duration: Duration.Input | NamedDurationMetadata
  description?: string
}> &
  (TransitionMetadata | GuardedTransitionMetadata)

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
 *   {
 *     id: "counter",
 *     idempotencyKey: (count) => String(count),
 *     initial: (count) => ({ _tag: "Active", count }),
 *   },
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

  const state = <Current extends TagOf<State>>(
    on: EventHandlers<State, Event, Current>,
    options?: Readonly<{
      description?: string
      after?: AfterTransition<State, Current>
    }>,
  ): AtomicNodeConfig<State, Event, Current> => ({
    source: Source.capture(),
    on,
    description: options?.description,
    after: options?.after,
  })

  const final = (options?: Readonly<{ description?: string }>): FinalNodeConfig => ({
    final: true,
    description: options?.description,
    source: Source.capture(),
  })

  const invokeEffect = <
    Current extends TagOf<State>,
    const Success extends WorkSchema,
    const AllowedFailure extends WorkSchema,
    Failure extends Schema.Schema.Type<AllowedFailure>,
    Requirements,
    RetryError extends Schema.Schema.Type<AllowedFailure> = never,
    RetryEnv = never,
  >(
    config: Readonly<{
      name: string
      description?: string
      success: Success
      error: AllowedFailure
      effect: WorkEffect<State, Current, Success, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: SuccessTransition<State, Current, Schema.Schema.Type<Success>>
      onFailure: FailureTransition<State, Current, Schema.Schema.Type<AllowedFailure>>
    }>,
    on?: EventHandlers<State, Event, Current>,
    options?: Readonly<{ after?: AfterTransition<State, Current> }>,
  ): InvokeNodeConfig<State, Event, Current> &
    Readonly<{
      invoke: EffectInvokeSpec<
        State,
        Current,
        Success,
        AllowedFailure,
        Failure,
        Requirements,
        RetryError,
        RetryEnv
      >
    }> => ({
    source: Source.capture(),
    invoke: {
      kind: "effect",
      name: config.name,
      description: config.description,
      success: config.success,
      error: config.error,
      effect: config.effect,
      retry: config.retry,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
    },
    on,
    after: options?.after,
  })

  const invokeAll = <
    Current extends TagOf<State>,
    const Tasks extends Readonly<Record<string, TaskShape<State, Current>>>,
  >(
    config: Readonly<{
      name: string
      description?: string
      concurrency?: number | "unbounded"
      tasks: Tasks & ValidateTasks<State, Current, Tasks>
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
      tasks: Tasks & ValidateTasks<State, Current, Tasks>
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

  // These are fixed library-owned method names, not open runtime-authored keys.
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
    const Success extends WorkSchema,
    const AllowedFailure extends WorkSchema,
    Failure extends Schema.Schema.Type<AllowedFailure>,
    Requirements,
    RetryError extends Schema.Schema.Type<AllowedFailure> = never,
    RetryEnv = never,
  >(
    config: Readonly<{
      name: string
      description?: string
      success: Success
      error: AllowedFailure
      effect: (
        state: ByTag<Slot, RegionTag>,
        parent: ByTag<State, Current>,
        execution: WorkExecution,
      ) => Effect.Effect<Schema.Schema.Type<Success>, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: RegionSuccessTransition<State, Current, Slot, Schema.Schema.Type<Success>>
      onFailure: RegionFailureTransition<State, Current, Slot, Schema.Schema.Type<AllowedFailure>>
    }>,
    on?: RegionEventHandlers<State, Event, Current, Slot, RegionTag>,
    options?: Readonly<{ after?: RegionAfterTransition<State, Current, Slot, RegionTag> }>,
  ): Readonly<{
    source: Source.Reference
    invoke: InvokeSpec<
      | Requirements
      | RetryEnv
      | WorkSchemaRequirements<Success>
      | WorkSchemaRequirements<AllowedFailure>
    > &
      Readonly<{
        kind: "effect"
        name: string
        description?: string
        success: Success
        error: AllowedFailure
        effect: (
          state: ByTag<Slot, RegionTag>,
          parent: ByTag<State, Current>,
          execution: WorkExecution,
        ) => Effect.Effect<Schema.Schema.Type<Success>, Failure, Requirements>
        retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
        onSuccess: RegionSuccessTransition<State, Current, Slot, Schema.Schema.Type<Success>>
        onFailure: RegionFailureTransition<State, Current, Slot, Schema.Schema.Type<AllowedFailure>>
      }>
    on?: RegionEventHandlers<State, Event, Current, Slot, RegionTag>
    after?: RegionAfterTransition<State, Current, Slot, RegionTag>
  }> => ({
    source: Source.capture(),
    invoke: {
      kind: "effect",
      name: config.name,
      description: config.description,
      success: config.success,
      error: config.error,
      effect: config.effect,
      retry: config.retry,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
    },
    on,
    after: options?.after,
  })

  const child = <Current extends TagOf<State>, Child extends ChildDefinition>(
    config: Readonly<{
      name: string
      description?: string
      definition: Child
      input: (state: ByTag<State, Current>) => MachineInput<Child>
      forward?: ChildForwarders<State, Event, Current, MachineEvent<Child>>
      onComplete: SuccessTransition<State, Current, MachineCompletion<Child>>
    }>,
    on?: EventHandlers<State, Event, Current>,
  ): ChildNodeConfig<State, Event, Current, Child> => ({
    source: Source.capture(),
    child: {
      name: config.name,
      description: config.description,
      definition: config.definition,
      input: config.input,
      forward:
        config.forward ?? ({} as ChildForwarders<State, Event, Current, MachineEvent<Child>>),
      onComplete: config.onComplete,
    },
    on,
  })

  const define = <const States extends StatesConfig<State, Event>>(
    config: Readonly<{
      id: string
      description?: string
      idempotencyKey: (input: Schema.Schema.Type<InputSchema>) => string
      version?: string
      migrations?: ReadonlyArray<Migration>
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

    const validateAfter = (
      owner: string,
      after: unknown,
      allowedTargets: ReadonlySet<string> = tags,
    ): void => {
      validateTarget(owner, after, allowedTargets)
      if (typeof after !== "object" || after === null) return
      const duration = (after as Readonly<Record<string, unknown>>).duration
      if (
        typeof duration === "object" &&
        duration !== null &&
        "compute" in duration &&
        String((duration as Readonly<Record<string, unknown>>).name ?? "").trim().length === 0
      ) {
        throw new MachineDefinitionDefect(
          `Machine ${config.id} declares a dynamic duration without a stable name in ${owner}`,
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
      validateAfter(owner, value.after)
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
            validateAfter(regionOwner, regionNode.after, regionTags)
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

    const definition: MachineDefinition<InputSchema, StateSchema, EventSchema, States> = {
      id: config.id,
      description: config.description,
      idempotencyKey: config.idempotencyKey,
      version: config.version ?? "1",
      migrations: config.migrations ?? [],
      schemas,
      initial: config.initial,
      states,
      instanceId: (input) =>
        MachineStore.deriveMachineInstanceId(config.id, config.idempotencyKey(input)),
      run: (input) => runWithMachineEngine(definition, input),
      open: (input) => runWithMachineEngine(definition, input),
    }
    return definition
  }

  return {
    child,
    define,
    final,
    guard: namedGuard,
    invoke,
    region: { invoke: invokeRegion },
    regions,
    state,
    schemas,
  }
}

/** Fully inferred schema-bound builder returned by {@link builder}. */
export type Builder<
  InputSchema extends Schema.Top,
  StateSchemaSource extends TaggedSchemaSource,
  EventSchemaSource extends TaggedSchemaSource,
> = ReturnType<typeof builder<InputSchema, StateSchemaSource, EventSchemaSource>>

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

const rootDefinitionPath = "root" as DefinitionPath

const childDefinitionPath = (
  parent: DefinitionPath,
  ownerStateTag: string,
  invocation: string,
): DefinitionPath =>
  `${parent}/${encodeComponent(ownerStateTag)}:${encodeComponent(invocation)}` as DefinitionPath

/**
 * Constructors for the canonical structural paths shared by runtime actors and development tools.
 *
 * **Gotchas**
 *
 * Child components normalize unpaired UTF-16 surrogates to U+FFFD before encoding. Existing
 * well-formed paths are unchanged; malformed spellings may normalize to the same path.
 *
 * @category observability
 * @since 0.2.0
 */
export const DefinitionPath = {
  root: rootDefinitionPath,
  child: childDefinitionPath,
  make: (value: string): DefinitionPath => value as DefinitionPath,
} as const

/** Effect returned by definition-level and data-first machine execution operations. */
export type RunEffect<
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
> = Effect.Effect<
  MachineHandle<
    Schema.Schema.Type<StateSchema>,
    Schema.Schema.Type<EventSchema>,
    Extract<Schema.Schema.Type<StateSchema>, { _tag: FinalTags<States> }>,
    MachineError
  >,
  MachineError,
  | MachineEngineAccess
  | Scope.Scope
  | Exclude<RequirementsFromStates<States>, undefined>
  | StateSchema["EncodingServices"]
  | StateSchema["DecodingServices"]
  | EventSchema["EncodingServices"]
  | EventSchema["DecodingServices"]
>

/** Runs or resumes a machine through the configured machine engine. */
const runWithMachineEngine: {
  <const Input>(
    input: Input,
  ): <
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
} = Fn.dual(
  2,
  <
    InputSchema extends Schema.Top,
    StateSchema extends TaggedSchema,
    EventSchema extends TaggedSchema,
    States extends StatesConfig<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>,
  >(
    definition: MachineDefinition<InputSchema, StateSchema, EventSchema, States>,
    input: Schema.Schema.Type<InputSchema>,
  ): RunEffect<StateSchema, EventSchema, States> =>
    Effect.gen(function* () {
      const engine = yield* MachineEngineAccess
      return yield* engine.run(definition, input) as RunEffect<StateSchema, EventSchema, States>
    }),
)
