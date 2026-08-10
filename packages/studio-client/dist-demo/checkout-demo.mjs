var __defProp = Object.defineProperty
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true })
}

// examples/checkout-demo.ts
import * as Context2 from "effect/Context"
import * as Effect4 from "effect/Effect"
import * as Layer2 from "effect/Layer"
import * as Ref3 from "effect/Ref"
import * as Schema6 from "effect/Schema"

// ../core/src/Machine.ts
var Machine_exports = {}
__export(Machine_exports, {
  MachineDefinitionDefect: () => MachineDefinitionDefect,
  ProtocolDefect: () => ProtocolDefect,
  builder: () => builder,
  decodeEvent: () => decodeEvent,
  decodeInput: () => decodeInput,
  decodeState: () => decodeState,
  encodeEvent: () => encodeEvent,
  encodeInput: () => encodeInput,
  encodeState: () => encodeState,
  namedGuard: () => namedGuard,
  run: () => run2,
  taggedUnion: () => taggedUnion,
})

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

// ../core/src/Source.ts
var capture = () => {
  const error = new Error()
  return { stack: () => error.stack }
}

// ../core/src/Machine.ts
var taggedUnion = (cases) => {
  const members = Object.entries(cases).map(([tag, definition2]) => {
    const member = Schema.TaggedStruct(tag, definition2.fields)
    return definition2.title === void 0 && definition2.description === void 0
      ? member
      : member.annotate({
          ...(definition2.title === void 0 ? {} : { title: definition2.title }),
          ...(definition2.description === void 0 ? {} : { description: definition2.description }),
        })
  })
  return Schema.Union(members).pipe(Schema.toTaggedUnion("_tag"))
}
var normalizeTaggedSchema = (schema) =>
  "cases" in schema ? schema : schema.pipe(Schema.toTaggedUnion("_tag"))
var MachineDefinitionDefect = class extends Error {
  name = "MachineDefinitionDefect"
}
var ProtocolDefect = class extends Error {
  constructor(machineId, stateTag, eventTag) {
    super(`Machine ${machineId} does not accept ${eventTag} in ${stateTag}`)
    this.machineId = machineId
    this.stateTag = stateTag
    this.eventTag = eventTag
  }
  machineId
  stateTag
  eventTag
  name = "ProtocolDefect"
}
var namedGuard = (config) => ({ ...config, source: capture() })
var decodeInput = (definition2, input) =>
  Schema.decodeUnknownEffect(definition2.schemas.input)(input)
var encodeInput = (definition2, input) => Schema.encodeEffect(definition2.schemas.input)(input)
var decodeState = (definition2, input) =>
  Schema.decodeUnknownEffect(definition2.schemas.state)(input)
var encodeState = (definition2, input) => Schema.encodeEffect(definition2.schemas.state)(input)
var decodeEvent = (definition2, input) =>
  Schema.decodeUnknownEffect(definition2.schemas.event)(input)
var encodeEvent = (definition2, input) => Schema.encodeEffect(definition2.schemas.event)(input)
var builder = (schemaSources) => {
  const schemas = {
    input: schemaSources.input,
    state: normalizeTaggedSchema(schemaSources.state),
    event: normalizeTaggedSchema(schemaSources.event),
  }
  const state = (tag, config) => ({
    kind: "state",
    tag,
    source: capture(),
    on: config.on ?? {},
  })
  const final = (tag) => ({
    kind: "final",
    tag,
    source: capture(),
  })
  const invoke = (tag, config) => ({
    kind: "invoke",
    tag,
    name: config.name,
    description: config.description,
    source: capture(),
    effect: config.effect,
    retry: config.retry,
    onSuccess: config.onSuccess,
    onFailure: config.onFailure,
    on: config.on ?? {},
  })
  const child = (tag, config) => ({
    kind: "child",
    tag,
    name: config.name,
    description: config.description,
    source: capture(),
    definition: config.definition,
    input: config.input,
    forward: config.forward ?? {},
    onComplete: config.onComplete,
    on: config.on ?? {},
  })
  const make11 = (config) => {
    const runtimeNodes = config.nodes
    const tags = /* @__PURE__ */ new Set()
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
        if (handler === void 0 || "ignore" in handler) continue
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
        if (node.retry !== void 0 && node.retry.name.trim().length === 0) {
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
          if (forwarded === void 0) continue
          if (node.on[eventTag] !== void 0) {
            throw new MachineDefinitionDefect(
              `Machine ${config.id} both forwards and transitions on ${eventTag} in ${node.tag}`,
            )
          }
          if (node.definition.schemas.event.cases[forwarded.target] === void 0) {
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
  return { child, final, guard: namedGuard, invoke, make: make11, state }
}
var selectHandler = (handler, state, event) => {
  if (handler === void 0) return void 0
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
  return void 0
}
var selectOutcome = (handler, args) => {
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
  return void 0
}
var run2 = (definition2, input) =>
  Effect.gen(function* () {
    const environment = yield* Effect.context()
    const parentScope = yield* Scope.Scope
    const initial = definition2.initial(input)
    if (!definition2.nodes.some((node) => node.tag === initial._tag)) {
      return yield* Effect.die(
        new MachineDefinitionDefect(
          `Machine ${definition2.id} initialized to missing state ${initial._tag}`,
        ),
      )
    }
    const stateRef = yield* SubscriptionRef.make(initial)
    const inbox = yield* Queue.unbounded()
    const inspectionRef = yield* SubscriptionRef.make([])
    const terminated = yield* Deferred.make()
    const completion = yield* Deferred.make()
    const status = yield* Ref.make("Running")
    const activeFibers = yield* FiberMap.make()
    const runtimeNodes = definition2.nodes
    const nodes = new Map(runtimeNodes.map((node) => [node.tag, node]))
    const finalTags = new Set(
      runtimeNodes.flatMap((node) => (node.kind === "final" ? [node.tag] : [])),
    )
    let generation = 0
    let childInstanceSequence = 0
    let activeChild
    const emit = (metadata, event) =>
      SubscriptionRef.update(inspectionRef, (events) => [
        ...events,
        { metadata, ...(event === void 0 ? {} : { event }) },
      ])
    const inspection = (projectEvent) =>
      SubscriptionRef.changes(inspectionRef).pipe(
        Stream.mapAccum(
          () => 0,
          (seen, records) => [
            records.length,
            records
              .slice(seen)
              .map((record) =>
                projectEvent === void 0 || record.event === void 0
                  ? record.metadata
                  : { ...record.metadata, details: projectEvent(record.event) },
              ),
          ],
        ),
      )
    const startInvocation = (state) =>
      Effect.gen(function* () {
        const node = nodes.get(state._tag)
        if (node?.kind !== "invoke") return
        const invocationGeneration = generation
        yield* emit({
          _tag: "InvocationStarted",
          machineId: definition2.id,
          stateTag: state._tag,
          invocation: node.name,
          generation: invocationGeneration,
        })
        const operation = node.effect(state)
        const retry2 = node.retry
        const retryingOperation =
          retry2 === void 0
            ? operation
            : Effect.retry(
                operation,
                retry2.schedule.pipe(
                  Schedule.tap((metadata) =>
                    emit({
                      _tag: "InvocationRetryScheduled",
                      machineId: definition2.id,
                      stateTag: state._tag,
                      invocation: node.name,
                      generation: invocationGeneration,
                      policy: retry2.name,
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
                kind: "invocation-failure",
                stateTag: state._tag,
                generation: invocationGeneration,
                error,
              }).pipe(Effect.asVoid),
            onSuccess: (value) =>
              Queue.offer(inbox, {
                kind: "invocation-success",
                stateTag: state._tag,
                generation: invocationGeneration,
                value,
              }).pipe(Effect.asVoid),
          }),
          Effect.onExit((exit2) =>
            Exit.isFailure(exit2) && Cause.hasInterruptsOnly(exit2.cause)
              ? emit({
                  _tag: "InvocationCancelled",
                  machineId: definition2.id,
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
              kind: "invocation-defect",
              stateTag: state._tag,
              generation: invocationGeneration,
              cause,
            }).pipe(Effect.asVoid)
          }),
        )
        yield* FiberMap.run(activeFibers, "active")(invocation)
      })
    const startChild = (state) =>
      Effect.gen(function* () {
        const node = nodes.get(state._tag)
        if (node?.kind !== "child") return
        const childScope = yield* Scope.make()
        yield* Scope.addFinalizer(parentScope, Scope.close(childScope, Exit.void))
        const childGeneration = generation
        const instanceId = `${definition2.id}:${node.name}:${++childInstanceSequence}`
        const childHandle = yield* run2(node.definition, node.input(state)).pipe(
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
          machineId: definition2.id,
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
                kind: "child-defect",
                stateTag: state._tag,
                generation: childGeneration,
                invocation: node.name,
                instanceId,
                cause,
              }).pipe(Effect.asVoid),
            onSuccess: (value) =>
              Queue.offer(inbox, {
                kind: "child-complete",
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
    const startOwnedBehavior = (state) => Effect.andThen(startInvocation(state), startChild(state))
    const closeActiveChild = (cancelled) =>
      Effect.gen(function* () {
        const child = activeChild
        if (child === void 0) return
        activeChild = void 0
        if (cancelled) {
          yield* emit({
            _tag: "ChildCancelled",
            machineId: definition2.id,
            stateTag: child.stateTag,
            invocation: child.invocation,
            instanceId: child.instanceId,
            generation: child.generation,
          })
        }
        yield* Scope.close(child.scope, Exit.void)
      })
    const commit = (previous, next) =>
      Effect.gen(function* () {
        generation += 1
        yield* FiberMap.clear(activeFibers)
        yield* closeActiveChild(true)
        yield* SubscriptionRef.set(stateRef, next)
        yield* emit({
          _tag: "StateChanged",
          machineId: definition2.id,
          previousStateTag: previous._tag,
          nextStateTag: next._tag,
        })
        const isFinal = finalTags.has(next._tag)
        if (isFinal) {
          yield* Ref.set(status, "Completed")
          yield* emit({
            _tag: "MachineCompleted",
            machineId: definition2.id,
            finalStateTag: next._tag,
          })
          yield* Deferred.succeed(completion, next)
        } else {
          yield* startOwnedBehavior(next)
        }
        return !isFinal
      })
    const process = (envelope) =>
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
              machineId: definition2.id,
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
          if (selectedOutcome === void 0) {
            return yield* Effect.die(
              new ProtocolDefect(definition2.id, current._tag, "child-completion"),
            )
          }
          yield* emit({
            _tag: "ChildCompleted",
            machineId: definition2.id,
            stateTag: current._tag,
            invocation: currentNode.name,
            instanceId: envelope.instanceId,
            generation,
            ...(selectedOutcome.branch === void 0 ? {} : { branch: selectedOutcome.branch }),
          })
          const transition2 = selectedOutcome.transition
          const next2 = transition2.reduce({ state: current, value: envelope.value })
          if (next2._tag !== transition2.target) {
            return yield* Effect.die(
              new MachineDefinitionDefect(
                `Machine ${definition2.id} reducer targeted ${transition2.target} but returned ${next2._tag}`,
              ),
            )
          }
          yield* closeActiveChild(false)
          return yield* commit(current, next2)
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
              machineId: definition2.id,
              stateTag: current._tag,
              invocation: currentNode.name,
              generation,
            })
            return yield* Effect.failCause(envelope.cause)
          }
          const isSuccess2 = envelope.kind === "invocation-success"
          const selectedOutcome = isSuccess2
            ? selectOutcome(currentNode.onSuccess, { state: current, value: envelope.value })
            : selectOutcome(currentNode.onFailure, { state: current, error: envelope.error })
          if (selectedOutcome === void 0) {
            return yield* Effect.die(
              new ProtocolDefect(
                definition2.id,
                current._tag,
                isSuccess2 ? "invocation-success" : "invocation-failure",
              ),
            )
          }
          yield* emit({
            _tag: isSuccess2 ? "InvocationSucceeded" : "InvocationFailed",
            machineId: definition2.id,
            stateTag: current._tag,
            invocation: currentNode.name,
            generation,
            ...(selectedOutcome.branch === void 0 ? {} : { branch: selectedOutcome.branch }),
          })
          const transition2 = selectedOutcome.transition
          const next2 = isSuccess2
            ? transition2.reduce({
                state: current,
                value: envelope.value,
              })
            : transition2.reduce({
                state: current,
                error: envelope.error,
              })
          if (next2._tag !== transition2.target) {
            return yield* Effect.die(
              new MachineDefinitionDefect(
                `Machine ${definition2.id} reducer targeted ${transition2.target} but returned ${next2._tag}`,
              ),
            )
          }
          return yield* commit(current, next2)
        }
        yield* emit(
          {
            _tag: "EventReceived",
            machineId: definition2.id,
            stateTag: current._tag,
            eventTag: envelope.event._tag,
          },
          envelope.event,
        )
        if (currentNode?.kind === "child") {
          const forwarded = currentNode.forward[envelope.event._tag]
          if (forwarded !== void 0) {
            const child = activeChild
            if (child === void 0) {
              return yield* Effect.die(
                new MachineDefinitionDefect(
                  `Machine ${definition2.id} has no active instance for child ${currentNode.name}`,
                ),
              )
            }
            const childEvent = forwarded.map({ state: current, event: envelope.event })
            if (childEvent._tag !== forwarded.target) {
              return yield* Effect.die(
                new MachineDefinitionDefect(
                  `Machine ${definition2.id} forwards to ${forwarded.target} but returned ${childEvent._tag}`,
                ),
              )
            }
            yield* emit({
              _tag: "ChildEventForwarded",
              machineId: definition2.id,
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
                    machineId: definition2.id,
                    stateTag: current._tag,
                    invocation: currentNode.name,
                    instanceId: child.instanceId,
                    generation,
                  }),
                  Effect.failCause(cause),
                ),
              ),
            )
            yield* Deferred.succeed(envelope.reply, void 0)
            return true
          }
        }
        const handler =
          currentNode?.kind === "state" ||
          currentNode?.kind === "invoke" ||
          currentNode?.kind === "child"
            ? currentNode.on[envelope.event._tag]
            : void 0
        const selected = selectHandler(handler, current, envelope.event)
        if (selected === void 0) {
          const defect = new ProtocolDefect(definition2.id, current._tag, envelope.event._tag)
          yield* emit({
            _tag: "MachineDefected",
            machineId: definition2.id,
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
            machineId: definition2.id,
            stateTag: current._tag,
            eventTag: envelope.event._tag,
          })
          yield* Deferred.succeed(envelope.reply, void 0)
          return true
        }
        const transition = selected.transition
        yield* emit({
          _tag: "TransitionSelected",
          machineId: definition2.id,
          sourceStateTag: current._tag,
          targetStateTag: transition.target,
          eventTag: envelope.event._tag,
          ...(selected.branch === void 0 ? {} : { branch: selected.branch }),
        })
        const next = transition.reduce({ state: current, event: envelope.event })
        if (next._tag !== transition.target) {
          return yield* Effect.die(
            new MachineDefinitionDefect(
              `Machine ${definition2.id} reducer targeted ${transition.target} but returned ${next._tag}`,
            ),
          )
        }
        const continueRunning = yield* commit(current, next)
        yield* Deferred.succeed(envelope.reply, void 0)
        return continueRunning
      })
    yield* emit({
      _tag: "MachineStarted",
      machineId: definition2.id,
      initialStateTag: initial._tag,
    })
    const initialIsFinal = finalTags.has(initial._tag)
    if (initialIsFinal) {
      yield* Ref.set(status, "Completed")
      yield* Deferred.succeed(completion, initial)
      yield* Deferred.succeed(terminated, void 0)
    } else {
      let continueRunning = true
      yield* Effect.whileLoop({
        while: () => continueRunning,
        body: () => Queue.take(inbox).pipe(Effect.flatMap(process)),
        step: (next) => {
          continueRunning = next
        },
      }).pipe(
        Effect.onExit((exit2) =>
          Effect.gen(function* () {
            if (Exit.isFailure(exit2)) {
              yield* Ref.set(status, "Defected")
              yield* Deferred.failCause(completion, exit2.cause)
              yield* Deferred.failCause(terminated, exit2.cause)
            } else {
              yield* Deferred.succeed(terminated, void 0)
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
      inspection: inspection(),
      inspect: (projectEvent) => inspection(projectEvent),
      completion: Deferred.await(completion),
      can: (event) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(stateRef)
          const node = nodes.get(current._tag)
          if (node?.kind === "child") {
            const forwarded = node.forward[event._tag]
            if (forwarded !== void 0) {
              const child = activeChild
              if (child === void 0) return false
              const childEvent = forwarded.map({ state: current, event })
              if (childEvent._tag !== forwarded.target) return false
              return yield* child.handle.can(childEvent)
            }
          }
          if (node?.kind !== "state" && node?.kind !== "invoke" && node?.kind !== "child") {
            return false
          }
          return selectHandler(node.on[event._tag], current, event) !== void 0
        }),
      send: (event) =>
        Effect.gen(function* () {
          const currentStatus = yield* Ref.get(status)
          if (currentStatus === "Completed") {
            const current = yield* SubscriptionRef.get(stateRef)
            return yield* Effect.die(new ProtocolDefect(definition2.id, current._tag, event._tag))
          }
          if (currentStatus === "Defected") {
            return yield* Deferred.await(terminated)
          }
          const reply = yield* Deferred.make()
          yield* Queue.offer(inbox, { kind: "external", event, reply })
          yield* Effect.raceFirst(Deferred.await(reply), Deferred.await(terminated))
        }),
    }
  })

// src/Attach.ts
import * as Cause2 from "effect/Cause"
import * as Effect2 from "effect/Effect"
import * as Exit2 from "effect/Exit"
import * as Queue2 from "effect/Queue"
import * as Ref2 from "effect/Ref"
import * as Schema5 from "effect/Schema"
// src/Announcement.ts
import * as Schema4 from "effect/Schema"
import * as Stream2 from "effect/Stream"

// ../core/src/Graph.ts
var Graph_exports = {}
__export(Graph_exports, {
  activity: () => activity,
  focus: () => focus,
  fromDefinition: () => fromDefinition,
})

import * as Schema2 from "effect/Schema"

// ../core/src/SourceLocation.ts
var internalFrame = (file) =>
  /(?:^|\/)src\/(?:Machine|Source)\.[cm]?[jt]s$/.test(file) ||
  /(?:^|\/)dist\/(?:Machine|Source)\.js$/.test(file) ||
  /node_modules\/effect-state-machine\/(?:src|dist)\/(?:Machine|Source)/.test(file)
var location = (file, line, column, functionName) => {
  const parsedLine = Number(line)
  const parsedColumn = Number(column)
  if (
    file.length === 0 ||
    file === "<anonymous>" ||
    file.startsWith("node:") ||
    (/^https?:/.test(file) && /\.html(?:$|[?#])/.test(file)) ||
    !Number.isInteger(parsedLine) ||
    !Number.isInteger(parsedColumn) ||
    parsedLine < 1 ||
    parsedColumn < 1
  ) {
    return void 0
  }
  let decoded = file
  if (decoded.startsWith("file://")) {
    try {
      decoded = decodeURIComponent(new URL(decoded).pathname)
    } catch {
      return void 0
    }
  }
  return {
    file: decoded,
    line: parsedLine,
    column: parsedColumn,
    ...(functionName === void 0 || functionName.length === 0 ? {} : { functionName }),
  }
}
var parseFrame = (frame) => {
  const trimmed = frame.trim()
  const nodeWithFunction = /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/.exec(trimmed)
  if (nodeWithFunction !== null) {
    return location(
      nodeWithFunction[2],
      nodeWithFunction[3],
      nodeWithFunction[4],
      nodeWithFunction[1],
    )
  }
  const node = /^at\s+(.+):(\d+):(\d+)$/.exec(trimmed)
  if (node !== null) return location(node[1], node[2], node[3])
  const browser = /^(.*?)@(.+):(\d+):(\d+)$/.exec(trimmed)
  if (browser !== null) return location(browser[2], browser[3], browser[4], browser[1])
  return void 0
}
var resolve = (reference, options) => {
  const stack = reference?.stack()
  if (stack === void 0) return void 0
  for (const frame of stack.split("\n")) {
    const parsed = parseFrame(frame)
    if (parsed === void 0 || internalFrame(parsed.file)) continue
    const mapped = options?.map === void 0 ? parsed : options.map(parsed)
    if (mapped === void 0 || internalFrame(mapped.file)) continue
    return mapped
  }
  return void 0
}

// ../core/src/Graph.ts
var focus = (graph, center, depth) => {
  if (depth === "full") return graph
  if (!graph.nodes.some((node) => node.id === center)) {
    return { ...graph, nodes: [], edges: [], ignores: [] }
  }
  const visible = /* @__PURE__ */ new Set([center])
  let frontier = [center]
  for (let level = 0; level < depth; level += 1) {
    const next = []
    for (const source of frontier) {
      for (const edge of graph.edges) {
        if (edge.source !== source || visible.has(edge.target)) continue
        visible.add(edge.target)
        next.push(edge.target)
      }
    }
    frontier = next
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    ignores: graph.ignores.filter((ignore) => visible.has(ignore.source)),
  }
}
var activity = (graph, activeNode, transitions) => ({
  ...(activeNode === void 0 || !graph.nodes.some((node) => node.id === activeNode)
    ? {}
    : { activeNode }),
  traversedEdges: graph.edges.flatMap((edge) =>
    transitions.some(
      (transition) =>
        transition.source === edge.source &&
        transition.target === edge.target &&
        (transition.event === void 0 || transition.event === edge.event?.tag) &&
        (transition.branchIndex === void 0 || transition.branchIndex === edge.branch?.index),
    )
      ? [edge.id]
      : [],
  ),
})
var descriptionOf = (schema) => {
  if (schema === void 0) return void 0
  const description = Schema2.resolveAnnotations(schema)?.description
  return typeof description === "string" ? description : void 0
}
var titleOf = (schema, fallback) => {
  if (schema === void 0) return fallback
  const title = Schema2.resolveAnnotations(schema)?.title
  return typeof title === "string" ? title : fallback
}
var fromDefinition = (definition2, options) => {
  const nodes = definition2.nodes.map((node) => {
    const schema = definition2.schemas.state.cases[node.tag]
    const description = descriptionOf(schema)
    const location2 = resolve(node.source, { map: options?.mapSource })
    return {
      id: node.tag,
      title: titleOf(schema, node.tag),
      kind: node.kind,
      ...(location2 === void 0 ? {} : { location: location2 }),
      ...(description === void 0 ? {} : { description }),
      ...(node.kind === "invoke"
        ? {
            invocation: {
              name: node.name,
              ...(node.description === void 0 ? {} : { description: node.description }),
              ...(node.retry === void 0
                ? {}
                : {
                    retry: {
                      name: node.retry.name,
                      ...(node.retry.description === void 0
                        ? {}
                        : { description: node.retry.description }),
                    },
                  }),
            },
          }
        : {}),
      ...(node.kind === "child"
        ? {
            child: {
              name: node.name,
              ...(node.description === void 0 ? {} : { description: node.description }),
              definition: fromDefinition(node.definition, options),
              forwards: Object.entries(node.forward).flatMap(([parentEventTag, forwarded]) => {
                if (forwarded === void 0) return []
                const parentDescription = descriptionOf(
                  definition2.schemas.event.cases[parentEventTag],
                )
                const childDescription = descriptionOf(
                  node.definition.schemas.event.cases[forwarded.target],
                )
                return [
                  {
                    parentEvent: {
                      tag: parentEventTag,
                      ...(parentDescription === void 0 ? {} : { description: parentDescription }),
                    },
                    childEvent: {
                      tag: forwarded.target,
                      ...(childDescription === void 0 ? {} : { description: childDescription }),
                    },
                    ...(forwarded.description === void 0
                      ? {}
                      : { description: forwarded.description }),
                  },
                ]
              }),
            },
          }
        : {}),
    }
  })
  const edges = []
  const ignores = []
  for (const node of definition2.nodes) {
    if (node.kind === "final") continue
    for (const [eventTag, handler] of Object.entries(node.on)) {
      if (handler === void 0) continue
      const eventDescription = descriptionOf(definition2.schemas.event.cases[eventTag])
      const event = {
        tag: eventTag,
        ...(eventDescription === void 0 ? {} : { description: eventDescription }),
      }
      if ("ignore" in handler) {
        ignores.push({
          source: node.tag,
          event,
          ...(handler.ignore.description === void 0
            ? {}
            : { description: handler.ignore.description }),
        })
        continue
      }
      if (!("branches" in handler)) {
        edges.push({
          source: node.tag,
          target: handler.target,
          event,
          ...(handler.description === void 0 ? {} : { description: handler.description }),
        })
        continue
      }
      for (const [index, branch] of handler.branches.entries()) {
        const branchMetadata =
          "otherwise" in branch
            ? { kind: "otherwise", index }
            : {
                kind: "guard",
                index,
                name: branch.when.name,
                ...(branch.when.description === void 0
                  ? {}
                  : { description: branch.when.description }),
              }
        edges.push({
          source: node.tag,
          target: branch.target,
          event,
          branch: branchMetadata,
          ...(branch.description === void 0 ? {} : { description: branch.description }),
        })
      }
    }
    if (node.kind === "invoke") {
      for (const [kind, outcomeHandler] of [
        ["success", node.onSuccess],
        ["failure", node.onFailure],
      ]) {
        if (!("branches" in outcomeHandler)) {
          edges.push({
            source: node.tag,
            target: outcomeHandler.target,
            outcome: { kind },
            ...(outcomeHandler.description === void 0
              ? {}
              : { description: outcomeHandler.description }),
          })
          continue
        }
        for (const [index, outcome] of outcomeHandler.branches.entries()) {
          const branch =
            "otherwise" in outcome
              ? { kind: "otherwise", index }
              : {
                  kind: "guard",
                  index,
                  name: outcome.when.name,
                  ...(outcome.when.description === void 0
                    ? {}
                    : { description: outcome.when.description }),
                }
          edges.push({
            source: node.tag,
            target: outcome.target,
            outcome: { kind },
            branch,
            ...(outcome.description === void 0 ? {} : { description: outcome.description }),
          })
        }
      }
    }
    if (node.kind === "child") {
      const outcomeHandler = node.onComplete
      if (!("branches" in outcomeHandler)) {
        edges.push({
          source: node.tag,
          target: outcomeHandler.target,
          outcome: { kind: "completion" },
          ...(outcomeHandler.description === void 0
            ? {}
            : { description: outcomeHandler.description }),
        })
      } else {
        for (const [index, outcome] of outcomeHandler.branches.entries()) {
          const branch =
            "otherwise" in outcome
              ? { kind: "otherwise", index }
              : {
                  kind: "guard",
                  index,
                  name: outcome.when.name,
                  ...(outcome.when.description === void 0
                    ? {}
                    : { description: outcome.when.description }),
                }
          edges.push({
            source: node.tag,
            target: outcome.target,
            outcome: { kind: "completion" },
            branch,
            ...(outcome.description === void 0 ? {} : { description: outcome.description }),
          })
        }
      }
    }
  }
  const identifiedEdges = edges.map((edge, index) => {
    const authoredNode = definition2.nodes.find((node) => node.tag === edge.source)
    let location2 = nodes.find((node) => node.id === edge.source)?.location
    if (authoredNode !== void 0 && edge.branch?.kind === "guard") {
      const handler =
        edge.event !== void 0 && authoredNode.kind !== "final"
          ? authoredNode.on[edge.event.tag]
          : authoredNode.kind === "invoke" && edge.outcome?.kind === "success"
            ? authoredNode.onSuccess
            : authoredNode.kind === "invoke" && edge.outcome?.kind === "failure"
              ? authoredNode.onFailure
              : authoredNode.kind === "child" && edge.outcome?.kind === "completion"
                ? authoredNode.onComplete
                : void 0
      if (handler !== void 0 && "branches" in handler) {
        const branch = handler.branches[edge.branch.index]
        if (branch !== void 0 && "when" in branch) {
          location2 = resolve(branch.when.source, { map: options?.mapSource }) ?? location2
        }
      }
    }
    return {
      ...edge,
      id: `${edge.source}:${edge.event?.tag ?? edge.outcome?.kind ?? "transition"}:${edge.branch?.index ?? 0}:${edge.target}:${index}`,
      ...(location2 === void 0 ? {} : { location: location2 }),
    }
  })
  return {
    id: definition2.id,
    nodes,
    edges: identifiedEdges,
    ignores,
    ...(definition2.description === void 0 ? {} : { description: definition2.description }),
  }
}

// src/Protocol.ts
import * as Schema3 from "effect/Schema"

var VERSION = 1
var DEFAULT_PORT = 4747
var APP_PATH = "/app"
var Json = Schema3.Unknown
var SourceLocation = Schema3.Struct({
  file: Schema3.String,
  line: Schema3.Number,
  column: Schema3.Number,
  functionName: Schema3.optionalKey(Schema3.String),
})
var EventReference = Schema3.Struct({
  tag: Schema3.String,
  description: Schema3.optionalKey(Schema3.String),
})
var GraphEdgeBranch = Schema3.Union([
  Schema3.Struct({
    kind: Schema3.Literals(["guard"]),
    index: Schema3.Number,
    name: Schema3.String,
    description: Schema3.optionalKey(Schema3.String),
  }),
  Schema3.Struct({
    kind: Schema3.Literals(["otherwise"]),
    index: Schema3.Number,
  }),
])
var GraphEdge = Schema3.Struct({
  id: Schema3.String,
  source: Schema3.String,
  target: Schema3.String,
  location: Schema3.optionalKey(SourceLocation),
  event: Schema3.optionalKey(EventReference),
  outcome: Schema3.optionalKey(
    Schema3.Struct({ kind: Schema3.Literals(["success", "failure", "completion"]) }),
  ),
  description: Schema3.optionalKey(Schema3.String),
  branch: Schema3.optionalKey(GraphEdgeBranch),
})
var GraphIgnore = Schema3.Struct({
  source: Schema3.String,
  event: EventReference,
  description: Schema3.optionalKey(Schema3.String),
})
var GraphNode = Schema3.Struct({
  id: Schema3.String,
  title: Schema3.String,
  description: Schema3.optionalKey(Schema3.String),
  kind: Schema3.Literals(["state", "invoke", "child", "final"]),
  location: Schema3.optionalKey(SourceLocation),
  invocation: Schema3.optionalKey(
    Schema3.Struct({
      name: Schema3.String,
      description: Schema3.optionalKey(Schema3.String),
      retry: Schema3.optionalKey(
        Schema3.Struct({
          name: Schema3.String,
          description: Schema3.optionalKey(Schema3.String),
        }),
      ),
    }),
  ),
  child: Schema3.optionalKey(
    Schema3.Struct({
      name: Schema3.String,
      description: Schema3.optionalKey(Schema3.String),
      definition: Schema3.suspend(() => SerializedGraph),
      forwards: Schema3.Array(
        Schema3.Struct({
          parentEvent: EventReference,
          childEvent: EventReference,
          description: Schema3.optionalKey(Schema3.String),
        }),
      ),
    }),
  ),
})
var SerializedGraph = Schema3.Struct({
  id: Schema3.String,
  description: Schema3.optionalKey(Schema3.String),
  nodes: Schema3.Array(GraphNode),
  edges: Schema3.Array(GraphEdge),
  ignores: Schema3.Array(GraphIgnore),
})
var SelectedBranch = Schema3.Union([
  Schema3.Struct({
    kind: Schema3.Literals(["guard"]),
    index: Schema3.Number,
    name: Schema3.String,
  }),
  Schema3.Struct({
    kind: Schema3.Literals(["otherwise"]),
    index: Schema3.Number,
  }),
])
var invocationLifecycleFields = {
  machineId: Schema3.String,
  stateTag: Schema3.String,
  invocation: Schema3.String,
  generation: Schema3.Number,
  branch: Schema3.optionalKey(SelectedBranch),
}
var childLifecycleFields = {
  machineId: Schema3.String,
  stateTag: Schema3.String,
  invocation: Schema3.String,
  instanceId: Schema3.String,
  generation: Schema3.Number,
}
var InspectionEvent = Schema3.Union([
  Schema3.TaggedStruct("MachineStarted", {
    machineId: Schema3.String,
    initialStateTag: Schema3.String,
  }),
  Schema3.TaggedStruct("EventReceived", {
    machineId: Schema3.String,
    stateTag: Schema3.String,
    eventTag: Schema3.String,
    /** The schema-encoded event value; absent when encoding was not possible. */
    details: Schema3.optionalKey(Json),
  }),
  Schema3.TaggedStruct("TransitionSelected", {
    machineId: Schema3.String,
    sourceStateTag: Schema3.String,
    targetStateTag: Schema3.String,
    eventTag: Schema3.String,
    branch: Schema3.optionalKey(SelectedBranch),
  }),
  Schema3.TaggedStruct("EventIgnored", {
    machineId: Schema3.String,
    stateTag: Schema3.String,
    eventTag: Schema3.String,
  }),
  Schema3.TaggedStruct("StateChanged", {
    machineId: Schema3.String,
    previousStateTag: Schema3.String,
    nextStateTag: Schema3.String,
  }),
  Schema3.TaggedStruct("InvocationStarted", invocationLifecycleFields),
  Schema3.TaggedStruct("InvocationSucceeded", invocationLifecycleFields),
  Schema3.TaggedStruct("InvocationFailed", invocationLifecycleFields),
  Schema3.TaggedStruct("InvocationCancelled", invocationLifecycleFields),
  Schema3.TaggedStruct("InvocationDefected", invocationLifecycleFields),
  Schema3.TaggedStruct("InvocationRetryScheduled", {
    machineId: Schema3.String,
    stateTag: Schema3.String,
    invocation: Schema3.String,
    generation: Schema3.Number,
    policy: Schema3.String,
    attempt: Schema3.Number,
    delayMillis: Schema3.Number,
  }),
  Schema3.TaggedStruct("ChildStarted", {
    ...childLifecycleFields,
    childDefinitionId: Schema3.String,
  }),
  Schema3.TaggedStruct("ChildEventForwarded", {
    ...childLifecycleFields,
    parentEventTag: Schema3.String,
    childEventTag: Schema3.String,
  }),
  Schema3.TaggedStruct("ChildCompleted", {
    ...childLifecycleFields,
    branch: Schema3.optionalKey(SelectedBranch),
  }),
  Schema3.TaggedStruct("ChildCancelled", childLifecycleFields),
  Schema3.TaggedStruct("ChildDefected", childLifecycleFields),
  Schema3.TaggedStruct("MachineCompleted", {
    machineId: Schema3.String,
    finalStateTag: Schema3.String,
  }),
  Schema3.TaggedStruct("MachineDefected", {
    machineId: Schema3.String,
    stateTag: Schema3.String,
    eventTag: Schema3.String,
    defect: Schema3.Literals(["ProtocolDefect"]),
  }),
])
var AppIdentity = Schema3.Struct({
  name: Schema3.String,
  runtime: Schema3.Literals(["browser", "node", "other"]),
})
var MachineIdentity = Schema3.Struct({
  id: Schema3.String,
  description: Schema3.optionalKey(Schema3.String),
})
var QuickEventControl = Schema3.Struct({
  id: Schema3.String,
  label: Schema3.String,
  description: Schema3.optionalKey(Schema3.String),
  group: Schema3.optionalKey(Schema3.String),
  kind: Schema3.Literals(["event", "factory"]),
  /** Known for predefined event values; factories only reveal their tag when run. */
  eventTag: Schema3.optionalKey(Schema3.String),
})
var Hello = Schema3.TaggedStruct("Hello", {
  protocolVersion: Schema3.Number,
  sessionId: Schema3.String,
  parentSessionId: Schema3.optionalKey(Schema3.String),
  app: AppIdentity,
  machine: MachineIdentity,
  graph: SerializedGraph,
  jsonSchemas: Schema3.Struct({
    states: Schema3.Record(Schema3.String, Json),
    events: Schema3.Record(Schema3.String, Json),
  }),
  quickEvents: Schema3.Array(QuickEventControl),
})
var FactBody = Schema3.Union([
  Schema3.TaggedStruct("Inspection", { event: InspectionEvent }),
  Schema3.TaggedStruct("StateCommitted", { state: Json }),
  Schema3.TaggedStruct("StateEncodingFailed", {
    stateTag: Schema3.String,
    message: Schema3.String,
  }),
  Schema3.TaggedStruct("StatusChanged", { status: Schema3.Literals(["completed", "defected"]) }),
  Schema3.TaggedStruct("HistoryTruncated", { dropped: Schema3.Number }),
])
var Fact = Schema3.TaggedStruct("Fact", {
  sessionId: Schema3.String,
  sequence: Schema3.Number,
  body: FactBody,
})
var DispatchCommand = Schema3.Union([
  Schema3.TaggedStruct("Quick", { id: Schema3.String }),
  Schema3.TaggedStruct("Custom", { event: Json }),
])
var Dispatch = Schema3.TaggedStruct("Dispatch", {
  sessionId: Schema3.String,
  correlationId: Schema3.String,
  command: DispatchCommand,
})
var DispatchFailureReason = Schema3.Literals([
  "not-found",
  "factory-threw",
  "invalid",
  "unavailable",
  "not-running",
  "disconnected",
])
var DispatchOutcome = Schema3.TaggedStruct("DispatchOutcome", {
  sessionId: Schema3.String,
  correlationId: Schema3.String,
  result: Schema3.Union([
    Schema3.TaggedStruct("Accepted", {}),
    Schema3.TaggedStruct("Rejected", {
      reason: DispatchFailureReason,
      message: Schema3.optionalKey(Schema3.String),
    }),
  ]),
})
var SessionEnded = Schema3.TaggedStruct("SessionEnded", {
  sessionId: Schema3.String,
})
var SessionDisconnected = Schema3.TaggedStruct("SessionDisconnected", {
  sessionId: Schema3.String,
})
var SessionRejected = Schema3.TaggedStruct("SessionRejected", {
  sessionId: Schema3.String,
  supportedVersion: Schema3.Number,
  announcedVersion: Schema3.Number,
  message: Schema3.String,
})
var Message = Schema3.Union([
  Hello,
  Fact,
  Dispatch,
  DispatchOutcome,
  SessionEnded,
  SessionDisconnected,
  SessionRejected,
])
var MessageFromJsonString = Schema3.fromJsonString(Message)
var truncateOldest = (sessionId, facts) => {
  const head = facts[0]
  if (head === void 0) return facts
  if (head.body._tag === "HistoryTruncated") {
    return [
      { ...head, body: { _tag: "HistoryTruncated", dropped: head.body.dropped + 1 } },
      ...facts.slice(2),
    ]
  }
  return [
    {
      _tag: "Fact",
      sessionId,
      sequence: head.sequence,
      body: { _tag: "HistoryTruncated", dropped: 1 },
    },
    ...facts.slice(1),
  ]
}
var decodeMessage = Schema3.decodeUnknownEffect(Message)
var encodeMessage = Schema3.encodeEffect(Message)
var decodeMessageString = Schema3.decodeEffect(MessageFromJsonString)
var encodeMessageString = Schema3.encodeEffect(MessageFromJsonString)

// src/Announcement.ts
var jsonSchemas = (cases) => {
  const documents = {}
  for (const [tag, caseSchema] of Object.entries(cases)) {
    try {
      documents[tag] = Schema4.toJsonSchemaDocument(caseSchema)
    } catch {}
  }
  return documents
}
var make6 = (options) => ({
  _tag: "Hello",
  protocolVersion: VERSION,
  sessionId: options.sessionId,
  ...(options.parentSessionId === void 0 ? {} : { parentSessionId: options.parentSessionId }),
  app: options.app,
  machine: {
    id: options.definition.id,
    ...(options.definition.description === void 0
      ? {}
      : { description: options.definition.description }),
  },
  graph: Graph_exports.fromDefinition(options.definition, { mapSource: options.mapSource }),
  jsonSchemas: {
    states: jsonSchemas(options.definition.schemas.state.cases),
    events: jsonSchemas(options.definition.schemas.event.cases),
  },
  quickEvents: options.quickEvents ?? [],
})

// src/Transport.ts
import * as Context from "effect/Context"
import * as Data from "effect/Data"

var TransportError = class extends Data.TaggedError("TransportError") {}
var StudioTransport = class extends Context.Service()(
  "@effect-state-machine/studio-client/StudioTransport",
) {}

// src/Attach.ts
var detectRuntime = () => {
  if ("document" in globalThis) return "browser"
  if ("process" in globalThis) return "node"
  return "other"
}
var attach = (options) =>
  Effect2.gen(function* () {
    const transport = yield* StudioTransport
    const quickEvents = options.quickEvents ?? []
    const quickEventIds = /* @__PURE__ */ new Set()
    for (const quickEvent of quickEvents) {
      if (quickEventIds.has(quickEvent.id)) {
        return yield* Effect2.die(
          new Error(`Duplicate studio quick event identifier: ${quickEvent.id}`),
        )
      }
      quickEventIds.add(quickEvent.id)
    }
    const controls = quickEvents.map((quickEvent) => ({
      id: quickEvent.id,
      label: quickEvent.label,
      ...(quickEvent.description === void 0 ? {} : { description: quickEvent.description }),
      ...(quickEvent.group === void 0 ? {} : { group: quickEvent.group }),
      kind: "make" in quickEvent ? "factory" : "event",
      ...("event" in quickEvent ? { eventTag: quickEvent.event._tag } : {}),
    }))
    const sessionId = yield* Effect2.sync(() => globalThis.crypto.randomUUID())
    const hello = make6({
      definition: options.definition,
      sessionId,
      ...(options.parentSessionId === void 0 ? {} : { parentSessionId: options.parentSessionId }),
      app: { name: options.appName ?? options.definition.id, runtime: detectRuntime() },
      quickEvents: controls,
      ...(options.mapSource === void 0 ? {} : { mapSource: options.mapSource }),
    })
    const bufferLimit = options.bufferLimit ?? 1e4
    const reconnectInterval = options.reconnectInterval ?? "1 second"
    const buffer = yield* Ref2.make({ facts: [], sequence: 0 })
    const wake = yield* Queue2.sliding(1)
    const terminated = yield* Ref2.make(false)
    const rejected = yield* Ref2.make(false)
    const active = yield* Ref2.make(void 0)
    const emit = (body) =>
      Ref2.update(buffer, (current) => {
        const facts = [
          ...current.facts,
          { _tag: "Fact", sessionId, sequence: current.sequence, body },
        ]
        return {
          facts: facts.length > bufferLimit ? truncateOldest(sessionId, facts) : facts,
          sequence: current.sequence + 1,
        }
      }).pipe(Effect2.andThen(Queue2.offer(wake, void 0)))
    const encodeState2 = (value) => Machine_exports.encodeState(options.definition, value)
    const encodeEventDetails = (event) => {
      try {
        return Schema5.encodeUnknownSync(options.definition.schemas.event)(event)
      } catch {
        return void 0
      }
    }
    const emitState = (value) =>
      encodeState2(value).pipe(
        Effect2.flatMap((encoded) => emit({ _tag: "StateCommitted", state: encoded })),
        Effect2.catch((cause) =>
          emit({ _tag: "StateEncodingFailed", stateTag: value._tag, message: String(cause) }),
        ),
      )
    const initial = yield* options.handle.snapshot
    yield* emitState(initial)
    const lastState = yield* Ref2.make(initial)
    yield* options.handle.changes.pipe(
      Stream2.runForEach((value) =>
        Effect2.gen(function* () {
          const previous = yield* Ref2.get(lastState)
          if (Object.is(previous, value)) return
          yield* Ref2.set(lastState, value)
          yield* emitState(value)
        }),
      ),
      Effect2.forkScoped,
    )
    yield* options.handle.inspect(encodeEventDetails).pipe(
      Stream2.runForEach((event) => emit({ _tag: "Inspection", event })),
      Effect2.forkScoped,
    )
    yield* options.handle.completion.pipe(
      Effect2.exit,
      Effect2.flatMap((exit2) =>
        Effect2.gen(function* () {
          if (Exit2.isSuccess(exit2)) {
            yield* Ref2.set(terminated, true)
            yield* emit({ _tag: "StatusChanged", status: "completed" })
          } else if (!Cause2.hasInterruptsOnly(exit2.cause)) {
            yield* Ref2.set(terminated, true)
            yield* emit({ _tag: "StatusChanged", status: "defected" })
          }
        }),
      ),
      Effect2.forkScoped,
    )
    const rejectedOutcome = (reason, message) => ({
      _tag: "Rejected",
      reason,
      ...(message === void 0 ? {} : { message }),
    })
    const dispatchEvent = (event) =>
      Effect2.gen(function* () {
        if (yield* Ref2.get(terminated)) return rejectedOutcome("not-running")
        if (!(yield* options.handle.can(event))) {
          return rejectedOutcome(
            "unavailable",
            `The machine does not accept ${event._tag} in its current state.`,
          )
        }
        yield* options.handle.send(event)
        return { _tag: "Accepted" }
      })
    const handleDispatch = (command) => {
      switch (command._tag) {
        case "Quick": {
          const quickEvent = quickEvents.find((candidate) => candidate.id === command.id)
          if (quickEvent === void 0) {
            return Effect2.succeed(rejectedOutcome("not-found"))
          }
          const event =
            "make" in quickEvent
              ? Effect2.try({ try: quickEvent.make, catch: (cause) => String(cause) })
              : Effect2.succeed(quickEvent.event)
          return event.pipe(
            Effect2.flatMap(dispatchEvent),
            Effect2.catch((message) => Effect2.succeed(rejectedOutcome("factory-threw", message))),
          )
        }
        case "Custom": {
          return Machine_exports.decodeEvent(options.definition, command.event).pipe(
            Effect2.flatMap(dispatchEvent),
            Effect2.catch((cause) => Effect2.succeed(rejectedOutcome("invalid", String(cause)))),
          )
        }
      }
    }
    const onMessage = (connection, message) => {
      switch (message._tag) {
        case "Dispatch": {
          if (message.sessionId !== sessionId) return Effect2.void
          return handleDispatch(message.command).pipe(
            Effect2.flatMap((result) =>
              connection.send({
                _tag: "DispatchOutcome",
                sessionId,
                correlationId: message.correlationId,
                result,
              }),
            ),
            Effect2.catch(() => Effect2.void),
          )
        }
        case "SessionRejected": {
          if (message.sessionId !== sessionId) return Effect2.void
          return Ref2.set(rejected, true).pipe(
            Effect2.andThen(Effect2.fail(new TransportError({ reason: "closed" }))),
          )
        }
        default:
          return Effect2.void
      }
    }
    const pump = (connection) =>
      Effect2.gen(function* () {
        while (true) {
          const current = yield* Ref2.get(buffer)
          const fact = current.facts[0]
          if (fact === void 0) {
            yield* Queue2.take(wake).pipe(Effect2.catch(() => Effect2.void))
            continue
          }
          yield* connection.send(fact)
          yield* Ref2.update(buffer, (state) =>
            state.facts[0] === fact ? { ...state, facts: state.facts.slice(1) } : state,
          )
        }
      })
    const listen = (connection) =>
      Effect2.gen(function* () {
        while (true) {
          const message = yield* Queue2.take(connection.messages)
          yield* onMessage(connection, message)
        }
      })
    const runOnce = Effect2.scoped(
      Effect2.gen(function* () {
        const connection = yield* transport.connect
        yield* connection.send(hello)
        yield* Ref2.set(active, connection)
        yield* Effect2.forkScoped(pump(connection))
        yield* listen(connection)
      }).pipe(Effect2.ensuring(Ref2.set(active, void 0))),
    )
    yield* Effect2.gen(function* () {
      while (!(yield* Ref2.get(rejected))) {
        yield* runOnce.pipe(Effect2.catchCause(() => Effect2.void))
        if (yield* Ref2.get(rejected)) break
        yield* Effect2.sleep(reconnectInterval)
      }
    }).pipe(Effect2.forkScoped)
    yield* Effect2.addFinalizer(() =>
      Effect2.gen(function* () {
        const connection = yield* Ref2.get(active)
        if (connection === void 0) return
        yield* connection
          .send({ _tag: "SessionEnded", sessionId })
          .pipe(Effect2.catch(() => Effect2.void))
      }),
    )
    return { sessionId }
  })

// src/WebSocketTransport.ts
import * as Deferred2 from "effect/Deferred"
import * as Effect3 from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue3 from "effect/Queue"
import * as Socket from "effect/unstable/socket/Socket"

var defaultUrl = `ws://127.0.0.1:${DEFAULT_PORT}${APP_PATH}`
var make9 = (options) => ({
  connect: Effect3.gen(function* () {
    const socket = yield* Socket.makeWebSocket(options?.url ?? defaultUrl, {
      openTimeout: "3 seconds",
    }).pipe(Effect3.provide(Socket.layerWebSocketConstructorGlobal))
    const inbound = yield* Queue3.unbounded()
    const opened = yield* Deferred2.make()
    yield* socket
      .runString(
        (text) =>
          decodeMessageString(text).pipe(
            Effect3.flatMap((message) => Queue3.offer(inbound, message)),
            Effect3.catch(() => Effect3.void),
          ),
        { onOpen: Deferred2.succeed(opened, void 0) },
      )
      .pipe(
        Effect3.onExit((exit2) =>
          Effect3.gen(function* () {
            yield* Deferred2.fail(
              opened,
              new TransportError({ reason: "unavailable", cause: exit2 }),
            )
            yield* Queue3.end(inbound)
          }),
        ),
        Effect3.forkScoped,
      )
    yield* Deferred2.await(opened)
    const write = yield* socket.writer
    const connection = {
      send: (message) =>
        encodeMessageString(message).pipe(
          Effect3.flatMap(write),
          Effect3.mapError((cause) => new TransportError({ reason: "send-failed", cause })),
        ),
      messages: inbound,
    }
    return connection
  }),
})

// examples/checkout-demo.ts
var PaymentDeclined = class extends Schema6.TaggedError()("PaymentDeclined", {
  message: Schema6.String,
}) {}
var Orders = class extends Context2.Service()("demo/Orders") {}
var Input = Schema6.Struct({})
var State = Machine_exports.taggedUnion({
  Browsing: { fields: { items: Schema6.Number }, description: "Build a cart." },
  Checkout: { fields: { items: Schema6.Number }, description: "Review the order." },
  PlacingOrder: { fields: { items: Schema6.Number }, description: "Place the order." },
  PaymentFailed: {
    fields: { items: Schema6.Number, message: Schema6.String },
    description: "Let the shopper retry an expected decline.",
  },
  Ordered: { fields: { orderId: Schema6.String }, description: "Finish with an order." },
})
var Event = Machine_exports.taggedUnion({
  AddItem: { fields: { amount: Schema6.Number }, description: "Add items to the cart." },
  BeginCheckout: { fields: {}, description: "Review the cart." },
  SubmitOrder: { fields: {}, description: "Place the reviewed order." },
  RetryPayment: { fields: {}, description: "Retry a declined payment." },
  BackToShop: { fields: {}, description: "Return to browsing." },
})
var checkout = Machine_exports.builder({ input: Input, state: State, event: Event })
var definition = checkout.make({
  id: "checkout",
  description: "A checkout flow with expected payment failure and retry.",
  initial: () => ({ _tag: "Browsing", items: 0 }),
  nodes: [
    checkout.state("Browsing", {
      on: {
        AddItem: {
          target: "Browsing",
          reduce: ({ state, event }) => ({ ...state, items: state.items + event.amount }),
        },
        BeginCheckout: {
          target: "Checkout",
          reduce: ({ state }) => ({ _tag: "Checkout", items: state.items }),
        },
      },
    }),
    checkout.state("Checkout", {
      on: {
        SubmitOrder: {
          target: "PlacingOrder",
          reduce: ({ state }) => ({ _tag: "PlacingOrder", items: state.items }),
        },
        BackToShop: {
          target: "Browsing",
          reduce: ({ state }) => ({ _tag: "Browsing", items: state.items }),
        },
      },
    }),
    checkout.invoke("PlacingOrder", {
      name: "Orders.place",
      effect: (state) => Effect4.flatMap(Orders, ({ place }) => place(state.items)),
      onSuccess: {
        target: "Ordered",
        reduce: ({ value }) => ({ _tag: "Ordered", orderId: value }),
      },
      onFailure: {
        target: "PaymentFailed",
        reduce: ({ state, error }) => ({
          _tag: "PaymentFailed",
          items: state.items,
          message: error.message,
        }),
      },
    }),
    checkout.state("PaymentFailed", {
      on: {
        RetryPayment: {
          target: "PlacingOrder",
          reduce: ({ state }) => ({ _tag: "PlacingOrder", items: state.items }),
        },
        BackToShop: {
          target: "Browsing",
          reduce: ({ state }) => ({ _tag: "Browsing", items: state.items }),
        },
      },
    }),
    checkout.final("Ordered"),
  ],
})
var OrdersLive = Layer2.effect(
  Orders,
  Effect4.gen(function* () {
    const attempts = yield* Ref3.make(0)
    return Orders.of({
      place: (total) =>
        Ref3.updateAndGet(attempts, (attempt) => attempt + 1).pipe(
          Effect4.delay("900 millis"),
          Effect4.flatMap((attempt) =>
            attempt % 2 === 1
              ? Effect4.fail(new PaymentDeclined({ message: "card declined" }))
              : Effect4.succeed(`order-${total}-${attempt}`),
          ),
        ),
    })
  }),
)
var program = Effect4.scoped(
  Effect4.gen(function* () {
    const handle = yield* Machine_exports.run(definition, {}).pipe(Effect4.provide(OrdersLive))
    yield* attach({
      definition,
      handle,
      appName: "checkout-demo",
      quickEvents: [
        {
          id: "add-random",
          label: "Add random",
          group: "cart",
          make: () => ({ _tag: "AddItem", amount: 1 + Math.floor(Math.random() * 4) }),
        },
        { id: "begin", label: "Checkout", group: "cart", event: { _tag: "BeginCheckout" } },
        { id: "submit", label: "Submit", group: "payment", event: { _tag: "SubmitOrder" } },
        { id: "retry", label: "Retry", group: "payment", event: { _tag: "RetryPayment" } },
        { id: "back", label: "Back to shop", group: "cart", event: { _tag: "BackToShop" } },
      ],
    })
    yield* Effect4.log("checkout-demo attached \u2014 drive it from Studio")
    const completion = yield* handle.completion
    yield* Effect4.log(`checkout completed: ${completion.orderId}`)
    yield* Effect4.sleep("120 seconds")
  }),
)
Effect4.runPromise(program.pipe(Effect4.provideService(StudioTransport, make9())))
