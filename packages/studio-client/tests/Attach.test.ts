import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"
import * as Attach from "../src/Attach.js"
import * as MemoryTransport from "../src/MemoryTransport.js"
import type * as Protocol from "../src/Protocol.js"
import { StudioTransport } from "../src/Transport.js"
import { definition } from "./fixtures/Runner.js"

const ChildInput = Schema.Struct({})
const ChildWaiting = Schema.TaggedStruct("ChildWaiting", {})
const ChildDone = Schema.TaggedStruct("ChildDone", {})
const ChildState = Schema.Union([ChildWaiting, ChildDone]).pipe(Schema.toTaggedUnion("_tag"))
const FinishChild = Schema.TaggedStruct("FinishChild", {})
const ChildEvent = Schema.Union([FinishChild]).pipe(Schema.toTaggedUnion("_tag"))
const childMachine = Machine.builder({ input: ChildInput, state: ChildState, event: ChildEvent })
const childDefinition = childMachine.define(
  {
    id: "attached-child",
    initial: () => ({ _tag: "ChildWaiting" }),
  },
  {
    ChildWaiting: childMachine.state({
      FinishChild: { target: "ChildDone", reduce: () => ({ _tag: "ChildDone" }) },
    }),
    ChildDone: childMachine.final(),
  },
)

const ParentInput = Schema.Struct({})
const RunningChild = Schema.TaggedStruct("RunningChild", {})
const ParentDone = Schema.TaggedStruct("ParentDone", {})
const ParentState = Schema.Union([RunningChild, ParentDone]).pipe(Schema.toTaggedUnion("_tag"))
const CancelParent = Schema.TaggedStruct("CancelParent", {})
const ParentEvent = Schema.Union([CancelParent]).pipe(Schema.toTaggedUnion("_tag"))
const parentMachine = Machine.builder({
  input: ParentInput,
  state: ParentState,
  event: ParentEvent,
})
const parentDefinition = parentMachine.define(
  {
    id: "attached-parent",
    initial: () => ({ _tag: "RunningChild" }),
  },
  {
    RunningChild: parentMachine.child({
      name: "child",
      definition: childDefinition,
      input: () => ({}),
      onComplete: { target: "ParentDone", reduce: () => ({ _tag: "ParentDone" }) },
    }),
    ParentDone: parentMachine.final(),
  },
)

const takeUntil = (
  queue: Queue.Dequeue<Protocol.Message>,
  predicate: (message: Protocol.Message) => boolean,
  limit = 100,
): Effect.Effect<Protocol.Message> =>
  Effect.gen(function* () {
    for (let index = 0; index < limit; index += 1) {
      const message = yield* Queue.take(queue)
      if (predicate(message)) return message
    }
    return yield* Effect.die(new Error("expected message did not arrive"))
  })

const isFact = (
  message: Protocol.Message,
  bodyTag: Protocol.FactBodyMessage["_tag"],
): message is Protocol.FactMessage => message._tag === "Fact" && message.body._tag === bodyTag

describe("Attach", () => {
  it.live("announces and dispatches a nested machine tree as one session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { transport, studio } = yield* MemoryTransport.make
        const handle = yield* Machine.run(parentDefinition, {})
        yield* Attach.attach({ definition: parentDefinition, handle }).pipe(
          Effect.provideService(StudioTransport, transport),
        )

        const hello = yield* takeUntil(studio.received, (message) => message._tag === "Hello")
        assert.strictEqual(hello._tag, "Hello")
        if (hello._tag !== "Hello") return
        assert.deepStrictEqual(
          hello.definitions.map(({ definitionPath }) => definitionPath),
          ["root", "root/RunningChild:child"],
        )

        const childStarted = yield* takeUntil(
          studio.received,
          (message) =>
            isFact(message, "ActorStarted") &&
            message._tag === "Fact" &&
            message.actorId !== hello.rootActorId,
        )
        assert.strictEqual(childStarted._tag, "Fact")
        if (childStarted._tag !== "Fact") return
        assert.strictEqual(childStarted.sessionId, hello.sessionId)
        assert.strictEqual(childStarted.definitionPath, "root/RunningChild:child")

        yield* studio.send({
          _tag: "Dispatch",
          sessionId: hello.sessionId,
          actorId: childStarted.actorId,
          correlationId: "finish-child",
          command: { _tag: "Custom", event: { _tag: "FinishChild" } },
        })
        const outcome = yield* takeUntil(
          studio.received,
          (message) =>
            message._tag === "DispatchOutcome" && message.correlationId === "finish-child",
        )
        assert.ok(outcome._tag === "DispatchOutcome" && outcome.result._tag === "Accepted")
        assert.deepStrictEqual(yield* handle.completion, { _tag: "ParentDone" })
      }),
    ),
  )

  it.live("derives a stable instance key and honors overrides", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const helloFor = (options?: { instanceKey?: string; appName?: string }) =>
          Effect.gen(function* () {
            const { transport, studio } = yield* MemoryTransport.make
            const handle = yield* Machine.run(definition, {})
            yield* Attach.attach({ definition, handle, ...options }).pipe(
              Effect.provideService(StudioTransport, transport),
            )
            return yield* takeUntil(studio.received, (message) => message._tag === "Hello")
          })
        const first = yield* helloFor()
        const second = yield* helloFor()
        assert.ok(first._tag === "Hello" && second._tag === "Hello")
        if (first._tag !== "Hello" || second._tag !== "Hello") return
        assert.strictEqual(first.instanceKey, "runner:runner")
        assert.strictEqual(first.instanceKey, second.instanceKey)
        assert.notStrictEqual(first.sessionId, second.sessionId)

        const named = yield* helloFor({ appName: "demo" })
        const overridden = yield* helloFor({ instanceKey: "fleet-7" })
        assert.ok(named._tag === "Hello" && overridden._tag === "Hello")
        if (named._tag !== "Hello" || overridden._tag !== "Hello") return
        assert.strictEqual(named.instanceKey, "demo:runner")
        assert.strictEqual(overridden.instanceKey, "fleet-7")
      }),
    ),
  )

  it.live("announces the session and streams facts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { transport, studio } = yield* MemoryTransport.make
        const handle = yield* Machine.run(definition, {})
        yield* Attach.attach({
          definition,
          handle,
          quickEvents: [
            { id: "start", label: "Start", event: { _tag: "Start", speed: 1 } },
            { id: "stop", label: "Stop", make: () => ({ _tag: "Stop" as const }) },
          ],
        }).pipe(Effect.provideService(StudioTransport, transport))

        const first = yield* Queue.take(studio.received)
        assert.strictEqual(first._tag, "Hello")
        if (first._tag !== "Hello") return
        assert.strictEqual(first.machine.id, "runner")
        assert.strictEqual(first.rootActorId, handle.actorId)
        assert.deepStrictEqual(
          first.quickEvents.map(({ id, kind, eventTag }) => ({ id, kind, eventTag })),
          [
            { id: "start", kind: "event", eventTag: "Start" },
            { id: "stop", kind: "factory", eventTag: undefined },
          ],
        )

        const initialCommit = yield* takeUntil(studio.received, (message) =>
          isFact(message, "StateCommitted"),
        )
        assert.ok(initialCommit._tag === "Fact" && initialCommit.body._tag === "StateCommitted")
        if (initialCommit._tag === "Fact" && initialCommit.body._tag === "StateCommitted") {
          assert.strictEqual(initialCommit.actorId, handle.actorId)
          assert.strictEqual(initialCommit.definitionPath, "root")
          assert.deepStrictEqual(initialCommit.body.state, { _tag: "Idle" })
        }

        yield* handle.send({ _tag: "Start", speed: 3 })
        const received = yield* takeUntil(
          studio.received,
          (message) =>
            isFact(message, "Inspection") &&
            message._tag === "Fact" &&
            message.body._tag === "Inspection" &&
            message.body.event._tag === "EventReceived",
        )
        assert.ok(received._tag === "Fact" && received.body._tag === "Inspection")
        if (
          received._tag === "Fact" &&
          received.body._tag === "Inspection" &&
          received.body.event._tag === "EventReceived"
        ) {
          assert.deepStrictEqual(received.body.event.details, { _tag: "Start", speed: 3 })
        }
      }),
    ),
  )

  it.live("stays inert and buffers when Studio is unreachable, then replays", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { transport, studio } = yield* MemoryTransport.make
        yield* studio.setOnline(false)
        const handle = yield* Machine.run(definition, {})
        yield* Attach.attach({
          definition,
          handle,
          reconnectInterval: "10 millis",
        }).pipe(Effect.provideService(StudioTransport, transport))

        yield* handle.send({ _tag: "Start", speed: 2 })
        yield* handle.send({ _tag: "Stop" })
        assert.deepStrictEqual(yield* handle.completion, { _tag: "Done" })

        yield* studio.setOnline(true)
        const hello = yield* takeUntil(studio.received, (message) => message._tag === "Hello")
        assert.strictEqual(hello._tag, "Hello")
        const status = yield* takeUntil(studio.received, (message) =>
          isFact(message, "ActorTerminated"),
        )
        assert.ok(status._tag === "Fact" && status.body._tag === "ActorTerminated")
        if (status._tag === "Fact" && status.body._tag === "ActorTerminated") {
          assert.strictEqual(status.body.status, "completed")
        }
      }),
    ),
  )

  it.live("answers dispatches with outcomes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { transport, studio } = yield* MemoryTransport.make
        const handle = yield* Machine.run(definition, {})
        yield* Attach.attach({
          definition,
          handle,
          quickEvents: [{ id: "start", label: "Start", event: { _tag: "Start", speed: 5 } }],
        }).pipe(Effect.provideService(StudioTransport, transport))
        const hello = yield* takeUntil(studio.received, (message) => message._tag === "Hello")
        assert.strictEqual(hello._tag, "Hello")
        const sessionId = hello._tag === "Hello" ? hello.sessionId : ""

        const outcomeOf = (correlationId: string) =>
          takeUntil(
            studio.received,
            (message) =>
              message._tag === "DispatchOutcome" && message.correlationId === correlationId,
          )

        yield* studio.send({
          _tag: "Dispatch",
          sessionId,
          actorId: handle.actorId,
          correlationId: "c-unknown",
          command: { _tag: "Quick", id: "missing" },
        })
        const unknown = yield* outcomeOf("c-unknown")
        assert.ok(unknown._tag === "DispatchOutcome" && unknown.result._tag === "Rejected")
        if (unknown._tag === "DispatchOutcome" && unknown.result._tag === "Rejected") {
          assert.strictEqual(unknown.result.reason, "not-found")
        }

        yield* studio.send({
          _tag: "Dispatch",
          sessionId,
          actorId: handle.actorId,
          correlationId: "c-quick",
          command: { _tag: "Quick", id: "start" },
        })
        const accepted = yield* outcomeOf("c-quick")
        assert.ok(accepted._tag === "DispatchOutcome" && accepted.result._tag === "Accepted")

        yield* studio.send({
          _tag: "Dispatch",
          sessionId,
          actorId: handle.actorId,
          correlationId: "c-invalid",
          command: { _tag: "Custom", event: { _tag: "Nope" } },
        })
        const invalid = yield* outcomeOf("c-invalid")
        assert.ok(invalid._tag === "DispatchOutcome" && invalid.result._tag === "Rejected")
        if (invalid._tag === "DispatchOutcome" && invalid.result._tag === "Rejected") {
          assert.strictEqual(invalid.result.reason, "invalid")
        }

        yield* studio.send({
          _tag: "Dispatch",
          sessionId,
          actorId: handle.actorId,
          correlationId: "c-unavailable",
          command: { _tag: "Custom", event: { _tag: "Start", speed: 1 } },
        })
        const unavailable = yield* outcomeOf("c-unavailable")
        assert.ok(unavailable._tag === "DispatchOutcome" && unavailable.result._tag === "Rejected")
        if (unavailable._tag === "DispatchOutcome" && unavailable.result._tag === "Rejected") {
          assert.strictEqual(unavailable.result.reason, "unavailable")
        }
      }),
    ),
  )

  it.live("reconnects after a dropped connection and resumes the fact stream", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { transport, studio } = yield* MemoryTransport.make
        const handle = yield* Machine.run(definition, {})
        yield* Attach.attach({
          definition,
          handle,
          reconnectInterval: "10 millis",
        }).pipe(Effect.provideService(StudioTransport, transport))
        yield* takeUntil(studio.received, (message) => isFact(message, "StateCommitted"))

        yield* studio.dropConnection
        yield* handle.send({ _tag: "Start", speed: 9 })

        const helloAgain = yield* takeUntil(studio.received, (message) => message._tag === "Hello")
        assert.strictEqual(helloAgain._tag, "Hello")
        const commit = yield* takeUntil(
          studio.received,
          (message) =>
            isFact(message, "StateCommitted") &&
            message._tag === "Fact" &&
            message.body._tag === "StateCommitted" &&
            typeof message.body.state === "object" &&
            message.body.state !== null &&
            (message.body.state as { _tag?: string })._tag === "Running",
        )
        assert.strictEqual(commit._tag, "Fact")
        assert.strictEqual(yield* studio.connectionCount, 2)
      }),
    ),
  )

  it.live("ends the session when the attachment scope closes", () =>
    Effect.gen(function* () {
      const { transport, studio } = yield* MemoryTransport.make
      const handle = yield* Effect.scoped(
        Effect.gen(function* () {
          const inner = yield* Machine.run(definition, {})
          yield* Attach.attach({ definition, handle: inner }).pipe(
            Effect.provideService(StudioTransport, transport),
          )
          yield* takeUntil(studio.received, (message) => isFact(message, "StateCommitted"))
          return inner
        }),
      )
      void handle
      const ended = yield* takeUntil(studio.received, (message) => message._tag === "SessionEnded")
      assert.strictEqual(ended._tag, "SessionEnded")
    }),
  )
})
