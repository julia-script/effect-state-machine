import * as Cause from "effect/Cause"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { Machine } from "effect-state-machine"
import type { SourceLocation } from "effect-state-machine/devtools"
import * as Announcement from "./Announcement.js"
import * as Protocol from "./Protocol.js"
import { type Connection, StudioTransport, TransportError } from "./Transport.js"

interface Tagged {
  readonly _tag: string
}

interface QuickEventBase {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly group?: string
}

/**
 * Named Studio control backed by either a fixed event or a factory evaluated per dispatch.
 *
 * **When to use**
 *
 * Use to expose common machine events in Studio without requiring a custom event form.
 *
 * @category models
 * @since 0.1.0
 */
export type QuickEvent<Event> =
  | (QuickEventBase & Readonly<{ event: Event }>)
  | (QuickEventBase & Readonly<{ make: () => Event }>)

/**
 * Configuration for attaching one running machine to Studio.
 *
 * @category configuration
 * @since 0.1.0
 */
export interface AttachOptions<State extends Tagged, Event extends Tagged> {
  readonly definition: Machine.DefinitionMetadata
  readonly handle: Machine.MachineHandle<State, Event, State>
  readonly quickEvents?: ReadonlyArray<QuickEvent<NoInfer<Event>>>
  /**
   * Name shown in Studio's session picker; defaults to the machine identifier.
   */
  readonly appName?: string
  readonly parentSessionId?: string
  readonly mapSource?: SourceLocation.Mapper
  /**
   * Number of unsent facts retained while disconnected; defaults to 10,000.
   */
  readonly bufferLimit?: number
  readonly reconnectInterval?: Duration.Input
}

/**
 * Identity of an active Studio attachment.
 *
 * @category models
 * @since 0.1.0
 */
export interface Attachment {
  readonly sessionId: string
}

const detectRuntime = (): "browser" | "node" | "other" => {
  if ("document" in globalThis) return "browser"
  if ("process" in globalThis) return "node"
  return "other"
}

interface BufferState {
  readonly facts: ReadonlyArray<Protocol.FactMessage>
  readonly sequence: number
}

/**
 * Connects a running machine to Studio for inspection and controlled event dispatch.
 *
 * **Details**
 *
 * The attachment announces the definition, streams ordered facts, buffers while disconnected,
 * reconnects in the background, and executes valid Studio dispatches. It is inert when Studio is
 * unreachable and does not add transport failures to the application's typed error channel.
 * Closing the surrounding Scope sends a best-effort session-ended message and stops all work.
 *
 * **Gotchas**
 *
 * Quick-event identifiers must be unique; duplicates terminate the attachment with a defect.
 * Fixed quick events are reused, while factories run separately for every dispatch.
 *
 * @category running
 * @since 0.1.0
 */
export const attach = <State extends Tagged, Event extends Tagged>(
  options: AttachOptions<State, Event>,
): Effect.Effect<Attachment, never, Scope.Scope | StudioTransport> =>
  Effect.gen(function* () {
    const transport = yield* StudioTransport
    const quickEvents = options.quickEvents ?? []
    const quickEventIds = new Set<string>()
    for (const quickEvent of quickEvents) {
      if (quickEventIds.has(quickEvent.id)) {
        return yield* Effect.die(
          new Error(`Duplicate studio quick event identifier: ${quickEvent.id}`),
        )
      }
      quickEventIds.add(quickEvent.id)
    }
    const controls = quickEvents.map(
      (quickEvent): Protocol.QuickEventControlMessage => ({
        id: quickEvent.id,
        label: quickEvent.label,
        ...(quickEvent.description === undefined ? {} : { description: quickEvent.description }),
        ...(quickEvent.group === undefined ? {} : { group: quickEvent.group }),
        kind: "make" in quickEvent ? "factory" : "event",
        ...("event" in quickEvent ? { eventTag: quickEvent.event._tag } : {}),
      }),
    )

    // ponytail: ambient UUID over a Crypto service layer — available in every
    // supported runtime and not worth a dependency in the public attach signature.
    const sessionId = yield* Effect.sync(() => globalThis.crypto.randomUUID())
    const hello = Announcement.make({
      definition: options.definition,
      sessionId,
      ...(options.parentSessionId === undefined
        ? {}
        : { parentSessionId: options.parentSessionId }),
      app: { name: options.appName ?? options.definition.id, runtime: detectRuntime() },
      quickEvents: controls,
      ...(options.mapSource === undefined ? {} : { mapSource: options.mapSource }),
    })
    const bufferLimit = options.bufferLimit ?? 10_000
    const reconnectInterval = options.reconnectInterval ?? "1 second"

    const buffer = yield* Ref.make<BufferState>({ facts: [], sequence: 0 })
    const wake = yield* Queue.sliding<void>(1)
    const terminated = yield* Ref.make(false)
    const rejected = yield* Ref.make(false)
    const active = yield* Ref.make<Connection | undefined>(undefined)

    const emit = (body: Protocol.FactBodyMessage) =>
      Ref.update(buffer, (current) => {
        const facts = [
          ...current.facts,
          { _tag: "Fact" as const, sessionId, sequence: current.sequence, body },
        ]
        return {
          facts: facts.length > bufferLimit ? Protocol.truncateOldest(sessionId, facts) : facts,
          sequence: current.sequence + 1,
        }
      }).pipe(Effect.andThen(Queue.offer(wake, undefined)))

    // Definition metadata intentionally erases codec requirements. The client
    // encodes the service-free state/event Schemas accepted by the v0 builder.
    const encodeState = (value: State) =>
      Machine.encodeState(options.definition, value) as Effect.Effect<unknown, unknown>
    const encodeEventDetails = (event: Event): unknown => {
      try {
        return Schema.encodeUnknownSync(
          options.definition.schemas.event as unknown as Schema.Codec<unknown>,
        )(event)
      } catch {
        return undefined
      }
    }

    const emitState = (value: State) =>
      encodeState(value).pipe(
        Effect.flatMap((encoded) => emit({ _tag: "StateCommitted", state: encoded })),
        Effect.catch((cause) =>
          emit({ _tag: "StateEncodingFailed", stateTag: value._tag, message: String(cause) }),
        ),
      )

    const initial = yield* options.handle.snapshot
    yield* emitState(initial)
    const lastState = yield* Ref.make<State>(initial)
    yield* options.handle.changes.pipe(
      Stream.runForEach((value) =>
        Effect.gen(function* () {
          const previous = yield* Ref.get(lastState)
          if (Object.is(previous, value)) return
          yield* Ref.set(lastState, value)
          yield* emitState(value)
        }),
      ),
      Effect.forkScoped,
    )
    yield* options.handle.inspect(encodeEventDetails).pipe(
      Stream.runForEach((event) => emit({ _tag: "Inspection", event })),
      Effect.forkScoped,
    )
    yield* options.handle.completion.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          if (Exit.isSuccess(exit)) {
            yield* Ref.set(terminated, true)
            yield* emit({ _tag: "StatusChanged", status: "completed" })
          } else if (!Cause.hasInterruptsOnly(exit.cause)) {
            yield* Ref.set(terminated, true)
            yield* emit({ _tag: "StatusChanged", status: "defected" })
          }
        }),
      ),
      Effect.forkScoped,
    )

    const rejectedOutcome = (
      reason: Protocol.DispatchFailure,
      message?: string,
    ): Protocol.DispatchOutcomeMessage["result"] => ({
      _tag: "Rejected",
      reason,
      ...(message === undefined ? {} : { message }),
    })

    const dispatchEvent = (event: Event) =>
      Effect.gen(function* () {
        if (yield* Ref.get(terminated)) return rejectedOutcome("not-running")
        if (!(yield* options.handle.can(event))) {
          return rejectedOutcome(
            "unavailable",
            `The machine does not accept ${event._tag} in its current state.`,
          )
        }
        yield* options.handle.send(event)
        return { _tag: "Accepted" } as const
      })

    const handleDispatch = (
      command: Schema.Schema.Type<typeof Protocol.DispatchCommand>,
    ): Effect.Effect<Protocol.DispatchOutcomeMessage["result"]> => {
      switch (command._tag) {
        case "Quick": {
          const quickEvent = quickEvents.find((candidate) => candidate.id === command.id)
          if (quickEvent === undefined) {
            return Effect.succeed(rejectedOutcome("not-found"))
          }
          const event =
            "make" in quickEvent
              ? Effect.try({ try: quickEvent.make, catch: (cause) => String(cause) })
              : Effect.succeed(quickEvent.event)
          return event.pipe(
            Effect.flatMap(dispatchEvent),
            Effect.catch((message) => Effect.succeed(rejectedOutcome("factory-threw", message))),
          )
        }
        case "Custom": {
          // Same codec erasure boundary as decodeEvent's use in the v0 builder.
          return (
            Machine.decodeEvent(options.definition, command.event) as Effect.Effect<Event, unknown>
          ).pipe(
            Effect.flatMap(dispatchEvent),
            Effect.catch((cause) => Effect.succeed(rejectedOutcome("invalid", String(cause)))),
          )
        }
      }
    }

    const onMessage = (
      connection: Connection,
      message: Protocol.Message,
    ): Effect.Effect<void, TransportError> => {
      switch (message._tag) {
        case "Dispatch": {
          if (message.sessionId !== sessionId) return Effect.void
          return handleDispatch(message.command).pipe(
            Effect.flatMap((result) =>
              connection.send({
                _tag: "DispatchOutcome",
                sessionId,
                correlationId: message.correlationId,
                result,
              }),
            ),
            Effect.catch(() => Effect.void),
          )
        }
        case "SessionRejected": {
          if (message.sessionId !== sessionId) return Effect.void
          return Ref.set(rejected, true).pipe(
            Effect.andThen(Effect.fail(new TransportError({ reason: "closed" }))),
          )
        }
        default:
          return Effect.void
      }
    }

    const pump = (connection: Connection): Effect.Effect<void, TransportError> =>
      Effect.gen(function* () {
        while (true) {
          const current = yield* Ref.get(buffer)
          const fact = current.facts[0]
          if (fact === undefined) {
            yield* Queue.take(wake).pipe(Effect.catch(() => Effect.void))
            continue
          }
          yield* connection.send(fact)
          yield* Ref.update(buffer, (state) =>
            state.facts[0] === fact ? { ...state, facts: state.facts.slice(1) } : state,
          )
        }
      })

    const listen = (connection: Connection) =>
      Effect.gen(function* () {
        while (true) {
          const message = yield* Queue.take(connection.messages)
          yield* onMessage(connection, message)
        }
      })

    const runOnce = Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* transport.connect
        yield* connection.send(hello)
        yield* Ref.set(active, connection)
        yield* Effect.forkScoped(pump(connection))
        yield* listen(connection)
      }).pipe(Effect.ensuring(Ref.set(active, undefined))),
    )

    yield* Effect.gen(function* () {
      while (!(yield* Ref.get(rejected))) {
        yield* runOnce.pipe(Effect.catchCause(() => Effect.void))
        if (yield* Ref.get(rejected)) break
        yield* Effect.sleep(reconnectInterval)
      }
    }).pipe(Effect.forkScoped)

    // Registered after the forks so it runs before they are interrupted, while
    // the connection is still alive.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const connection = yield* Ref.get(active)
        if (connection === undefined) return
        yield* connection
          .send({ _tag: "SessionEnded", sessionId })
          .pipe(Effect.catch(() => Effect.void))
      }),
    )

    return { sessionId }
  })
