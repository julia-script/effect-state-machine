/** Permanent compile-time contract for unified definition and engine APIs. */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Machine from "../src/Machine.js"
import type * as MachineEngine from "../src/MachineEngine.js"
import type * as MachineStore from "../src/MachineStore.js"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition

const State = Machine.taggedUnion({
  Working: { fields: { value: Schema.String } },
  Done: { fields: { value: Schema.String } },
})
const Event = Machine.taggedUnion({ Finish: { fields: {} } })
const machine = Machine.builder({
  input: Schema.Struct({ key: Schema.String }),
  state: State,
  event: Event,
})

const definition = machine.define(
  {
    id: "unified-types",
    idempotencyKey: ({ key }) => key,
    version: "2",
    migrations: [],
    initial: ({ key }) => ({ _tag: "Working", value: key }),
  },
  {
    Working: machine.invoke({
      name: "work",
      success: Schema.String,
      error: Schema.Never,
      effect: (state, execution) => {
        const id: MachineStore.ExecutionId = execution.id
        const instanceId: MachineStore.MachineInstanceId = execution.instanceId
        const entryId: MachineStore.EntryId = execution.entryId
        void id
        void instanceId
        void entryId
        return Effect.succeed(state.value)
      },
      onSuccess: { target: "Done", reduce: ({ value }) => ({ value }) },
      onFailure: { target: "Done", reduce: () => ({ value: "unreachable" }) },
    }),
    Done: machine.final(),
  },
)

const ignoresExecution = machine.define(
  {
    id: "ignores-execution",
    idempotencyKey: ({ key }) => key,
    initial: ({ key }) => ({ _tag: "Working", value: key }),
  },
  {
    Working: machine.invoke({
      name: "work",
      success: Schema.String,
      error: Schema.Never,
      effect: (state) => Effect.succeed(state.value),
      onSuccess: { target: "Done", reduce: ({ value }) => ({ value }) },
      onFailure: { target: "Done", reduce: () => ({ value: "unreachable" }) },
    }),
    Done: machine.final(),
  },
)

const running = definition.run({ key: "one" })
definition.open({ key: "one" })
const instance: MachineStore.MachineInstanceId = definition.instanceId({ key: "one" })

// @ts-expect-error Definition input remains exact.
definition.run({ key: 1 })
// @ts-expect-error Instance identity uses the same exact input.
definition.instanceId({ key: 1 })
// @ts-expect-error Version and instance options are definition-owned, not supplied per run.
definition.run({ key: "one" }, { persistenceVersion: "3" })

type UnifiedInferenceChecks = [
  Assert<Equal<typeof definition.version, string>>,
  Assert<
    Equal<Effect.Error<typeof running>, import("../src/MachineRuntimeProtocol.js").MachineError>
  >,
  Assert<Equal<Effect.Services<typeof running>, MachineEngine.MachineEngine | Scope.Scope>>,
]

void ignoresExecution
void instance
export type MachineEngineInferenceContract = UnifiedInferenceChecks
