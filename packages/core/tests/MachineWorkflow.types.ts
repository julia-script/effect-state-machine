/** Permanent compile-time contract for the optional Workflow-backed work seam. */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Workflow, WorkflowEngine } from "effect/unstable/workflow"
import * as Machine from "../src/Machine.js"
import * as MachineWorkflow from "../src/MachineWorkflow.js"

class WorkflowFailed extends Schema.TaggedError<WorkflowFailed>()("WorkflowFailed", {
  reason: Schema.String,
}) {}

const Charge = Workflow.make("MachineWorkflowTypes.Charge", {
  payload: { orderId: Schema.String, cents: Schema.Number },
  success: Schema.Struct({ receiptId: Schema.String }),
  error: WorkflowFailed,
  idempotencyKey: ({ orderId }) => orderId,
})

const State = Machine.taggedUnion({
  Charging: { fields: { orderId: Schema.String } },
  Charged: { fields: { receiptId: Schema.String } },
  Failed: { fields: { reason: Schema.String } },
})
const Event = Machine.taggedUnion({ Start: { fields: {} } })
const machine = Machine.builder({ input: Schema.String, state: State, event: Event })

const definition = machine.define(
  {
    id: "machine-workflow-types",
    idempotencyKey: (orderId) => orderId,
    initial: (orderId) => ({ _tag: "Charging", orderId }),
  },
  {
    Charging: MachineWorkflow.invoke(machine, {
      workflow: Charge,
      payload: ({ state, execution }) => {
        const orderId: string = state.orderId
        const stableId: string = execution.id
        void stableId
        return { orderId, cents: 100 }
      },
      onSuccess: {
        target: "Charged",
        reduce: ({ value }) => ({ receiptId: value.receiptId }),
      },
      onFailure: {
        target: "Failed",
        reduce: ({ error }) => ({ reason: error.reason }),
      },
    }),
    Charged: machine.final(),
    Failed: machine.final(),
  },
)

MachineWorkflow.invoke(machine, {
  workflow: Charge,
  // @ts-expect-error Workflow payload inference rejects missing required fields.
  payload: ({ state }) => ({ orderId: state.orderId }),
  onSuccess: {
    target: "Charged",
    reduce: ({ value }) => ({ receiptId: value.receiptId }),
  },
  onFailure: {
    target: "Failed",
    reduce: ({ error }) => ({ reason: error.reason }),
  },
})

const requirements: Machine.MachineRequirements<typeof definition> = WorkflowEngine.WorkflowEngine
void requirements
void Effect.void
