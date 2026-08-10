import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"
import * as Announcement from "../src/Announcement.js"
import * as Protocol from "../src/Protocol.js"

const Input = Schema.Struct({})
const State = Machine.taggedUnion({
  Idle: { fields: {}, description: "Waiting for a start event." },
  Running: { fields: { speed: Schema.Number } },
  Done: { fields: {} },
})
const Event = Machine.taggedUnion({
  Start: { fields: { speed: Schema.Number }, description: "Begin running." },
  Stop: { fields: {} },
})
const runner = Machine.builder({ input: Input, state: State, event: Event })
const definition = runner.make({
  id: "protocol-test",
  initial: () => ({ _tag: "Idle" }),
  nodes: [
    runner.state("Idle", {
      on: {
        Start: {
          target: "Running",
          reduce: ({ event }) => ({ _tag: "Running", speed: event.speed }),
        },
      },
    }),
    runner.state("Running", {
      on: { Stop: { target: "Done", reduce: () => ({ _tag: "Done" }) } },
    }),
    runner.final("Done"),
  ],
})

const hello = Announcement.make({
  definition,
  sessionId: "session-1",
  app: { name: "test-app", runtime: "node" },
  quickEvents: [
    { id: "start", label: "Start", kind: "event", eventTag: "Start" },
    { id: "stop", label: "Stop", kind: "factory" },
  ],
})

describe("Protocol", () => {
  it.effect("announcement survives a JSON round trip", () =>
    Effect.gen(function* () {
      const encoded = yield* Protocol.encodeMessageString(hello)
      const decoded = yield* Protocol.decodeMessageString(encoded)
      assert.deepStrictEqual(decoded, JSON.parse(JSON.stringify(hello)))
      assert.strictEqual(decoded._tag, "Hello")
      if (decoded._tag !== "Hello") return
      assert.strictEqual(decoded.protocolVersion, Protocol.VERSION)
      assert.strictEqual(decoded.graph.nodes.length, 3)
      assert.strictEqual(decoded.graph.edges.length, 2)
      assert.ok(Object.keys(decoded.jsonSchemas.states).includes("Running"))
      assert.ok(Object.keys(decoded.jsonSchemas.events).includes("Start"))
    }),
  )

  it("announcement carries descriptions and machine identity", () => {
    assert.strictEqual(hello.machine.id, "protocol-test")
    const idle = hello.graph.nodes.find((node) => node.id === "Idle")
    assert.strictEqual(idle?.description, "Waiting for a start event.")
  })

  it.effect("facts and dispatches round trip", () =>
    Effect.gen(function* () {
      const messages: ReadonlyArray<Protocol.Message> = [
        {
          _tag: "Fact",
          sessionId: "session-1",
          sequence: 0,
          body: { _tag: "StateCommitted", state: { _tag: "Idle" } },
        },
        {
          _tag: "Dispatch",
          sessionId: "session-1",
          correlationId: "c1",
          command: { _tag: "Custom", event: { _tag: "Start", speed: 2 } },
        },
        {
          _tag: "DispatchOutcome",
          sessionId: "session-1",
          correlationId: "c1",
          result: { _tag: "Rejected", reason: "unavailable" },
        },
        { _tag: "SessionEnded", sessionId: "session-1" },
      ]
      for (const message of messages) {
        const decoded = yield* Protocol.decodeMessageString(
          yield* Protocol.encodeMessageString(message),
        )
        assert.deepStrictEqual(decoded, message)
      }
    }),
  )

  it.effect("rejects malformed messages", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Protocol.decodeMessageString(JSON.stringify({ _tag: "Fact", sessionId: 42 })),
      )
      assert.strictEqual(result._tag, "Failure")
    }),
  )
})
