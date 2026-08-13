/**
 * Throwaway prototype for the statechart-syntax exploration.
 *
 * Proposed changes under test, in one place:
 *
 * 1. `states` is a record keyed by state tag (exhaustive, duplicate-free by
 *    construction) instead of a `nodes` array; node kind is discriminated by
 *    shape (`on` / `invoke` / `regions` / `final: true`).
 * 2. Reducers no longer write `_tag`: `reduce` returns the target state's
 *    fields and the declared `target` supplies the tag.
 * 3. Region slots: a state may declare tagged-union fields as live regions.
 *    One region is a compound ("parent") state, several regions are parallel
 *    regions, and an undeclared tagged-union field stays inert data (which is
 *    how history is modeled — as an ordinary field).
 * 4. Declared work combinators on invoke: a single effect, `all` (fork/join
 *    with a concurrency option), and `race` (first success wins), all named so
 *    the graph can render lanes instead of one opaque effect.
 * 5. `after`: a declared timer transition (the primitive under debounce and
 *    throttle patterns).
 *
 * The types and values in this module exist only to test the proposed
 * authoring surface. They deliberately contain no interpreter.
 */
import type { Duration, Effect, Schedule, Schema, Scope, Stream } from "effect"

type Tagged = Readonly<{ _tag: string }>
type TaggedSchema = Schema.Top & Readonly<{ Type: Tagged }>
type TagOf<Value extends Tagged> = Value["_tag"]
type ByTag<Value extends Tagged, Tag extends string> = Extract<Value, { _tag: Tag }>

/** A state value minus its `_tag`: what a reducer returns under auto-tagging. */
type FieldsOf<Value> = Omit<Value, "_tag">

// ---------------------------------------------------------------------------
// Event transitions (top level)
// ---------------------------------------------------------------------------

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
        reduce: (
          args: TransitionArgs<State, Event, Current, EventTag>,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

/**
 * Bare-function shorthand: stay on the current tag and update its fields.
 *
 * Deliberately distinct from `{ target: <current tag>, reduce }`: the
 * shorthand keeps owned work (invoke fibers, timers) running, while an
 * explicit self-target re-enters the node and restarts its work. The types
 * cannot express that difference; the interpreter and docs must.
 */
type StayUpdate<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> = (args: TransitionArgs<State, Event, Current, EventTag>) => FieldsOf<ByTag<State, Current>>

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
        reduce: (
          args: TransitionArgs<State, Event, Current, EventTag>,
        ) => FieldsOf<ByTag<State, Target>>
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
        reduce: (
          args: TransitionArgs<State, Event, Current, EventTag>,
        ) => FieldsOf<ByTag<State, Target>>
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
  | StayUpdate<State, Event, Current, EventTag>

type EventHandlers<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [EventTag in TagOf<Event>]?: EventHandler<State, Event, Current, EventTag>
}>

// ---------------------------------------------------------------------------
// `after`: the declared timer transition
// ---------------------------------------------------------------------------

/**
 * Fires when the node has been active for `duration` without re-entry.
 * Re-entering the node (an explicit self-target) restarts the timer, which is
 * what makes the debounce pattern a plain state + `after`.
 */
type AfterTransition<
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

// ---------------------------------------------------------------------------
// Invoke: declared work combinators
// ---------------------------------------------------------------------------

export interface RetryPolicy<
  Failure,
  Policy extends Schedule.Schedule<unknown, Failure, unknown, unknown>,
> {
  readonly name: string
  readonly description?: string
  readonly schedule: Policy
}

/**
 * The opaque result of configuring a node's work through the invoke toolkit.
 *
 * Split into an unparameterized base and a requirements-carrying extension:
 * node configs declare their `invoke` callback as returning the BASE type, so
 * the contextual return type carries no inference candidate for the spec's
 * environment. (Declaring `InvokeSpec<unknown>` there lets `unknown` flow
 * backwards into the toolkit call's generic inference and poison the machine
 * requirements — observed while typechecking this prototype.)
 */
export interface InvokeSpecBase {
  readonly kind: "invoke-spec"
  readonly name: string
}

/** Carries the inferred environment so machine requirements stay transitive. */
export interface InvokeSpec<Requirements> extends InvokeSpecBase {
  readonly _Requirements?: Requirements
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
        reduce: (
          args: Readonly<{ state: ByTag<State, Current>; value: Value }>,
        ) => FieldsOf<ByTag<State, Target>>
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
        reduce: (
          args: Readonly<{ state: ByTag<State, Current>; error: Failure }>,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

/** `race` joins a sum: the winner's output plus which task won. */
type RaceSuccessTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
  Winner extends string,
  Target extends TagOf<State> = TagOf<State>,
> =
  Target extends TagOf<State>
    ? Readonly<{
        target: Target
        description?: string
        reduce: (
          args: Readonly<{ state: ByTag<State, Current>; value: Value; winner: Winner }>,
        ) => FieldsOf<ByTag<State, Target>>
      }>
    : never

type TaskShape<State extends Tagged, Current extends TagOf<State>> = Readonly<{
  description?: string
  effect: (state: ByTag<State, Current>) => Effect.Effect<unknown, unknown, unknown>
}>

type TaskOutput<Task> =
  Task extends Readonly<{
    effect: (...args: never[]) => Effect.Effect<infer Output, infer _Failure, infer _Requirements>
  }>
    ? Output
    : never

type TaskFailure<Task> =
  Task extends Readonly<{
    effect: (...args: never[]) => Effect.Effect<infer _Output, infer Failure, infer _Requirements>
  }>
    ? Failure
    : never

type TaskRequirements<Task> =
  Task extends Readonly<{
    effect: (...args: never[]) => Effect.Effect<infer _Output, infer _Failure, infer Requirements>
  }>
    ? Requirements
    : never

type TasksOutputs<Tasks> = Readonly<{ [Name in keyof Tasks]: TaskOutput<Tasks[Name]> }>
type TasksFailure<Tasks> = { [Name in keyof Tasks]: TaskFailure<Tasks[Name]> }[keyof Tasks]
type TasksRequirements<Tasks> = { [Name in keyof Tasks]: TaskRequirements<Tasks[Name]> }[keyof Tasks]

/**
 * The invoke toolkit. The callback indirection (`invoke: ($) => $({ … })`)
 * exists purely to open a fresh generic call site inside the states record, so
 * each node's Output/Failure/Requirements infer from its own `effect` without
 * repeating the state tag.
 */
export interface InvokeToolkit<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> {
  /** One effect: the v0 invoke, minus `_tag` bookkeeping. */
  <Output, Failure, Requirements, RetryError = never, RetryEnv = never>(
    config: Readonly<{
      name: string
      description?: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
      retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
      onSuccess: SuccessTransition<State, Current, Output>
      onFailure: FailureTransition<State, Current, Failure | RetryError>
    }>,
  ): InvokeSpec<Requirements | RetryEnv>

  /**
   * Fork/join over named tasks: `Effect.all` on a record, lifted into declared
   * data. Joins a product — `value` is keyed by task name. Failure interrupts
   * the surviving tasks and loses partial results (Effect's semantics).
   */
  readonly all: <const Tasks extends Readonly<Record<string, TaskShape<State, Current>>>>(
    config: Readonly<{
      name: string
      description?: string
      concurrency?: number | "unbounded"
      tasks: Tasks
      onSuccess: SuccessTransition<State, Current, TasksOutputs<Tasks>>
      onFailure: FailureTransition<State, Current, TasksFailure<Tasks>>
    }>,
  ) => InvokeSpec<TasksRequirements<Tasks>>

  /**
   * First success wins; losers are interrupted. Joins a sum — `value` is the
   * union of task outputs and `winner` names the lane. All tasks failing
   * routes the last failure to `onFailure`.
   */
  readonly race: <const Tasks extends Readonly<Record<string, TaskShape<State, Current>>>>(
    config: Readonly<{
      name: string
      description?: string
      tasks: Tasks
      onSuccess: RaceSuccessTransition<
        State,
        Current,
        TaskOutput<Tasks[keyof Tasks]>,
        keyof Tasks & string
      >
      onFailure: FailureTransition<State, Current, TasksFailure<Tasks>>
    }>,
  ) => InvokeSpec<TasksRequirements<Tasks>>
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/** Fields of the state that are tagged unions and therefore region-eligible. */
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
  /** The whole parent state value: shared fields plus every sibling slot. */
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
> = (
  args: RegionTransitionArgs<State, Event, Current, Slot, RegionTag, EventTag>,
) => FieldsOf<ByTag<Slot, RegionTag>>

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

/** Region invokes are single-effect in this prototype; see NOTES.md. */
export interface RegionInvokeToolkit<
  State extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
> {
  <Output, Failure, Requirements, RetryError = never, RetryEnv = never>(
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
  ): InvokeSpec<Requirements | RetryEnv>
}

type RegionStateConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  Slot extends Tagged,
  RegionTag extends TagOf<Slot>,
> =
  | Readonly<{
      description?: string
      on: RegionEventHandlers<State, Event, Current, Slot, RegionTag>
      after?: RegionAfterTransition<State, Current, Slot, RegionTag>
      invoke?: never
      final?: never
    }>
  | Readonly<{
      description?: string
      invoke: (
        invoke: RegionInvokeToolkit<State, Current, Slot, RegionTag>,
      ) => InvokeSpecBase
      on?: RegionEventHandlers<State, Event, Current, Slot, RegionTag>
      after?: RegionAfterTransition<State, Current, Slot, RegionTag>
      final?: never
    }>
  | Readonly<{
      description?: string
      /** A region final state: this region's contribution to `onComplete`. */
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

/**
 * Fires when every declared region rests on a `final: true` state. The slots
 * already hold the final values, so `reduce` only needs the state itself —
 * a direct payoff of configuration-as-data.
 */
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

// ---------------------------------------------------------------------------
// Node configs: kind is the shape
// ---------------------------------------------------------------------------

type AtomicNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  description?: string
  on: EventHandlers<State, Event, Current>
  after?: AfterTransition<State, Current>
  invoke?: never
  regions?: never
  onComplete?: never
  final?: never
}>

type InvokeNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  description?: string
  invoke: (invoke: InvokeToolkit<State, Event, Current>) => InvokeSpecBase
  on?: EventHandlers<State, Event, Current>
  after?: AfterTransition<State, Current>
  regions?: never
  onComplete?: never
  final?: never
}>

type RegionsNodeConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  description?: string
  regions: RegionsConfig<State, Event, Current>
  /** Node-level handlers apply in every region configuration; innermost wins. */
  on?: EventHandlers<State, Event, Current>
  onComplete?: RegionsCompleteTransition<State, Current>
  invoke?: never
  after?: never
  final?: never
}>

type FinalNodeConfig = Readonly<{
  description?: string
  final: true
  on?: never
  invoke?: never
  regions?: never
  after?: never
  onComplete?: never
}>

type StateConfig<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> =
  | AtomicNodeConfig<State, Event, Current>
  | InvokeNodeConfig<State, Event, Current>
  | RegionsNodeConfig<State, Event, Current>
  | FinalNodeConfig

type StatesConfig<State extends Tagged, Event extends Tagged> = Readonly<{
  [Current in TagOf<State>]: StateConfig<State, Event, Current>
}>

// ---------------------------------------------------------------------------
// Definition and derived types
// ---------------------------------------------------------------------------

export interface MachineDefinition<
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  States,
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
}

type DefinitionShape = MachineDefinition<Schema.Top, TaggedSchema, TaggedSchema, unknown>

export type MachineInput<Definition extends DefinitionShape> = Schema.Schema.Type<
  Definition["schemas"]["input"]
>
export type MachineState<Definition extends DefinitionShape> = Schema.Schema.Type<
  Definition["schemas"]["state"]
>
export type MachineEvent<Definition extends DefinitionShape> = Schema.Schema.Type<
  Definition["schemas"]["event"]
>

type FinalTags<States> = {
  [Tag in keyof States]: States[Tag] extends Readonly<{ final: true }> ? Tag : never
}[keyof States]

export type MachineCompletion<Definition extends DefinitionShape> = Extract<
  MachineState<Definition>,
  { _tag: FinalTags<Definition["states"]> }
>

type SpecRequirements<Value> = Value extends Readonly<{ _Requirements?: infer Requirements }>
  ? Exclude<Requirements, undefined>
  : never

type InvokeCallbackRequirements<Value> = Value extends (...args: never[]) => infer Spec
  ? SpecRequirements<Spec>
  : never

type RegionStatesRequirements<RegionStates> = {
  [Tag in keyof RegionStates]: RegionStates[Tag] extends Readonly<{ invoke: infer Callback }>
    ? InvokeCallbackRequirements<Callback>
    : never
}[keyof RegionStates]

type NodeRequirements<Config> =
  | (Config extends Readonly<{ invoke: infer Callback }>
      ? InvokeCallbackRequirements<Callback>
      : never)
  | (Config extends Readonly<{ regions: infer Regions }>
      ? {
          [RegionKey in keyof Regions]: NonNullable<Regions[RegionKey]> extends Readonly<{
            states: infer RegionStates
          }>
            ? RegionStatesRequirements<RegionStates>
            : never
        }[keyof Regions]
      : never)

export type MachineRequirements<Definition extends DefinitionShape> = {
  [Tag in keyof Definition["states"]]: NodeRequirements<Definition["states"][Tag]>
}[keyof Definition["states"]]

// ---------------------------------------------------------------------------
// Handle and runtime signatures (declaration only)
// ---------------------------------------------------------------------------

export interface MachineHandle<Definition extends DefinitionShape> {
  readonly snapshot: Effect.Effect<MachineState<Definition>>
  readonly changes: Stream.Stream<MachineState<Definition>>
  readonly send: (event: MachineEvent<Definition>) => Effect.Effect<void>
  readonly can: (event: MachineEvent<Definition>) => Effect.Effect<boolean>
  readonly completion: Effect.Effect<MachineCompletion<Definition>>
}

export declare const run: <const Definition extends DefinitionShape>(
  definition: Definition,
  input: MachineInput<Definition>,
) => Effect.Effect<
  MachineHandle<Definition>,
  never,
  Scope.Scope | MachineRequirements<Definition>
>

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

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

  const make = <const States extends StatesConfig<State, Event>>(
    config: Readonly<{
      id: string
      description?: string
      initial: (input: Schema.Schema.Type<InputSchema>) => State
      states: States
    }>,
  ): MachineDefinition<InputSchema, StateSchema, EventSchema, States> => ({
    id: config.id,
    description: config.description,
    schemas,
    initial: config.initial,
    states: config.states,
  })

  return { make }
}

export const Machine = { builder } as const
