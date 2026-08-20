import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type {
  MachineDocument,
  MachineInstanceId,
  MachineStoreError,
  Service,
} from "./MachineStore.js"
import { deriveMachineInstanceId, documentMetadata, revision } from "./MachineStore.js"

/** Primitive persistence behaviors required from every {@link Service} adapter. */
export const topics = [
  "authoritative-time",
  "absent-load",
  "atomic-create",
  "atomic-replacement",
  "stale-revision-conflict",
  "deadline-precondition",
  "instance-isolation",
  "schema-boundary",
] as const

/** One primitive-store behavior covered by the executable corpus. */
export type Topic = (typeof topics)[number]

/** Framework-neutral executable assertion for a machine-store adapter. */
export interface Case {
  readonly name: string
  readonly covers: ReadonlyArray<Topic>
  readonly run: Effect.Effect<void, MachineStoreError>
}

const ensure = (condition: boolean, message: string): Effect.Effect<void> =>
  condition ? Effect.void : Effect.die(new Error(`MachineStore conformance: ${message}`))

const document = (instanceId: MachineInstanceId): MachineDocument => {
  const checkpoint: MachineDocument["checkpoint"] = {
    formatVersion: 1,
    definitionId: "machine-store-conformance",
    persistenceVersion: "1",
    instanceId,
    revision: 0,
    status: "running",
    state: { _tag: "Active" },
    rootEntryId: "entry:0",
    regionEntryIds: {},
    timers: [],
    aggregates: [],
    nextSequence: 0,
    defect: null,
  }
  return {
    formatVersion: 2,
    revision: 0,
    instanceId,
    ...documentMetadata(checkpoint),
    checkpoint,
    messages: [],
    activities: [],
    dispatches: [],
    messageTombstones: [],
    executionTombstones: [],
    nestedDocuments: [],
    nextSequence: 0,
    tree: { rootActorId: `actor:${instanceId}`, nextSequence: 0, records: [] },
  }
}

/**
 * Builds the adapter-independent contract for the minimal aggregate store.
 *
 * The factory must return a fresh empty store for every case. `advance` must move the same clock
 * observed by that store, which makes the deadline assertion deterministic under virtual time.
 */
export const make = (
  makeStore: () => Effect.Effect<Service>,
  advance: (millis: number) => Effect.Effect<void> = Effect.sleep,
): ReadonlyArray<Case> => {
  const first = deriveMachineInstanceId("conformance", "first")
  const second = deriveMachineInstanceId("conformance", "second")
  return [
    {
      name: "reports finite store time and an absent initial load",
      covers: ["authoritative-time", "absent-load"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* ensure(Number.isFinite(yield* store.now), "store time must be finite")
        yield* ensure(Option.isNone(yield* store.load(first)), "new stores must load as absent")
      }),
    },
    {
      name: "atomically creates and replaces an aggregate",
      covers: ["atomic-create", "atomic-replacement", "stale-revision-conflict"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const initial = document(first)
        const created = yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: undefined,
          document: initial,
        })
        yield* ensure(created._tag === "Committed", "the first create must commit")
        const duplicate = yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: undefined,
          document: initial,
        })
        yield* ensure(duplicate._tag === "Conflict", "a duplicate create must conflict")
        const replaced = yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: revision(0),
          document: { ...initial, revision: 1 },
        })
        yield* ensure(replaced._tag === "Committed", "the current revision must replace")
        const stale = yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: revision(0),
          document: { ...initial, revision: 1 },
        })
        yield* ensure(stale._tag === "Conflict", "a stale revision must conflict")
      }),
    },
    {
      name: "checks the deadline atomically with replacement",
      covers: ["deadline-precondition"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        const initial = document(first)
        yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: undefined,
          document: initial,
        })
        const deadline = (yield* store.now) + 10
        yield* advance(10)
        const expired = yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: revision(0),
          document: { ...initial, revision: 1 },
          notAfter: deadline,
        })
        yield* ensure(expired._tag === "Expired", "a write at its deadline must expire")
      }),
    },
    {
      name: "isolates instances and rejects malformed documents",
      covers: ["instance-isolation", "schema-boundary"],
      run: Effect.gen(function* () {
        const store = yield* makeStore()
        yield* store.compareAndSet({
          instanceId: first,
          expectedRevision: undefined,
          document: document(first),
        })
        yield* ensure(Option.isNone(yield* store.load(second)), "instances must be isolated")
        const malformed = { ...document(second), messages: [{}] }
        const result = yield* Effect.exit(
          store.compareAndSet({
            instanceId: second,
            expectedRevision: undefined,
            // The assertion deliberately crosses the adapter boundary to test runtime validation.
            document: malformed as unknown as MachineDocument,
          }),
        )
        yield* ensure(
          result._tag === "Failure",
          "malformed documents must fail in the typed channel",
        )
      }),
    },
  ]
}
