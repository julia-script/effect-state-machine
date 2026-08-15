import { assert, describe, it } from "@effect/vitest"
import * as Fn from "effect/Function"
import * as History from "../src/History.js"
import type * as Protocol from "../src/Protocol.js"

let sequence = 0
const fact = (body: Protocol.FactBodyMessage): Protocol.FactMessage => ({
  _tag: "Fact",
  sessionId: "session",
  sequence: sequence++,
  actorId: "actor:0",
  definitionPath: "root",
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
    assert.strictEqual(model.positions.length, 1)
    const position = model.positions[0]
    assert.strictEqual(position?.index, 0)
    assert.strictEqual(position?.actorId, "actor:0")
    assert.strictEqual(position?.definitionPath, "root")
    assert.strictEqual(position?.stateTag, "Idle")
    assert.deepStrictEqual(position?.state, { _tag: "Idle" })
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
    const base = {
      machineId,
      stateTag: "Loading",
      invocation: "Orders.place",
      generation: 1,
      ownerPath: "Loading",
      workKind: "all" as const,
      lanes: ["reserve", "charge"],
    }
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
    assert.strictEqual(step.ownerPath, "Loading")
    assert.strictEqual(step.workKind, "all")
    assert.deepStrictEqual(step.lanes, ["reserve", "charge"])
    assert.strictEqual(step.committedPosition, 1)
    assert.strictEqual(step.raw.length, 4)
  })

  it("keeps parallel region selections together as one macrostep", () => {
    const model = History.fromFacts([
      committed({
        _tag: "Active",
        playback: { _tag: "Playing" },
        volume: { _tag: "Audible" },
      }),
      inspection({
        _tag: "EventReceived",
        machineId,
        stateTag: "Active",
        eventTag: "Toggle",
      }),
      inspection({
        _tag: "TransitionSelected",
        machineId,
        sourceStateTag: "Active/playback/Playing",
        targetStateTag: "Active/playback/Paused",
        eventTag: "Toggle",
        ownerPath: "Active/playback",
        macrostep: 4,
      }),
      inspection({
        _tag: "TransitionSelected",
        machineId,
        sourceStateTag: "Active/volume/Audible",
        targetStateTag: "Active/volume/Muted",
        eventTag: "Toggle",
        ownerPath: "Active/volume",
        macrostep: 4,
      }),
      inspection({
        _tag: "StateChanged",
        machineId,
        previousStateTag: "Active",
        nextStateTag: "Active",
      }),
      committed({
        _tag: "Active",
        playback: { _tag: "Paused" },
        volume: { _tag: "Muted" },
      }),
    ])
    const step = model.steps[0]
    assert.strictEqual(step?.kind, "event")
    assert.strictEqual(step?.macrostep, 4)
    assert.deepStrictEqual(
      step?.transitions?.map(({ sourceStateTag, targetStateTag }) => [
        sourceStateTag,
        targetStateTag,
      ]),
      [
        ["Active/playback/Playing", "Active/playback/Paused"],
        ["Active/volume/Audible", "Active/volume/Muted"],
      ],
    )
    assert.strictEqual(step?.committedPosition, 1)
  })

  it("folds timer lifecycles and stale outcomes into inspectable steps", () => {
    const timer = {
      machineId,
      stateTag: "Active",
      timer: "after",
      generation: 2,
      ownerPath: "Active/playback/Playing",
      durationMillis: 500,
    }
    const model = History.fromFacts([
      committed({ _tag: "Active", playback: { _tag: "Playing" } }),
      inspection({ _tag: "TimerStarted", ...timer }),
      inspection({ _tag: "TimerFired", ...timer }),
      inspection({
        _tag: "TransitionSelected",
        machineId,
        sourceStateTag: "Active/playback/Playing",
        targetStateTag: "Active/playback/Paused",
        eventTag: "@after",
        ownerPath: "Active/playback",
        macrostep: 2,
      }),
      inspection({
        _tag: "StateChanged",
        machineId,
        previousStateTag: "Active",
        nextStateTag: "Active",
      }),
      committed({ _tag: "Active", playback: { _tag: "Paused" } }),
      inspection({
        _tag: "StaleOutcomeIgnored",
        machineId,
        stateTag: "Active",
        ownerPath: "Active/playback/Playing",
        generation: 1,
        currentGeneration: 2,
        outcome: "work-success",
      }),
    ])
    assert.strictEqual(model.steps[0]?.kind, "timer")
    assert.strictEqual(model.steps[0]?.status, "fired")
    assert.strictEqual(model.steps[0]?.durationMillis, 500)
    assert.strictEqual(model.steps[0]?.transitions?.[0]?.eventTag, "@after")
    assert.strictEqual(model.steps[1]?.kind, "stale")
    assert.strictEqual(model.steps[1]?.outcome, "work-success")
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
      fact({ _tag: "HistoryTruncated", dropped: 12, fromSequence: 1, toSequence: 12 }),
      fact({ _tag: "StateEncodingFailed", stateTag: "Weird", message: "no codec" }),
      fact({ _tag: "StatusChanged", status: "defected" }),
    ])
    assert.strictEqual(model.truncatedFacts, 12)
    assert.deepStrictEqual(model.truncatedRange, { fromSequence: 1, toSequence: 12 })
    assert.deepStrictEqual(model.encodingFailures, [
      {
        actorId: "actor:0",
        definitionPath: "root",
        stateTag: "Weird",
        message: "no codec",
      },
    ])
    assert.strictEqual(model.status, "defected")
  })

  it("reconstructs interleaved actor state at a global cursor", () => {
    const rootStarted = fact({ _tag: "ActorStarted", machineId: "root-machine" })
    const rootState = committed({ _tag: "RootIdle" })
    const childStarted: Protocol.FactMessage = {
      _tag: "Fact",
      sessionId: "session",
      sequence: sequence++,
      actorId: "actor:1",
      definitionPath: "root/Running:child",
      body: {
        _tag: "ActorStarted",
        machineId: "child-machine",
        parentActorId: "actor:0",
        ownerStateTag: "Running",
        invocation: "child",
        instanceId: "child:1",
      },
    }
    const childInitial: Protocol.FactMessage = {
      _tag: "Fact",
      sessionId: "session",
      sequence: sequence++,
      actorId: "actor:1",
      definitionPath: "root/Running:child",
      body: { _tag: "StateCommitted", state: { _tag: "ChildIdle", count: 0 } },
    }
    const rootRunning = committed({ _tag: "RootRunning" })
    const childRunning: Protocol.FactMessage = {
      _tag: "Fact",
      sessionId: "session",
      sequence: sequence++,
      actorId: "actor:1",
      definitionPath: "root/Running:child",
      body: { _tag: "StateCommitted", state: { _tag: "ChildRunning", count: 1 } },
    }
    const childEnded: Protocol.FactMessage = {
      _tag: "Fact",
      sessionId: "session",
      sequence: sequence++,
      actorId: "actor:1",
      definitionPath: "root/Running:child",
      body: { _tag: "ActorTerminated", status: "completed" },
    }
    const model = History.fromFacts([
      rootStarted,
      rootState,
      childStarted,
      childInitial,
      rootRunning,
      childRunning,
      childEnded,
    ])

    assert.strictEqual(model.actors.get("actor:1")?.depth, 1)
    assert.deepStrictEqual(
      History.actorsAt(model, childRunning.sequence).map(({ actorId }) => actorId),
      ["actor:0", "actor:1"],
    )
    assert.deepStrictEqual(
      History.actorsAt(model, childEnded.sequence).map(({ actorId }) => actorId),
      ["actor:0"],
    )
    const childPosition = History.positionAt(model, "actor:1", childRunning.sequence)
    assert.deepStrictEqual(childPosition?.state, { _tag: "ChildRunning", count: 1 })
    assert.deepStrictEqual(
      childPosition === undefined
        ? undefined
        : History.previousPosition(model, childPosition)?.state,
      { _tag: "ChildIdle", count: 0 },
    )
    assert.deepStrictEqual(History.positionAt(model, "actor:0", childRunning.sequence)?.state, {
      _tag: "RootRunning",
    })
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

    let piped = History.initial
    for (const entry of facts) piped = Fn.pipe(piped, History.reduce(entry))
    assert.deepStrictEqual(piped, bulk)
  })
})
