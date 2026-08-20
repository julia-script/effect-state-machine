import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Workflow, WorkflowEngine } from "effect/unstable/workflow"
import * as Machine from "../src/Machine.js"
import * as MachineEngine from "../src/MachineEngine.js"
import * as MachineStore from "../src/MachineStore.js"
import * as MachineWorkflow from "../src/MachineWorkflow.js"

describe("MachineWorkflow", () => {
  it("derives stable and separated workflow execution identities", () => {
    const instance = MachineStore.deriveMachineInstanceId("Order", "42")
    const firstEntry = MachineStore.deriveEntryId(instance, 1)
    const secondEntry = MachineStore.deriveEntryId(instance, 2)
    const first = MachineStore.deriveExecutionId(instance, firstEntry, "Charging", "charge")
    const repeated = MachineStore.deriveExecutionId(instance, firstEntry, "Charging", "charge")
    const anotherLane = MachineStore.deriveExecutionId(
      instance,
      firstEntry,
      "Charging",
      "charge",
      "backup",
    )
    const anotherEntry = MachineStore.deriveExecutionId(instance, secondEntry, "Charging", "charge")

    assert.strictEqual(
      MachineWorkflow.executionId("Charge", first),
      MachineWorkflow.executionId("Charge", repeated),
    )
    assert.notStrictEqual(
      MachineWorkflow.executionId("Charge", first),
      MachineWorkflow.executionId("Refund", first),
    )
    assert.notStrictEqual(
      MachineWorkflow.executionId("Charge", first),
      MachineWorkflow.executionId("Charge", anotherLane),
    )
    assert.notStrictEqual(
      MachineWorkflow.executionId("Charge", first),
      MachineWorkflow.executionId("Charge", anotherEntry),
    )
  })

  it.effect("routes Workflow success and allowed failure through ordinary activity outcomes", () =>
    Effect.gen(function* () {
      class WorkFailed extends Schema.TaggedError<WorkFailed>()("WorkFailed", {
        reason: Schema.String,
      }) {}
      const Work = Workflow.make("MachineWorkflow.integration", {
        payload: {
          id: Schema.String,
          mode: Schema.Literals(["success", "failure", "defect"]),
        },
        success: Schema.String,
        error: WorkFailed,
        idempotencyKey: ({ id }) => id,
      })
      const WorkLive = Work.toLayer(({ id, mode }) =>
        mode === "success"
          ? Effect.succeed(`done:${id}`)
          : mode === "failure"
            ? Effect.fail(new WorkFailed({ reason: `failed:${id}` }))
            : Effect.die(new Error(`defect:${id}`)),
      ).pipe(Layer.provideMerge(WorkflowEngine.layerMemory))

      const Input = Schema.Struct({
        id: Schema.String,
        mode: Schema.Literals(["success", "failure", "defect"]),
      })
      const State = Machine.taggedUnion({
        Running: {
          fields: { id: Schema.String, mode: Schema.Literals(["success", "failure", "defect"]) },
        },
        Done: { fields: { value: Schema.String } },
        Failed: { fields: { reason: Schema.String } },
      })
      const Event = Machine.taggedUnion({ Noop: { fields: {} } })
      const builder = Machine.builder({ input: Input, state: State, event: Event })
      const definition = builder.define(
        {
          id: "machine-workflow-integration",
          idempotencyKey: ({ id, mode }) => `${id}:${mode}`,
          initial: ({ id, mode }) => ({ _tag: "Running", id, mode }),
        },
        {
          Running: MachineWorkflow.invoke(builder, {
            workflow: Work,
            payload: ({ state }) => ({
              id: state.id,
              mode: state.mode,
            }),
            onSuccess: { target: "Done", reduce: ({ value }) => ({ value }) },
            onFailure: { target: "Failed", reduce: ({ error }) => ({ reason: error.reason }) },
          }),
          Done: builder.final(),
          Failed: builder.final(),
        },
      )
      const program = Effect.gen(function* () {
        const success = yield* definition.run({ id: "one", mode: "success" })
        assert.deepStrictEqual(yield* success.completion, { _tag: "Done", value: "done:one" })
        const failure = yield* definition.run({ id: "two", mode: "failure" })
        assert.deepStrictEqual(yield* failure.completion, {
          _tag: "Failed",
          reason: "failed:two",
        })
        const defect = yield* definition.run({ id: "three", mode: "defect" })
        const exit = yield* Effect.exit(defect.completion)
        assert.strictEqual(exit._tag, "Failure")
      })

      yield* Effect.scoped(program).pipe(
        Effect.provide(MachineEngine.layerMemory()),
        Effect.provide(WorkLive),
      )
    }),
  )
})
