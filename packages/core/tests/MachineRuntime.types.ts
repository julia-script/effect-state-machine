/** Permanent compile-time contract for durable execution and adapter APIs. */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaTransformation from "effect/SchemaTransformation"
import type * as Scope from "effect/Scope"
import * as Machine from "../src/Machine.js"
import * as Runtime from "./MachineRuntimeTestKit.js"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition

class CodecOffset extends Context.Service<CodecOffset, { readonly value: number }>()(
  "Runtime.types/CodecOffset",
) {}

class WorkService extends Context.Service<WorkService, { readonly value: string }>()(
  "Runtime.types/WorkService",
) {}

const OffsetNumber = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Number,
    SchemaTransformation.transformOrFail({
      decode: (encoded) => Effect.map(CodecOffset, ({ value }) => Number(encoded) + value),
      encode: (decoded) => Effect.map(CodecOffset, ({ value }) => String(decoded - value)),
    }),
  ),
)

const State = Machine.taggedUnion({
  Working: { fields: { count: OffsetNumber } },
  Done: { fields: { result: Schema.String } },
})
const Event = Machine.taggedUnion({
  Finish: { fields: { amount: OffsetNumber } },
})
const machine = Machine.builder({
  input: Schema.Struct({ seed: Schema.Number }),
  state: State,
  event: Event,
})
const definition = machine.define(
  {
    id: "durable-types",
    initial: ({ seed }) => ({ _tag: "Working", count: seed }),
    idempotencyKey: (input) => JSON.stringify(input) ?? "default",
  },
  {
    Working: machine.invoke({
      name: "work",
      success: Schema.String,
      error: Schema.Never,
      effect: () => Effect.map(WorkService, ({ value }) => value),
      onSuccess: {
        target: "Done",
        reduce: ({ value }) => ({ result: value }),
      },
      onFailure: {
        target: "Done",
        reduce: () => ({ result: "unreachable" }),
      },
    }),
    Done: machine.final(),
  },
)

const options: Runtime.RunOptions = {
  instanceId: Runtime.instanceId("durable-types:one"),
  persistenceVersion: Runtime.persistenceVersion("1"),
}
const running = Runtime.run(definition, { seed: 1 }, options)

// @ts-expect-error Runtime input must match the definition input Schema.
Runtime.run(definition, { seed: "one" }, options)

declare const handle: Effect.Success<typeof running>
handle.send({ _tag: "Finish", amount: 1 }, { idempotencyKey: "finish:1" })
// @ts-expect-error Runtime events must match the definition event Schema.
handle.send({ _tag: "Finish", amount: "one" }, { idempotencyKey: "finish:2" })
// @ts-expect-error Runtime event tags are definition-derived.
handle.send({ _tag: "Unknown" }, { idempotencyKey: "finish:3" })

const migration = {
  from: Runtime.persistenceVersion("1"),
  to: Runtime.persistenceVersion("2"),
  migrate: (document: Runtime.MigrationDocument) => Effect.succeed(document),
} satisfies Runtime.Migration

const storeFactory: () => Effect.Effect<Runtime.StoreService> = Runtime.makeMemoryStore
const conformance: ReadonlyArray<Runtime.StoreConformanceCase> =
  Runtime.storeConformance(storeFactory)
declare const compatibilityReason: Runtime.CompatibilityReason
const compatibilityMessage = (() => {
  switch (compatibilityReason._tag) {
    case "DefinitionMismatch":
      return `${compatibilityReason.expectedDefinitionId}:${compatibilityReason.actualDefinitionId}`
    case "PersistenceVersionMismatch":
      return `${compatibilityReason.expected}:${compatibilityReason.actual}`
    case "MissingMigration":
      return `${compatibilityReason.from}:${compatibilityReason.target}`
    default: {
      const exhaustive: never = compatibilityReason
      return exhaustive
    }
  }
})()
void migration
void conformance
void compatibilityMessage

type StateType = Machine.MachineState<typeof definition>
type EventType = Machine.MachineEvent<typeof definition>
type CompletionType = Machine.MachineCompletion<typeof definition>

type DurableInferenceChecks = [
  Assert<
    Equal<Effect.Success<typeof running>, Runtime.Handle<StateType, EventType, CompletionType>>
  >,
  Assert<Equal<Effect.Error<typeof running>, Runtime.MachineError>>,
  Assert<
    Equal<Effect.Services<typeof running>, Scope.Scope | Runtime.Store | WorkService | CodecOffset>
  >,
  Assert<Equal<Effect.Error<ReturnType<typeof handle.send>>, Runtime.MachineError>>,
  Assert<Equal<Effect.Success<ReturnType<typeof storeFactory>>, Runtime.StoreService>>,
]

export type DurableInferenceContract = DurableInferenceChecks
