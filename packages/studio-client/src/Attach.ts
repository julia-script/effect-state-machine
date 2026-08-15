import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { Machine } from "effect-state-machine"
import type { SourceLocation } from "effect-state-machine/devtools"
import * as Announcement from "./Announcement.js"
import * as Protocol from "./Protocol.js"
import * as SourceMap from "./SourceMap.js"
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
  readonly quickEventsByDefinition?: Readonly<Record<string, ReadonlyArray<QuickEvent<Tagged>>>>
  /**
   * Name shown in Studio's session picker; defaults to the machine identifier.
   */
  readonly appName?: string
  /**
   * Stable lineage key for supersession; defaults to `appName:definitionId`.
   * Supply distinct keys to keep deliberate parallel instances from ever
   * superseding each other's history.
   */
  readonly instanceKey?: string
  readonly parentSessionId?: string
  /**
   * Absolute filesystem root of the app, used by Studio to turn
   * dev-server-relative source paths into IDE-openable absolute paths.
   * Defaults to `process.cwd()` in Node; browsers cannot detect it, so pass it
   * explicitly (e.g. injected via a bundler define).
   */
  readonly projectRoot?: string
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
    const quickEventsByDefinition = new Map<string, ReadonlyArray<QuickEvent<Tagged>>>([
      [Machine.DefinitionPath.root, options.quickEvents ?? []],
      ...Object.entries(options.quickEventsByDefinition ?? {}),
    ])
    const controlsByDefinition = new Map<string, ReadonlyArray<Protocol.QuickEventControlMessage>>()
    for (const [definitionPath, quickEvents] of quickEventsByDefinition) {
      const ids = new Set<string>()
      const controls = quickEvents.map((quickEvent): Protocol.QuickEventControlMessage => {
        if (ids.has(quickEvent.id)) {
          throw new Error(
            `Duplicate studio quick event identifier ${quickEvent.id} for ${definitionPath}`,
          )
        }
        ids.add(quickEvent.id)
        return {
          id: quickEvent.id,
          label: quickEvent.label,
          ...(quickEvent.description === undefined ? {} : { description: quickEvent.description }),
          ...(quickEvent.group === undefined ? {} : { group: quickEvent.group }),
          kind: "make" in quickEvent ? "factory" : "event",
          ...("event" in quickEvent ? { eventTag: quickEvent.event._tag } : {}),
        }
      })
      controlsByDefinition.set(definitionPath, controls)
    }

    const definitions = new Map<string, Machine.DefinitionMetadata>()
    const collectDefinitions = (
      definition: Machine.DefinitionMetadata,
      definitionPath: Machine.DefinitionPath,
    ): void => {
      definitions.set(definitionPath, definition)
      for (const node of Machine.definitionNodes(definition)) {
        if (node.kind !== "child") continue
        collectDefinitions(
          node.definition,
          Machine.DefinitionPath.child(definitionPath, node.tag, node.name),
        )
      }
    }
    collectDefinitions(options.definition, Machine.DefinitionPath.root)

    // ponytail: ambient UUID over a Crypto service layer — available in every
    // supported runtime and not worth a dependency in the public attach signature.
    const sessionId = yield* Effect.sync(() => globalThis.crypto.randomUUID())
    const appName = options.appName ?? options.definition.id
    const projectRoot =
      options.projectRoot ??
      (detectRuntime() === "node"
        ? (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.()
        : undefined)
    const announceOptions: Omit<Announcement.MakeOptions, "mapSource"> = {
      definition: options.definition,
      sessionId,
      instanceKey: options.instanceKey ?? `${appName}:${options.definition.id}`,
      rootActorId: options.handle.actorId,
      ...(options.parentSessionId === undefined
        ? {}
        : { parentSessionId: options.parentSessionId }),
      app: {
        name: appName,
        runtime: detectRuntime(),
        ...(projectRoot === undefined ? {} : { projectRoot }),
      },
      quickEvents: controlsByDefinition.get(Machine.DefinitionPath.root) ?? [],
      quickEventsByDefinition: Object.fromEntries(controlsByDefinition),
    }
    let mapSource = options.mapSource
    if (mapSource === undefined) {
      // Dev-server stacks point at transpiled modules; map them back to
      // authored positions via the modules' own (inline) source maps. A
      // collecting pass first walks every candidate frame per source.
      const files = new Set<string>()
      Announcement.make({
        ...announceOptions,
        mapSource: (generated) => {
          files.add(generated.file)
          return undefined
        },
      })
      if ([...files].some((file) => /^https?:/.test(file))) {
        mapSource = yield* Effect.promise(() => SourceMap.mapper(files))
      }
    }
    const hello = Announcement.make({
      ...announceOptions,
      ...(mapSource === undefined ? {} : { mapSource }),
    })
    const bufferLimit = options.bufferLimit ?? 10_000
    const reconnectInterval = options.reconnectInterval ?? "1 second"

    const buffer = yield* Ref.make<BufferState>({ facts: [] })
    const wake = yield* Queue.sliding<void>(1)
    const rejected = yield* Ref.make(false)
    const active = yield* Ref.make<Connection | undefined>(undefined)
    const actorDefinitions = yield* Ref.make<ReadonlyMap<string, string>>(
      new Map([[options.handle.actorId, options.handle.definitionPath]]),
    )

    const emit = (record: Machine.TreeRecord, body: Protocol.FactBodyMessage) =>
      Ref.update(buffer, (current) => {
        const facts = [
          ...current.facts,
          {
            _tag: "Fact" as const,
            sessionId,
            sequence: record.sequence,
            actorId: record.actorId,
            definitionPath: record.definitionPath,
            body,
          },
        ]
        return {
          facts: facts.length > bufferLimit ? Protocol.truncateOldest(sessionId, facts) : facts,
        }
      }).pipe(Effect.andThen(Queue.offer(wake, undefined)))

    const project = (record: Machine.TreeRecord): Effect.Effect<Protocol.FactBodyMessage> => {
      const definition = definitions.get(record.definitionPath)
      if (definition === undefined) {
        return Effect.die(new Error(`Missing definition for ${record.definitionPath}`))
      }
      switch (record.body._tag) {
        case "ActorStarted":
          return Ref.update(actorDefinitions, (actors) =>
            new Map(actors).set(record.actorId, record.definitionPath),
          ).pipe(Effect.as(record.body))
        case "ActorTerminated":
          return Effect.succeed(record.body)
        case "Inspection": {
          const metadata = record.body.metadata
          if (metadata._tag !== "EventReceived" || record.body.event === undefined) {
            return Effect.succeed({ _tag: "Inspection", event: metadata })
          }
          let details: unknown
          try {
            // Definition metadata erases codec services at the devtools serialization boundary.
            details = Schema.encodeUnknownSync(
              definition.schemas.event as unknown as Schema.Codec<unknown>,
            )(record.body.event)
          } catch {
            details = undefined
          }
          return Effect.succeed({
            _tag: "Inspection",
            event: { ...metadata, ...(details === undefined ? {} : { details }) },
          })
        }
        case "StateSnapshot": {
          const stateSnapshot = record.body.state
          // Definition metadata erases codec services at the devtools serialization boundary.
          return Schema.encodeUnknownEffect(
            definition.schemas.state as unknown as Schema.Codec<unknown>,
          )(stateSnapshot).pipe(
            Effect.match({
              onFailure: (cause): Protocol.FactBodyMessage => ({
                _tag: "StateEncodingFailed",
                stateTag:
                  typeof stateSnapshot === "object" &&
                  stateSnapshot !== null &&
                  "_tag" in stateSnapshot
                    ? String(stateSnapshot._tag)
                    : "unknown",
                message: String(cause),
              }),
              onSuccess: (state): Protocol.FactBodyMessage => ({
                _tag: "StateCommitted",
                state,
              }),
            }),
          )
        }
      }
    }

    yield* options.handle.tree.records.pipe(
      Stream.runForEach((record) =>
        project(record).pipe(Effect.flatMap((body) => emit(record, body))),
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

    const dispatchEvent = (actorId: Machine.ActorId, event: Tagged) =>
      options.handle.tree.dispatch(actorId, event).pipe(
        Effect.match({
          onFailure: (error) =>
            error.reason === "unknown"
              ? rejectedOutcome("unknown-actor")
              : error.reason === "ended"
                ? rejectedOutcome("actor-ended")
                : rejectedOutcome(
                    "unavailable",
                    `The actor does not accept ${event._tag} in its current state.`,
                  ),
          onSuccess: (): Protocol.DispatchOutcomeMessage["result"] => ({ _tag: "Accepted" }),
        }),
      )

    const handleDispatch = (
      actorId: string,
      command: Schema.Schema.Type<typeof Protocol.DispatchCommand>,
    ): Effect.Effect<Protocol.DispatchOutcomeMessage["result"]> =>
      Effect.gen(function* () {
        const definitionPath = (yield* Ref.get(actorDefinitions)).get(actorId)
        if (definitionPath === undefined) return rejectedOutcome("unknown-actor")
        const definition = definitions.get(definitionPath)
        if (definition === undefined) return rejectedOutcome("unknown-actor")
        const actor = Machine.ActorId.make(actorId)
        const quickEvents = quickEventsByDefinition.get(definitionPath) ?? []
        switch (command._tag) {
          case "Quick": {
            const quickEvent = quickEvents.find((candidate) => candidate.id === command.id)
            if (quickEvent === undefined) {
              return rejectedOutcome("not-found")
            }
            const event =
              "make" in quickEvent
                ? Effect.try({ try: quickEvent.make, catch: (cause) => String(cause) })
                : Effect.succeed(quickEvent.event)
            return yield* event.pipe(
              Effect.flatMap((value) => dispatchEvent(actor, value)),
              Effect.catch((message) => Effect.succeed(rejectedOutcome("factory-threw", message))),
            )
          }
          case "Custom": {
            // Tree metadata deliberately erases the concrete event union for heterogeneous actors.
            const decoded = Machine.decodeEvent(definition, command.event) as Effect.Effect<
              Tagged,
              unknown
            >
            return yield* decoded.pipe(
              Effect.flatMap((event) => dispatchEvent(actor, event)),
              Effect.catch((cause) => Effect.succeed(rejectedOutcome("invalid", String(cause)))),
            )
          }
        }
      })

    const onMessage = (
      connection: Connection,
      message: Protocol.Message,
    ): Effect.Effect<void, TransportError> => {
      switch (message._tag) {
        case "Dispatch": {
          if (message.sessionId !== sessionId) return Effect.void
          return handleDispatch(message.actorId, message.command).pipe(
            Effect.flatMap((result) =>
              connection.send({
                _tag: "DispatchOutcome",
                sessionId,
                actorId: message.actorId,
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
