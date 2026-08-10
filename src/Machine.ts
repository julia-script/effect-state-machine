import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberMap from "effect/FiberMap"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
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

type TaggedUnionMember = Schema.Top & Readonly<{ Type: Tagged }>
type TaggedSchemaSource = TaggedSchema | Schema.Union<ReadonlyArray<TaggedUnionMember>>

type NormalizedTaggedSchema<Source extends TaggedSchemaSource> = Source extends TaggedSchema
  ? Source
  : Source extends Schema.Union<infer Members extends ReadonlyArray<TaggedUnionMember>>
    ? Schema.toTaggedUnion<"_tag", Members>
    : never

export interface TaggedUnionCase<Fields extends Schema.Struct.Fields = Schema.Struct.Fields> {
  readonly fields: Fields
  readonly title?: string
  readonly description?: string
}

type TaggedUnionCases<Cases extends Readonly<Record<string, TaggedUnionCase>>> = {
  readonly [Tag in keyof Cases & string]: Schema.TaggedStruct<Tag, Cases[Tag]["fields"]>
}

export type TaggedUnion<Cases extends Readonly<Record<string, TaggedUnionCase>>> =
  Schema.TaggedUnion<TaggedUnionCases<Cases>>

/** Builds an Effect tagged union whose individual cases retain graphable metadata. */
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

  return Schema.Union(members).pipe(Schema.toTaggedUnion("_tag")) as unknown as TaggedUnion<Cases>
}

const normalizeTaggedSchema = <Source extends TaggedSchemaSource>(
  schema: Source,
): NormalizedTaggedSchema<Source> =>
  ("cases" in schema
    ? schema
    : schema.pipe(Schema.toTaggedUnion("_tag"))) as NormalizedTaggedSchema<Source>

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
        }>
        target: Target
        description?: string
        reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => ByTag<State, Target>
      }>
    : never

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
        reduce: (args: TransitionArgs<State, Event, Current, EventTag>) => ByTag<State, Target>
      }>
    : never

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

export interface IgnoredTransition {
  readonly ignore: Readonly<{
    description?: string
  }>
}

export type EventHandler<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  EventTag extends TagOf<Event>,
> =
  | Transition<State, Event, Current, EventTag>
  | GuardedTransition<State, Event, Current, EventTag>
  | IgnoredTransition

export type EventHandlers<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Readonly<{
  [EventTag in TagOf<Event>]?: EventHandler<State, Event, Current, EventTag>
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

export interface FinalNode<Current extends string> {
  readonly kind: "final"
  readonly tag: Current
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
        reduce: (args: OutcomeArgs<State, Current, Value, Key>) => ByTag<State, Target>
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
        }>
        target: Target
        description?: string
        reduce: (args: OutcomeArgs<State, Current, Value, Key>) => ByTag<State, Target>
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
        reduce: (args: OutcomeArgs<State, Current, Value, Key>) => ByTag<State, Target>
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

export type SuccessTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Value,
> = OutcomeHandler<State, Current, Value, "value">

export type FailureTransition<
  State extends Tagged,
  Current extends TagOf<State>,
  Error,
> = OutcomeHandler<State, Current, Error, "error">

export interface RetryPolicy<
  Failure,
  Policy extends Schedule.Schedule<unknown, Failure, unknown, unknown>,
> {
  readonly name: string
  readonly description?: string
  readonly schedule: Policy
}

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
  readonly effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Failure, Requirements>
  readonly retry?: RetryPolicy<Failure, Schedule.Schedule<unknown, Failure, RetryError, RetryEnv>>
  readonly onSuccess: SuccessTransition<State, Current, Output>
  readonly onFailure: FailureTransition<State, Current, Failure | RetryError>
  readonly on: EventHandlers<State, Event, Current>
  readonly _Requirements?: Requirements | RetryEnv
}

export interface ChildDefinition {
  readonly id: string
  readonly description?: string
  readonly schemas: Readonly<{
    input: Schema.Top
    state: TaggedSchema
    event: TaggedSchema
  }>
  readonly nodes: ReadonlyArray<Readonly<{ kind: string; tag: string }>>
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

export type ChildForwarders<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
  ChildEvent extends Tagged,
> = Readonly<{
  [ParentEventTag in TagOf<Event>]?: ChildForward<State, Event, Current, ParentEventTag, ChildEvent>
}>

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
  readonly definition: Child
  readonly input: (state: ByTag<State, Current>) => MachineInput<Child>
  readonly forward: ChildForwarders<State, Event, Current, MachineEvent<Child>>
  readonly onComplete: SuccessTransition<State, Current, MachineCompletion<Child>>
  readonly on: EventHandlers<State, Event, Current>
  readonly _Requirements?: MachineRequirements<Child>
}

type StateNodeUnion<State extends Tagged, Event extends Tagged> = {
  [Current in TagOf<State>]: StateNode<State, Event, Current>
}[TagOf<State>]

interface InvokeNodeShape<State extends Tagged> {
  readonly kind: "invoke"
  readonly tag: TagOf<State>
  readonly name: string
}

interface ChildNodeShape<State extends Tagged> {
  readonly kind: "child"
  readonly tag: TagOf<State>
  readonly name: string
}

type NodeUnion<State extends Tagged, Event extends Tagged> =
  | StateNodeUnion<State, Event>
  | FinalNode<TagOf<State>>
  | InvokeNodeShape<State>
  | ChildNodeShape<State>

export interface MachineDefinition<
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  Nodes extends ReadonlyArray<
    NodeUnion<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>
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
    | Readonly<{
        kind: "state"
        tag: string
        on: Readonly<
          Record<
            string,
            TransitionMetadata | GuardedTransitionMetadata | IgnoredTransition | undefined
          >
        >
      }>
    | Readonly<{
        kind: "final"
        tag: string
      }>
    | Readonly<{
        kind: "invoke"
        tag: string
        name: string
        description?: string
        retry?: Readonly<{
          name: string
          description?: string
        }>
        on: Readonly<
          Record<
            string,
            TransitionMetadata | GuardedTransitionMetadata | IgnoredTransition | undefined
          >
        >
        onSuccess: TransitionMetadata | GuardedTransitionMetadata
        onFailure: TransitionMetadata | GuardedTransitionMetadata
      }>
    | Readonly<{
        kind: "child"
        tag: string
        name: string
        description?: string
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
        on: Readonly<
          Record<
            string,
            TransitionMetadata | GuardedTransitionMetadata | IgnoredTransition | undefined
          >
        >
        onComplete: TransitionMetadata | GuardedTransitionMetadata
      }>
  >
}

export interface MachineHandle<
  State extends Tagged,
  Event extends Tagged,
  Completion extends State = never,
> {
  readonly snapshot: Effect.Effect<State>
  readonly changes: Stream.Stream<State>
  readonly inspection: Stream.Stream<InspectionEvent>
  readonly completion: Effect.Effect<Completion>
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
      branch?: SelectedBranch
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

type FinalTag<Nodes extends ReadonlyArray<Readonly<{ kind: string; tag: string }>>> = Extract<
  Nodes[number],
  { kind: "final" }
>["tag"]

export type MachineCompletion<Definition> =
  Definition extends Readonly<{
    schemas: Readonly<{ state: infer StateSchema extends TaggedSchema }>
    nodes: infer Nodes extends ReadonlyArray<Readonly<{ kind: string; tag: string }>>
  }>
    ? Extract<Schema.Schema.Type<StateSchema>, { _tag: FinalTag<Nodes> }>
    : never

type NodeRequirements<Node> =
  Node extends Readonly<{ _Requirements?: infer Requirements }>
    ? Exclude<Requirements, undefined>
    : never

type RequirementsFromNodes<Nodes extends ReadonlyArray<Readonly<{ kind: string; tag: string }>>> =
  NodeRequirements<Nodes[number]>

export type MachineRequirements<Definition> =
  Definition extends Readonly<{
    nodes: infer Nodes extends ReadonlyArray<Readonly<{ kind: string; tag: string }>>
  }>
    ? RequirementsFromNodes<Nodes>
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

export const decodeInput = <InputSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"input", InputSchema>,
  input: unknown,
) => Schema.decodeUnknownEffect(definition.schemas.input)(input)

export const encodeInput = <InputSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"input", InputSchema>,
  input: Schema.Schema.Type<InputSchema>,
) => Schema.encodeEffect(definition.schemas.input)(input)

export const decodeState = <StateSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"state", StateSchema>,
  input: unknown,
) => Schema.decodeUnknownEffect(definition.schemas.state)(input)

export const encodeState = <StateSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"state", StateSchema>,
  input: Schema.Schema.Type<StateSchema>,
) => Schema.encodeEffect(definition.schemas.state)(input)

export const decodeEvent = <EventSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"event", EventSchema>,
  input: unknown,
) => Schema.decodeUnknownEffect(definition.schemas.event)(input)

export const encodeEvent = <EventSchema extends Schema.Top>(
  definition: DefinitionWithSchema<"event", EventSchema>,
  input: Schema.Schema.Type<EventSchema>,
) => Schema.encodeEffect(definition.schemas.event)(input)

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
    tag: Current,
    config: Readonly<{ on?: EventHandlers<State, Event, Current> }>,
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
  ): InvokeNode<State, Event, Current, Output, Failure, Requirements, RetryError, RetryEnv> => ({
    kind: "invoke",
    tag,
    name: config.name,
    description: config.description,
    effect: config.effect,
    retry: config.retry,
    onSuccess: config.onSuccess,
    onFailure: config.onFailure,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const child = <Current extends TagOf<State>, Child extends ChildDefinition>(
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
  ): ChildNode<State, Event, Current, Child> => ({
    kind: "child",
    tag,
    name: config.name,
    description: config.description,
    definition: config.definition,
    input: config.input,
    forward: config.forward ?? ({} as ChildForwarders<State, Event, Current, MachineEvent<Child>>),
    onComplete: config.onComplete,
    on: config.on ?? ({} as EventHandlers<State, Event, Current>),
  })

  const make = <const Nodes extends ReadonlyArray<NodeUnion<State, Event>>>(
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
      if (node.kind === "final") continue
      for (const handler of Object.values(node.on)) {
        if (handler === undefined || "ignore" in handler) continue
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
      nodes: config.nodes,
    }
  }

  return { child, final, invoke, make, state }
}

interface RuntimeTransition<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly description?: string
  readonly reduce: (args: Readonly<{ state: State; event: Event }>) => State
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

interface RuntimeOutcomeTransition<State extends Tagged, Value, Key extends "value" | "error"> {
  readonly target: string
  readonly description?: string
  readonly reduce: (args: Readonly<{ state: State }> & Readonly<Record<Key, Value>>) => State
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
    ReadonlyArray<NodeUnion<Tagged, Tagged>>
  >

interface RuntimeForward<State extends Tagged, Event extends Tagged> {
  readonly target: string
  readonly description?: string
  readonly map: (args: Readonly<{ state: State; event: Event }>) => Tagged
}

type RuntimeNode<State extends Tagged, Event extends Tagged, Requirements = unknown> =
  | Readonly<{
      kind: "state"
      tag: string
      on: Readonly<Record<string, RuntimeEventHandler<State, Event> | undefined>>
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
    }>
  | Readonly<{
      kind: "final"
      tag: string
    }>
  | Readonly<{
      kind: "invoke"
      tag: string
      name: string
      description?: string
      effect: (state: State) => Effect.Effect<unknown, unknown, Requirements>
      retry?: Readonly<{
        name: string
        description?: string
        schedule: Schedule.Schedule<unknown, unknown, unknown, Requirements>
      }>
      onSuccess: RuntimeOutcomeHandler<State, unknown, "value">
      onFailure: RuntimeOutcomeHandler<State, unknown, "error">
      on: Readonly<Record<string, RuntimeEventHandler<State, Event> | undefined>>
    }>

interface ExternalEnvelope<Event extends Tagged> {
  readonly kind: "external"
  readonly event: Event
  readonly reply: Deferred.Deferred<void>
}

type InvocationEnvelope =
  | Readonly<{
      kind: "invocation-success"
      stateTag: string
      generation: number
      value: unknown
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

type Envelope<Event extends Tagged> = ExternalEnvelope<Event> | InvocationEnvelope | ChildEnvelope

interface ActiveChild {
  readonly stateTag: string
  readonly generation: number
  readonly invocation: string
  readonly instanceId: string
  readonly scope: Scope.Closeable
  readonly handle: MachineHandle<Tagged, Tagged, Tagged>
}

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

const selectHandler = <State extends Tagged, Event extends Tagged>(
  handler: RuntimeEventHandler<State, Event> | undefined,
  state: State,
  event: Event,
): SelectedHandler<State, Event> | undefined => {
  if (handler === undefined) return undefined
  if ("ignore" in handler) return { kind: "ignore" }
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

export const run = <
  InputSchema extends Schema.Top,
  StateSchema extends TaggedSchema,
  EventSchema extends TaggedSchema,
  Nodes extends ReadonlyArray<
    NodeUnion<Schema.Schema.Type<StateSchema>, Schema.Schema.Type<EventSchema>>
  >,
>(
  definition: MachineDefinition<InputSchema, StateSchema, EventSchema, Nodes>,
  input: Schema.Schema.Type<InputSchema>,
): Effect.Effect<
  MachineHandle<
    Schema.Schema.Type<StateSchema>,
    Schema.Schema.Type<EventSchema>,
    Extract<Schema.Schema.Type<StateSchema>, { _tag: FinalTag<Nodes> }>
  >,
  never,
  Scope.Scope | RequirementsFromNodes<Nodes>
> =>
  Effect.gen(function* () {
    type State = Schema.Schema.Type<StateSchema>
    type Event = Schema.Schema.Type<EventSchema>
    type Completion = Extract<State, { _tag: FinalTag<Nodes> }>
    type Requirements = RequirementsFromNodes<Nodes>

    const environment = yield* Effect.context<Requirements>()
    const parentScope = yield* Scope.Scope
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
    const inspectionRef = yield* SubscriptionRef.make<ReadonlyArray<InspectionEvent>>([])
    const terminated = yield* Deferred.make<void>()
    const completion = yield* Deferred.make<Completion>()
    const status = yield* Ref.make<"Running" | "Completed" | "Defected">("Running")
    const activeFibers = yield* FiberMap.make<string, void, never>()
    // The public builder proves this shape. The cast restores erased per-tag reducer types
    // at the single interpreter boundary where nodes become a homogeneous lookup table.
    const runtimeNodes = definition.nodes as ReadonlyArray<RuntimeNode<State, Event, Requirements>>
    const nodes = new Map(runtimeNodes.map((node) => [node.tag, node]))
    const finalTags = new Set(
      runtimeNodes.flatMap((node) => (node.kind === "final" ? [node.tag] : [])),
    )
    let generation = 0
    let childInstanceSequence = 0
    let activeChild: ActiveChild | undefined

    const emit = (event: InspectionEvent) =>
      SubscriptionRef.update(inspectionRef, (events) => [...events, event])

    const startInvocation = (state: State): Effect.Effect<void> =>
      Effect.gen(function* () {
        const node = nodes.get(state._tag)
        if (node?.kind !== "invoke") return

        const invocationGeneration = generation
        yield* emit({
          _tag: "InvocationStarted",
          machineId: definition.id,
          stateTag: state._tag,
          invocation: node.name,
          generation: invocationGeneration,
        })

        const operation = node.effect(state)
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

        yield* FiberMap.run(activeFibers, "active")(invocation)
      })

    const startChild = (state: State): Effect.Effect<void> =>
      Effect.gen(function* () {
        const node = nodes.get(state._tag)
        if (node?.kind !== "child") return

        const childScope = yield* Scope.make()
        yield* Scope.addFinalizer(parentScope, Scope.close(childScope, Exit.void))
        const childGeneration = generation
        const instanceId = `${definition.id}:${node.name}:${++childInstanceSequence}`
        const childHandle = yield* run(node.definition, node.input(state)).pipe(
          Effect.provideService(Scope.Scope, childScope),
          Effect.provideContext(environment),
        )
        activeChild = {
          stateTag: state._tag,
          generation: childGeneration,
          invocation: node.name,
          instanceId,
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
        yield* FiberMap.run(activeFibers, "active")(watchCompletion)
      })

    const startOwnedBehavior = (state: State): Effect.Effect<void> =>
      Effect.andThen(startInvocation(state), startChild(state))

    const closeActiveChild = (cancelled: boolean): Effect.Effect<void> =>
      Effect.gen(function* () {
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
      })

    const commit = (previous: State, next: State): Effect.Effect<boolean> =>
      Effect.gen(function* () {
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
        const isFinal = finalTags.has(next._tag)
        if (isFinal) {
          yield* Ref.set(status, "Completed")
          yield* emit({
            _tag: "MachineCompleted",
            machineId: definition.id,
            finalStateTag: next._tag,
          })
          yield* Deferred.succeed(completion, next as Completion)
        } else {
          yield* startOwnedBehavior(next)
        }
        return !isFinal
      })

    const process = (envelope: Envelope<Event>): Effect.Effect<boolean> =>
      Effect.gen(function* () {
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
          const next = transition.reduce({ state: current, value: envelope.value })
          if (next._tag !== transition.target) {
            return yield* Effect.die(
              new MachineDefinitionDefect(
                `Machine ${definition.id} reducer targeted ${transition.target} but returned ${next._tag}`,
              ),
            )
          }
          yield* closeActiveChild(false)
          return yield* commit(current, next)
        }

        if (envelope.kind !== "external") {
          if (
            envelope.generation !== generation ||
            envelope.stateTag !== current._tag ||
            currentNode?.kind !== "invoke"
          ) {
            return true
          }

          if (envelope.kind === "invocation-defect") {
            yield* emit({
              _tag: "InvocationDefected",
              machineId: definition.id,
              stateTag: current._tag,
              invocation: currentNode.name,
              generation,
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
            ...(selectedOutcome.branch === undefined ? {} : { branch: selectedOutcome.branch }),
          })
          const transition = selectedOutcome.transition
          const next = isSuccess
            ? (transition as RuntimeOutcomeTransition<State, unknown, "value">).reduce({
                state: current,
                value: envelope.value,
              })
            : (transition as RuntimeOutcomeTransition<State, unknown, "error">).reduce({
                state: current,
                error: envelope.error,
              })
          if (next._tag !== transition.target) {
            return yield* Effect.die(
              new MachineDefinitionDefect(
                `Machine ${definition.id} reducer targeted ${transition.target} but returned ${next._tag}`,
              ),
            )
          }
          return yield* commit(current, next)
        }

        yield* emit({
          _tag: "EventReceived",
          machineId: definition.id,
          stateTag: current._tag,
          eventTag: envelope.event._tag,
        })

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
        const handler =
          currentNode?.kind === "state" ||
          currentNode?.kind === "invoke" ||
          currentNode?.kind === "child"
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

        const transition = selected.transition

        yield* emit({
          _tag: "TransitionSelected",
          machineId: definition.id,
          sourceStateTag: current._tag,
          targetStateTag: transition.target,
          eventTag: envelope.event._tag,
          ...(selected.branch === undefined ? {} : { branch: selected.branch }),
        })
        const next = transition.reduce({ state: current, event: envelope.event })
        if (next._tag !== transition.target) {
          return yield* Effect.die(
            new MachineDefinitionDefect(
              `Machine ${definition.id} reducer targeted ${transition.target} but returned ${next._tag}`,
            ),
          )
        }
        const continueRunning = yield* commit(current, next)
        yield* Deferred.succeed(envelope.reply, undefined)
        return continueRunning
      })

    yield* emit({
      _tag: "MachineStarted",
      machineId: definition.id,
      initialStateTag: initial._tag,
    })

    const initialIsFinal = finalTags.has(initial._tag)
    if (initialIsFinal) {
      yield* Ref.set(status, "Completed")
      yield* Deferred.succeed(completion, initial as Completion)
      yield* Deferred.succeed(terminated, undefined)
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
      snapshot: SubscriptionRef.get(stateRef),
      changes: Stream.takeUntil(SubscriptionRef.changes(stateRef), (state) =>
        finalTags.has(state._tag),
      ),
      inspection: SubscriptionRef.changes(inspectionRef).pipe(
        Stream.mapAccum(
          () => 0,
          (seen, events) => [events.length, events.slice(seen)] as const,
        ),
      ),
      completion: Deferred.await(completion),
      can: (event) =>
        Effect.gen(function* () {
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
          if (node?.kind !== "state" && node?.kind !== "invoke" && node?.kind !== "child") {
            return false
          }
          return selectHandler(node.on[event._tag], current, event) !== undefined
        }),
      send: (event) =>
        Effect.gen(function* () {
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
        }),
    }
  })
