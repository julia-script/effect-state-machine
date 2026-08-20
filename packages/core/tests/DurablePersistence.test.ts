import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Durable from "../src/Durable.js"
import * as Machine from "../src/Machine.js"

const State = Machine.taggedUnion({ Active: { fields: {} }, Done: { fields: {} } })
const Event = Machine.taggedUnion({ Finish: { fields: {} } })
const machine = Machine.builder({ input: Schema.Struct({}), state: State, event: Event })
const definition = machine.define(
  { id: "persistence-boundaries", initial: () => ({ _tag: "Active" }) },
  {
    Active: machine.state({ Finish: { target: "Done", reduce: () => ({}) } }),
    Done: machine.final(),
  },
)

const checkpoint = (
  id: Durable.InstanceId,
  overrides: Partial<Durable.Checkpoint>,
): Durable.Checkpoint => ({
  formatVersion: 1,
  definitionId: definition.id,
  persistenceVersion: "1",
  instanceId: id,
  revision: 0,
  status: "running",
  state: { _tag: "Active" },
  rootEntryId: "entry-0",
  regionEntryIds: {},
  timers: [],
  aggregates: [],
  nextSequence: 0,
  defect: null,
  ...overrides,
})

const resumeError = (store: Durable.StoreService, id: Durable.InstanceId) =>
  Effect.flip(
    Effect.scoped(
      Durable.run(
        definition,
        {},
        {
          instanceId: id,
          persistenceVersion: Durable.persistenceVersion("1"),
        },
      ).pipe(Effect.provideService(Durable.Store, store)),
    ),
  )

describe("Durable persistence boundaries", () => {
  it.effect("rejects an active region omitted by the encoded parent state", () =>
    Effect.gen(function* () {
      const Slot = Machine.taggedUnion({
        Loading: { fields: { value: Schema.String } },
        Loaded: { fields: { value: Schema.String } },
      })
      const DecodedParallel = Schema.Struct({ _tag: Schema.Literal("Parallel"), slot: Slot })
      const EncodedParallel = Schema.Struct({ _tag: Schema.Literal("Parallel") }).pipe(
        Schema.decodeTo(
          DecodedParallel,
          SchemaTransformation.transformOrFail({
            decode: (): Effect.Effect<Schema.Schema.Type<typeof DecodedParallel>> =>
              Effect.succeed({
                _tag: "Parallel",
                slot: { _tag: "Loading", value: "hello" },
              }),
            encode: () => Effect.succeed({ _tag: "Parallel" as const }),
          }),
        ),
      )
      const MissingSlotState = Schema.Union([
        EncodedParallel,
        Schema.TaggedStruct("Finished", { value: Schema.String }),
      ])
      const RegionEvent = Machine.taggedUnion({ Noop: { fields: {} } })
      const regionMachine = Machine.builder({
        input: Schema.Struct({}),
        state: MissingSlotState,
        event: RegionEvent,
      })
      const regionDefinition = regionMachine.define(
        {
          id: "missing-encoded-region-slot",
          initial: () => ({ _tag: "Parallel", slot: { _tag: "Loading", value: "hello" } }),
        },
        {
          Parallel: regionMachine.regions(
            {
              slot: {
                Loading: regionMachine.region.invoke({
                  name: "load",
                  success: Schema.String,
                  error: Schema.Never,
                  effect: () => Effect.never,
                  onSuccess: { target: "Loaded", reduce: ({ value }) => ({ value }) },
                  onFailure: {
                    target: "Loaded",
                    reduce: () => ({ value: "unreachable" }),
                  },
                }),
                Loaded: regionMachine.final(),
              },
            },
            undefined,
            {
              onComplete: {
                target: "Finished",
                reduce: ({ state }) => ({ value: state.slot.value }),
              },
            },
          ),
          Finished: regionMachine.final(),
        },
      )
      const store = yield* Durable.makeMemoryStore()
      const id = Durable.instanceId("missing-encoded-region-slot")
      const error = yield* Effect.flip(
        Effect.scoped(
          Durable.run(
            regionDefinition,
            {},
            {
              instanceId: id,
              persistenceVersion: Durable.persistenceVersion("1"),
            },
          ).pipe(Effect.provideService(Durable.Store, store)),
        ),
      )
      assert.strictEqual(error._tag, "DurableEncodingError")
      if (error._tag !== "DurableEncodingError") return
      assert.strictEqual(error.operation, "plan region activity")
      assert.match(error.message, /encoded state is missing active region slot slot/)
      assert.strictEqual((yield* store.loadDocument(id))._tag, "None")
    }),
  )

  it.effect("publishes a region activity from the encoded slot representation", () =>
    Effect.gen(function* () {
      const Slot = Machine.taggedUnion({
        Loading: { fields: { value: Schema.String } },
        Loaded: { fields: { value: Schema.String } },
      })
      const EncodedSlot = Schema.String.pipe(
        Schema.decodeTo(
          Slot,
          SchemaTransformation.transformOrFail({
            decode: (encoded) => {
              const separator = encoded.indexOf(":")
              const tag = encoded.slice(0, separator)
              const value = encoded.slice(separator + 1)
              return Effect.succeed(
                tag === "Loaded"
                  ? ({ _tag: "Loaded", value } as const)
                  : ({ _tag: "Loading", value } as const),
              )
            },
            encode: (decoded) => Effect.succeed(`${decoded._tag}:${decoded.value}`),
          }),
        ),
      )
      const RegionState = Machine.taggedUnion({
        Parallel: { fields: { slot: EncodedSlot } },
        Finished: { fields: { value: Schema.String } },
      })
      const RegionEvent = Machine.taggedUnion({ Noop: { fields: {} } })
      const regionMachine = Machine.builder({
        input: Schema.String,
        state: RegionState,
        event: RegionEvent,
      })
      const regionDefinition = regionMachine.define(
        {
          id: "encoded-region-slot",
          initial: (value) => ({ _tag: "Parallel", slot: { _tag: "Loading", value } }),
        },
        {
          Parallel: regionMachine.regions(
            {
              slot: {
                Loading: regionMachine.region.invoke({
                  name: "load",
                  success: Schema.String,
                  error: Schema.Never,
                  effect: () => Effect.never,
                  onSuccess: {
                    target: "Loaded",
                    reduce: ({ value }) => ({ value }),
                  },
                  onFailure: {
                    target: "Loaded",
                    reduce: () => ({ value: "unreachable" }),
                  },
                }),
                Loaded: regionMachine.final(),
              },
            },
            undefined,
            {
              onComplete: {
                target: "Finished",
                reduce: ({ state }) => ({ value: state.slot.value }),
              },
            },
          ),
          Finished: regionMachine.final(),
        },
      )
      const store = yield* Durable.makeMemoryStore()
      const id = Durable.instanceId("encoded-region-slot")
      yield* Effect.scoped(
        Effect.asVoid(
          Durable.run(regionDefinition, "hello", {
            instanceId: id,
            persistenceVersion: Durable.persistenceVersion("1"),
          }).pipe(Effect.provideService(Durable.Store, store)),
        ),
      )
      const document = yield* store.loadDocument(id)
      assert.strictEqual(document._tag, "Some")
      if (document._tag !== "Some") return
      assert.strictEqual(document.value.activities[0]?.state, "Loading:hello")
      assert.deepStrictEqual(document.value.activities[0]?.parentState, {
        _tag: "Parallel",
        slot: "Loading:hello",
      })
    }),
  )

  it.effect("distinguishes checkpoint format incompatibility", () =>
    Effect.gen(function* () {
      const store = yield* Durable.makeMemoryStore()
      const id = Durable.instanceId("format-mismatch")
      yield* store.create({
        checkpoint: checkpoint(id, { formatVersion: 99 }),
        messages: [],
        activities: [],
      })
      const error = yield* resumeError(store, id)
      assert.strictEqual(error._tag, "CompatibilityError")
      if (error._tag !== "CompatibilityError") return
      assert.deepStrictEqual(error.reason, {
        _tag: "CheckpointFormatMismatch",
        expectedFormatVersion: 1,
        actualFormatVersion: 99,
      })
    }),
  )

  it.effect("distinguishes definition identity incompatibility", () =>
    Effect.gen(function* () {
      const store = yield* Durable.makeMemoryStore()
      const id = Durable.instanceId("definition-mismatch")
      yield* store.create({
        checkpoint: checkpoint(id, { definitionId: "another-machine" }),
        messages: [],
        activities: [],
      })
      const error = yield* resumeError(store, id)
      assert.strictEqual(error._tag, "CompatibilityError")
      if (error._tag !== "CompatibilityError") return
      assert.deepStrictEqual(error.reason, {
        _tag: "DefinitionMismatch",
        expectedDefinitionId: definition.id,
        actualDefinitionId: "another-machine",
      })
    }),
  )

  it("keeps boundary causes live without placing them in persisted defect summaries", () => {
    const cause = new Error("database unavailable")
    const storeError = new Durable.StoreError({
      operation: "load",
      message: cause.message,
      cause,
    })
    const encodingError = new Durable.DurableEncodingError({
      operation: "encode",
      message: cause.message,
      cause,
    })
    const migrationError = new Durable.MigrationError({
      instanceId: Durable.instanceId("cause"),
      message: cause.message,
      cause,
    })
    assert.strictEqual(storeError.cause, cause)
    assert.strictEqual(encodingError.cause, cause)
    assert.strictEqual(migrationError.cause, cause)
    assert.strictEqual("cause" in Durable.DurableDefectSummary.fields, false)
  })

  it.effect("rejects malformed values under every published durable envelope Schema", () =>
    Effect.gen(function* () {
      const id = Durable.instanceId("malformed-envelope")
      const validCheckpoint = checkpoint(id, {})
      const validations: ReadonlyArray<Effect.Effect<void, Schema.SchemaError>> = [
        Effect.asVoid(
          Schema.decodeUnknownEffect(Schema.toCodecJson(Durable.Checkpoint))({
            ...validCheckpoint,
            state: undefined,
          }),
        ),
        Effect.asVoid(
          Schema.decodeUnknownEffect(Schema.toCodecJson(Durable.MachineMessage))({
            _tag: "External",
            messageId: "message",
            instanceId: id,
            availableAtEpochMillis: 0,
            idempotencyKey: "event",
            payloadFingerprint: "fingerprint",
            event: undefined,
          }),
        ),
        Effect.asVoid(
          Schema.decodeUnknownEffect(Schema.toCodecJson(Durable.ActivityCommand))({
            deliveryId: "activity",
            instanceId: id,
            executionKey: "execution",
            entryId: "entry",
            ownerPath: "root",
            invocation: "work",
            lane: "",
            state: undefined,
            parentState: null,
            concurrencyGroup: "group",
            concurrencyLimit: 1,
          }),
        ),
        Effect.asVoid(
          Schema.decodeUnknownEffect(Schema.toCodecJson(Durable.ActivityOutcome))({
            _tag: "Success",
            encodedValue: undefined,
          }),
        ),
        Effect.asVoid(
          Schema.decodeUnknownEffect(Schema.toCodecJson(Durable.DispatchRecord))({
            instanceId: id,
            idempotencyKey: "event",
            payloadFingerprint: "fingerprint",
            status: "pending",
            revision: "zero",
            reason: "",
          }),
        ),
        Effect.asVoid(
          Schema.decodeUnknownEffect(Schema.toCodecJson(Durable.MigrationDocument))({
            checkpoint: { ...validCheckpoint, state: undefined },
            messages: [],
            activities: [],
          }),
        ),
      ]
      for (const validation of validations) {
        const exit = yield* Effect.exit(validation)
        assert.strictEqual(exit._tag, "Failure")
      }
    }),
  )
})
