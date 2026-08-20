import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import { type Workflow, WorkflowEngine } from "effect/unstable/workflow"
import type * as Machine from "./Machine.js"
import type * as MachineStore from "./MachineStore.js"

type AnyWorkflow = Workflow.Any

type Parts<Definition extends AnyWorkflow> =
  Definition extends Workflow.Workflow<infer _Name, infer Payload, infer Success, infer Failure>
    ? readonly [Payload, Success, Failure]
    : never

type PayloadSchema<Definition extends AnyWorkflow> = Parts<Definition>[0]
type SuccessSchema<Definition extends AnyWorkflow> = Parts<Definition>[1]
type FailureSchema<Definition extends AnyWorkflow> = Parts<Definition>[2]

/**
 * Decoded payload accepted by a Workflow definition.
 *
 * @category utility types
 * @since 0.2.0
 */
export type Payload<Definition extends AnyWorkflow> = Schema.Schema.Type<PayloadSchema<Definition>>

/**
 * Decoded success produced by a Workflow definition.
 *
 * @category utility types
 * @since 0.2.0
 */
export type Success<Definition extends AnyWorkflow> = Schema.Schema.Type<SuccessSchema<Definition>>

/**
 * Declared error produced by a Workflow definition.
 *
 * @category utility types
 * @since 0.2.0
 */
export type Failure<Definition extends AnyWorkflow> = Schema.Schema.Type<FailureSchema<Definition>>

const encodePart = (value: string): string => `${value.length}:${value}`

/**
 * Derives the Workflow execution identity owned by one machine work execution.
 *
 * **Details**
 *
 * The versioned, length-prefixed encoding separates Workflow names and machine execution IDs
 * without relying on a delimiter that user input could collide with. Redelivery of the same
 * machine work produces the same Workflow execution ID.
 *
 * @category constructors
 * @since 0.2.0
 */
export const executionId = (
  workflowName: string,
  machineExecutionId: MachineStore.ExecutionId,
): string => `machine-workflow:v1:${encodePart(workflowName)}:${encodePart(machineExecutionId)}`

/**
 * Configuration for one Workflow-backed machine invocation.
 *
 * **Details**
 *
 * `payload` receives the narrowed machine state and required stable work execution. The Workflow's
 * declared success and failure Schemas determine the corresponding machine transition reducers.
 *
 * @category configuration
 * @since 0.2.0
 */
export interface InvokeConfig<
  State extends Machine.Tagged,
  Current extends Machine.TagOf<State>,
  Definition extends AnyWorkflow,
> {
  readonly workflow: Definition
  readonly name?: string
  readonly description?: string
  readonly payload: (
    args: Readonly<{
      state: Machine.ByTag<State, Current>
      execution: Machine.WorkExecution
    }>,
  ) => Payload<NoInfer<Definition>>
  readonly onSuccess: Machine.SuccessTransition<State, Current, Success<NoInfer<Definition>>>
  readonly onFailure: Machine.FailureTransition<State, Current, Failure<NoInfer<Definition>>>
}

/**
 * Declares Workflow-backed work using the same activity-outcome seam as an ordinary invocation.
 *
 * Redelivery reuses a versioned execution ID derived from the Workflow name and stable machine
 * execution ID. The Workflow engine therefore resumes or observes the same execution while the
 * machine still persists the decoded outcome through its own aggregate protocol.
 *
 * **When to use**
 *
 * Use when invoked machine work should be executed and resumed by Effect Workflow while machine
 * state remains owned by `MachineEngine` and `MachineStore`.
 *
 * **Gotchas**
 *
 * Workflow persistence does not replace the machine store. The resulting definition requires both
 * the Workflow engine and any client services required by the Workflow, in addition to the machine
 * engine required when the definition runs.
 *
 * @see {@link executionId} for the stable identity used on redelivery.
 * @category constructors
 * @since 0.2.0
 */
export const invoke = <
  InputSchema extends Schema.Top,
  StateSource extends Machine.TaggedSchemaSource,
  EventSource extends Machine.TaggedSchemaSource,
  const Definition extends AnyWorkflow,
  Current extends Machine.TagOf<
    Schema.Schema.Type<Machine.NormalizedTaggedSchema<StateSource>>
  > = Machine.TagOf<Schema.Schema.Type<Machine.NormalizedTaggedSchema<StateSource>>>,
>(
  builder: Machine.Builder<InputSchema, StateSource, EventSource>,
  config: InvokeConfig<
    Schema.Schema.Type<Machine.NormalizedTaggedSchema<StateSource>>,
    Current,
    Definition
  >,
) =>
  builder.invoke({
    name: config.name ?? `${config.workflow._tag}.execute`,
    description: config.description,
    // Workflow.Any erases schema variance; these casts restore schemas inferred from Definition.
    success: config.workflow.successSchema as SuccessSchema<Definition>,
    error: config.workflow.errorSchema as FailureSchema<Definition>,
    effect: (
      state,
      execution,
    ): Effect.Effect<
      Success<Definition>,
      Failure<Definition>,
      WorkflowEngine.WorkflowEngine | Workflow.RequirementsClient<Definition>
    > =>
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine
        // Effect's erased Workflow.Any shape loses variance; this seam restores the inferred workflow contract.
        const execute = engine.execute as unknown as (
          workflow: Definition,
          options: Readonly<{ executionId: string; payload: Payload<Definition> }>,
        ) => Effect.Effect<
          Success<Definition>,
          Failure<Definition>,
          Workflow.RequirementsClient<Definition>
        >
        return yield* execute(config.workflow, {
          executionId: executionId(config.workflow._tag, execution.id),
          payload: config.payload({ state, execution }),
        })
      }),
    onSuccess: config.onSuccess,
    onFailure: config.onFailure,
  })
