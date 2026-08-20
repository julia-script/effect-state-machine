/** Permanent compile-time contract for the engine, store, and browser-adapter public subpaths. */
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import * as LocalStorageMachineStore from "../src/LocalStorageMachineStore.js"
import * as MachineEngine from "../src/MachineEngine.js"
import * as MachineStore from "../src/MachineStore.js"

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<Condition extends true> = Condition

const instanceId = MachineStore.deriveMachineInstanceId("Order", "42")
const entryId = MachineStore.deriveEntryId(instanceId, 1)
const executionId = MachineStore.deriveExecutionId(instanceId, entryId, "Charging", "charge")
const childId = MachineStore.deriveChildMachineInstanceId(instanceId, entryId, "payment")

const parsedChild: MachineStore.ChildMachineIdentity | undefined =
  MachineStore.parseChildMachineInstanceId(childId)

// @ts-expect-error Identity domains remain nominally separate.
const wrongEntry: MachineStore.EntryId = instanceId
// @ts-expect-error Work execution identity is not an arbitrary string.
const wrongExecution: MachineStore.ExecutionId = "execution"

declare const document: MachineStore.MachineDocument
const request: MachineStore.CompareAndSetRequest = {
  instanceId,
  expectedRevision: MachineStore.revision(document.revision),
  document,
  notAfter: 1_000,
}

declare const store: MachineStore.Service
const loaded: Effect.Effect<
  Option.Option<MachineStore.MachineDocument>,
  MachineStore.MachineStoreError
> = store.load(instanceId)
const replaced: Effect.Effect<MachineStore.CompareAndSetResult, MachineStore.MachineStoreError> =
  store.compareAndSet(request)

declare const storage: LocalStorageMachineStore.Storage
declare const locks: LocalStorageMachineStore.Locks
const coordinated = LocalStorageMachineStore.layer({ storage, locks })
const singleContext = LocalStorageMachineStore.layerSingleContext({ storage })
const persistentEngine = MachineEngine.layer()
const memoryEngine = MachineEngine.layerMemory()

type PublicModuleChecks = [
  Assert<Equal<typeof instanceId, MachineStore.MachineInstanceId>>,
  Assert<Equal<typeof entryId, MachineStore.EntryId>>,
  Assert<Equal<typeof executionId, MachineStore.ExecutionId>>,
  Assert<Equal<Layer.Success<typeof coordinated>, MachineStore.MachineStore>>,
  Assert<Equal<Layer.Error<typeof coordinated>, LocalStorageMachineStore.UnsupportedPlatform>>,
  Assert<Equal<Layer.Services<typeof coordinated>, never>>,
  Assert<Equal<Layer.Success<typeof singleContext>, MachineStore.MachineStore>>,
  Assert<Equal<Layer.Error<typeof singleContext>, never>>,
  Assert<Equal<Layer.Success<typeof persistentEngine>, MachineEngine.MachineEngine>>,
  Assert<Equal<Layer.Services<typeof persistentEngine>, MachineStore.MachineStore>>,
  Assert<Equal<Layer.Success<typeof memoryEngine>, MachineEngine.MachineEngine>>,
  Assert<Equal<Layer.Services<typeof memoryEngine>, never>>,
]

void parsedChild
void wrongEntry
void wrongExecution
void loaded
void replaced
export type PublicModulesInferenceContract = PublicModuleChecks
