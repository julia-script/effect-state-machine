import { assert, describe, it } from "@effect/vitest"
import * as History from "../src/History.js"
import type * as Protocol from "../src/Protocol.js"

let sequence = 0
const fact = (body: Protocol.FactBodyMessage): Protocol.FactMessage => ({
  _tag: "Fact",
  sessionId: "session",
  sequence: sequence++,
  body,
})

const inspection = (event: Protocol.InspectionEventMessage): Protocol.FactMessage =>
  fact({ _tag: "Inspection", event })

const committed = (state: unknown): Protocol.FactMessage => fact({ _tag: "StateCommitted", state })

const machineId = "test-machine"

const started = (): Protocol.FactMessage =>
  inspection({ _tag: "MachineStarted", machineId, initialStateTag: "Idle" })

describe("History", () => {
  it("builds the initial position and machine step", () => {
    const model = History.fromFacts([committed({ _tag: "Idle" }), started()])
    assert.deepStrictEqual(model.positions, [
      { index: 0, stateTag: "Idle", state: { _tag: "Idle" } },
    ])
    assert.strictEqual(model.steps.length, 1)
    assert.strictEqual(model.steps[0]?.kind, "machine")
    assert.strictEqual(model.steps[0]?.title, `Started ${machineId}`)
    assert.strictEqual(model.status, "running")
  })

  it("folds an event, its transition, and its commit into one step", () => {
    const model = History.fromFacts([
      committed({ _tag: "Idle" }),
      started(),
      inspection({
        _tag: "EventReceived",
        machineId,
        stateTag: "Idle",
        eventTag: "Start",
        details: { _tag: "Start", speed: 3 },
      }),
      inspection({
        _tag: "TransitionSelected",
        machineId,
        sourceStateTag: "Idle",
        targetStateTag: "Running",
        eventTag: "Start",
      }),
      inspection({
        _tag: "StateChanged",
        machineId,
        previousStateTag: "Idle",
        nextStateTag: "Running",
      }),
      committed({ _tag: "Running" }),
    ])
    assert.strictEqual(model.positions.length, 2)
    const step = model.steps[1]
    assert.ok(step !== undefined)
    assert.strictEqual(step.kind, "event")
    assert.strictEqual(step.eventTag, "Start")
    assert.deepStrictEqual(step.eventPayload, { _tag: "Start", speed: 3 })
    assert.strictEqual(step.status, "selected")
    assert.strictEqual(step.sourceStateTag, "Idle")
    assert.strictEqual(step.targetStateTag, "Running")
    assert.strictEqual(step.committedPosition, 1)
    assert.strictEqual(step.raw.length, 3)
  })

  it("marks ignored events without committing a position", () => {
    const model = History.fromFacts([
      committed({ _tag: "Idle" }),
      started(),
      inspection({ _tag: "EventReceived", machineId, stateTag: "Idle", eventTag: "Noop" }),
      inspection({ _tag: "EventIgnored", machineId, stateTag: "Idle", eventTag: "Noop" }),
    ])
    assert.strictEqual(model.positions.length, 1)
    assert.strictEqual(model.steps[1]?.status, "ignored")
  })

  it("folds invocation lifecycle including retries into one step", () => {
    const base = { machineId, stateTag: "Loading", invocation: "Orders.place", generation: 1 }
    const model = History.fromFacts([
      committed({ _tag: "Loading" }),
      inspection({ _tag: "InvocationStarted", ...base }),
      inspection({
        _tag: "InvocationRetryScheduled",
        ...base,
        policy: "spaced",
        attempt: 1,
        delayMillis: 250,
      }),
      inspection({ _tag: "InvocationSucceeded", ...base }),
      inspection({
        _tag: "StateChanged",
        machineId,
        previousStateTag: "Loading",
        nextStateTag: "Done",
      }),
      committed({ _tag: "Done" }),
    ])
    const step = model.steps[0]
    assert.ok(step !== undefined)
    assert.strictEqual(step.kind, "invocation")
    assert.strictEqual(step.status, "succeeded")
    assert.strictEqual(step.attempt, 1)
    assert.strictEqual(step.delayMillis, 250)
    assert.strictEqual(step.committedPosition, 1)
    assert.strictEqual(step.raw.length, 4)
  })

  it("folds child lifecycle onto the owning step", () => {
    const base = {
      machineId,
      stateTag: "Resolving",
      invocation: "Resolver",
      instanceId: "child-1",
      generation: 1,
    }
    const model = History.fromFacts([
      committed({ _tag: "Resolving" }),
      inspection({ _tag: "ChildStarted", ...base, childDefinitionId: "resolver" }),
      inspection({
        _tag: "ChildEventForwarded",
        ...base,
        parentEventTag: "Retry",
        childEventTag: "Retry",
      }),
      inspection({ _tag: "ChildCompleted", ...base }),
    ])
    const step = model.steps[0]
    assert.ok(step !== undefined)
    assert.strictEqual(step.kind, "child")
    assert.strictEqual(step.status, "completed")
    assert.strictEqual(step.instanceId, "child-1")
    assert.strictEqual(step.raw.length, 3)
  })

  it("records completion and defect terminal statuses", () => {
    const completedModel = History.fromFacts([
      committed({ _tag: "Done" }),
      inspection({ _tag: "MachineCompleted", machineId, finalStateTag: "Done" }),
    ])
    assert.strictEqual(completedModel.status, "completed")
    assert.strictEqual(completedModel.steps[0]?.kind, "completion")

    const defectedModel = History.fromFacts([
      committed({ _tag: "Idle" }),
      inspection({ _tag: "EventReceived", machineId, stateTag: "Idle", eventTag: "Boom" }),
      inspection({
        _tag: "MachineDefected",
        machineId,
        stateTag: "Idle",
        eventTag: "Boom",
        defect: "ProtocolDefect",
      }),
    ])
    assert.strictEqual(defectedModel.status, "defected")
    assert.strictEqual(defectedModel.steps[0]?.status, "defected")
  })

  it("tracks truncation, encoding failures, and status facts", () => {
    const model = History.fromFacts([
      fact({ _tag: "HistoryTruncated", dropped: 12 }),
      fact({ _tag: "StateEncodingFailed", stateTag: "Weird", message: "no codec" }),
      fact({ _tag: "StatusChanged", status: "defected" }),
    ])
    assert.strictEqual(model.truncatedFacts, 12)
    assert.deepStrictEqual(model.encodingFailures, [{ stateTag: "Weird", message: "no codec" }])
    assert.strictEqual(model.status, "defected")
  })

  it("reduces incrementally to the same model as a bulk fold", () => {
    const facts = [
      committed({ _tag: "Idle" }),
      started(),
      inspection({ _tag: "EventReceived", machineId, stateTag: "Idle", eventTag: "Start" }),
      inspection({
        _tag: "StateChanged",
        machineId,
        previousStateTag: "Idle",
        nextStateTag: "Running",
      }),
      committed({ _tag: "Running" }),
    ]
    const bulk = History.fromFacts(facts)
    let incremental = History.initial
    for (const entry of facts) incremental = History.reduce(incremental, entry)
    assert.deepStrictEqual(incremental, bulk)
  })
})
