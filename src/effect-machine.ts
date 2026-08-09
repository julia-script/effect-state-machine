import {
  Cause,
  Data,
  Deferred,
  Effect,
  FiberMap,
  Queue,
  type Scope,
  type Stream,
  SubscriptionRef,
} from "effect"

type Tagged = Readonly<{ _tag: string }>
type TagOf<A extends Tagged> = A["_tag"]
type ByTag<A extends Tagged, Tag extends string> = Extract<A, { _tag: Tag }>

type TransitionMap<
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
> = Partial<{
  [EventTag in TagOf<Event>]: Readonly<{
    target: TagOf<State>
    reduce: (args: { state: ByTag<State, Current>; event: ByTag<Event, EventTag> }) => State
  }>
}>

type RuntimeTransition<State extends Tagged, Event extends Tagged> = Readonly<{
  target: string
  reduce: (state: State, event: Event) => State
}>

type RuntimeNode<State extends Tagged, Event extends Tagged> =
  | Readonly<{
      kind: "state"
      tag: string
      on: Readonly<Record<string, RuntimeTransition<State, Event>>>
    }>
  | Readonly<{
      kind: "invoke"
      tag: string
      source: string
      on: Readonly<Record<string, RuntimeTransition<State, Event>>>
      run: (state: State) => Effect.Effect<unknown, unknown, unknown>
      success: Readonly<{
        target: string
        reduce: (state: State, value: unknown) => State
      }>
      failure: Readonly<{
        target: string
        reduce: (state: State, error: unknown) => State
      }>
      defect?: Readonly<{
        target: string
        reduce: (state: State, cause: string) => State
      }>
    }>

export interface MachineNode<State extends Tagged, Event extends Tagged, Requirements> {
  readonly runtime: RuntimeNode<State, Event>
  readonly _Requirements?: Requirements
}

export interface MachineDefinition<State extends Tagged, Event extends Tagged, Requirements> {
  readonly id: string
  readonly initial: State
  readonly nodes: ReadonlyArray<MachineNode<State, Event, unknown>>
  readonly _Requirements?: Requirements
}

export type MachineRequirements<Definition> =
  Definition extends MachineDefinition<infer _State, infer _Event, infer Requirements>
    ? Requirements
    : never

export class InvalidTransition extends Data.TaggedError("InvalidTransition")<{
  readonly state: string
  readonly event: string
}> {
  override get message() {
    return `${this.event} is not accepted while the machine is in ${this.state}`
  }
}

export interface MachineHandle<State extends Tagged, Event extends Tagged> {
  readonly snapshot: Effect.Effect<State>
  readonly changes: Stream.Stream<State>
  readonly send: (event: Event) => Effect.Effect<void, InvalidTransition>
  readonly can: (event: Event) => Effect.Effect<boolean>
}

type RequirementsOfNode<Node> =
  Node extends MachineNode<infer _State, infer _Event, infer Requirements> ? Requirements : never

type ExternalEnvelope<Event extends Tagged> = Readonly<{
  kind: "external"
  event: Event
  reply: Deferred.Deferred<void, InvalidTransition>
}>

type InternalEnvelope =
  | Readonly<{
      kind: "success"
      state: string
      generation: number
      value: unknown
    }>
  | Readonly<{
      kind: "failure"
      state: string
      generation: number
      error: unknown
    }>
  | Readonly<{
      kind: "defect"
      state: string
      generation: number
      cause: string
    }>

type Envelope<Event extends Tagged> = ExternalEnvelope<Event> | InternalEnvelope

const runtimeTransitionMap = <
  State extends Tagged,
  Event extends Tagged,
  Current extends TagOf<State>,
>(
  input: TransitionMap<State, Event, Current> | undefined,
): Readonly<Record<string, RuntimeTransition<State, Event>>> =>
  Object.fromEntries(
    Object.entries(input ?? {}).map(([eventTag, transition]) => {
      const typedTransition = transition as {
        target: string
        reduce: (args: { state: ByTag<State, Current>; event: Event }) => State
      }
      return [
        eventTag,
        {
          target: typedTransition.target,
          reduce: (state: State, event: Event) =>
            typedTransition.reduce({
              state: state as ByTag<State, Current>,
              event,
            }),
        },
      ]
    }),
  )

const assertTarget = <State extends Tagged>(target: string, state: State): State => {
  if (state._tag !== target) {
    throw new Error(`Transition declared target ${target} but returned ${state._tag}`)
  }
  return state
}

const builder = <State extends Tagged, Event extends Tagged>() => {
  const state = <Current extends TagOf<State>>(
    tag: Current,
    config: Readonly<{
      on?: TransitionMap<State, Event, Current>
    }>,
  ): MachineNode<State, Event, never> => ({
    runtime: {
      kind: "state",
      tag,
      on: runtimeTransitionMap(config.on),
    },
  })

  const invoke = <Current extends TagOf<State>, Output, Error, Requirements>(
    tag: Current,
    config: Readonly<{
      source: string
      effect: (state: ByTag<State, Current>) => Effect.Effect<Output, Error, Requirements>
      onSuccess: Readonly<{
        target: TagOf<State>
        reduce: (args: { state: ByTag<State, Current>; value: Output }) => State
      }>
      onFailure: Readonly<{
        target: TagOf<State>
        reduce: (args: { state: ByTag<State, Current>; error: Error }) => State
      }>
      onDefect?: Readonly<{
        target: TagOf<State>
        reduce: (args: { state: ByTag<State, Current>; cause: string }) => State
      }>
      on?: TransitionMap<State, Event, Current>
    }>,
  ): MachineNode<State, Event, Requirements> => ({
    runtime: {
      kind: "invoke",
      tag,
      source: config.source,
      on: runtimeTransitionMap(config.on),
      run: config.effect as (state: State) => Effect.Effect<unknown, unknown, unknown>,
      success: {
        target: config.onSuccess.target,
        reduce: (current, value) =>
          config.onSuccess.reduce({
            state: current as ByTag<State, Current>,
            value: value as Output,
          }),
      },
      failure: {
        target: config.onFailure.target,
        reduce: (current, error) =>
          config.onFailure.reduce({
            state: current as ByTag<State, Current>,
            error: error as Error,
          }),
      },
      defect:
        config.onDefect === undefined
          ? undefined
          : {
              target: config.onDefect.target,
              reduce: (current, cause) =>
                config.onDefect?.reduce({
                  state: current as ByTag<State, Current>,
                  cause,
                }) ?? current,
            },
    },
  })

  const make = <const Nodes extends ReadonlyArray<MachineNode<State, Event, unknown>>>(
    config: Readonly<{
      id: string
      initial: State
      nodes: Nodes
    }>,
  ): MachineDefinition<State, Event, RequirementsOfNode<Nodes[number]>> => ({
    id: config.id,
    initial: config.initial,
    nodes: config.nodes,
  })

  return { state, invoke, make }
}

const run = <State extends Tagged, Event extends Tagged, Requirements>(
  definition: MachineDefinition<State, Event, Requirements>,
): Effect.Effect<MachineHandle<State, Event>, never, Requirements | Scope.Scope> =>
  Effect.gen(function* () {
    const environment = yield* Effect.context<Requirements>()
    const stateRef = yield* SubscriptionRef.make(definition.initial)
    const inbox = yield* Queue.unbounded<Envelope<Event>>()
    const activeFibers = yield* FiberMap.make<string, void, never>()
    const nodes = new Map(definition.nodes.map((node) => [node.runtime.tag, node.runtime]))
    let generation = 0

    const startInvocation = (state: State): Effect.Effect<void> =>
      Effect.gen(function* () {
        const node = nodes.get(state._tag)
        if (node?.kind !== "invoke") return

        const invocationGeneration = generation
        const invocation = (node.run(state) as Effect.Effect<unknown, unknown, Requirements>).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Queue.offer(inbox, {
                kind: "failure",
                state: state._tag,
                generation: invocationGeneration,
                error,
              }).pipe(Effect.asVoid),
            onSuccess: (value) =>
              Queue.offer(inbox, {
                kind: "success",
                state: state._tag,
                generation: invocationGeneration,
                value,
              }).pipe(Effect.asVoid),
          }),
          Effect.provideContext(environment),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.succeed(undefined)
              : Queue.offer(inbox, {
                  kind: "defect",
                  state: state._tag,
                  generation: invocationGeneration,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.asVoid),
          ),
        )

        yield* FiberMap.run(activeFibers, "active")(invocation)
      })

    const commit = (next: State): Effect.Effect<void> =>
      Effect.gen(function* () {
        generation += 1
        yield* SubscriptionRef.set(stateRef, next)
        yield* startInvocation(next)
      })

    const processEnvelope = (envelope: Envelope<Event>): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(stateRef)
        const node = nodes.get(current._tag)

        if (envelope.kind === "external") {
          const transition = node?.on[envelope.event._tag]
          if (transition === undefined) {
            yield* Deferred.fail(
              envelope.reply,
              new InvalidTransition({
                state: current._tag,
                event: envelope.event._tag,
              }),
            )
            return
          }

          yield* FiberMap.clear(activeFibers)
          const next = assertTarget(transition.target, transition.reduce(current, envelope.event))
          yield* commit(next)
          yield* Deferred.succeed(envelope.reply, undefined)
          return
        }

        if (
          envelope.generation !== generation ||
          envelope.state !== current._tag ||
          node?.kind !== "invoke"
        ) {
          return
        }

        if (envelope.kind === "success") {
          yield* commit(
            assertTarget(node.success.target, node.success.reduce(current, envelope.value)),
          )
          return
        }

        if (envelope.kind === "failure") {
          yield* commit(
            assertTarget(node.failure.target, node.failure.reduce(current, envelope.error)),
          )
          return
        }

        if (node.defect !== undefined) {
          yield* commit(
            assertTarget(node.defect.target, node.defect.reduce(current, envelope.cause)),
          )
        }
      })

    yield* Queue.take(inbox).pipe(
      Effect.flatMap(processEnvelope),
      Effect.forever,
      Effect.forkScoped,
    )
    yield* startInvocation(definition.initial)

    return {
      snapshot: SubscriptionRef.get(stateRef),
      changes: SubscriptionRef.changes(stateRef),
      can: (event) =>
        Effect.map(SubscriptionRef.get(stateRef), (state) => {
          const node = nodes.get(state._tag)
          return node?.on[event._tag] !== undefined
        }),
      send: (event) =>
        Effect.gen(function* () {
          const reply = yield* Deferred.make<void, InvalidTransition>()
          yield* Queue.offer(inbox, { kind: "external", event, reply })
          return yield* Deferred.await(reply)
        }),
    }
  })

export const Machine = {
  builder,
  run,
}
