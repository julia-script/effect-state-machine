# Effect Workflow and Schema modeling for tagged state machines

Research snapshot: **2026-08-09**. The target is the repository's pinned `effect@4.0.0-beta.106`; source links are pinned to the exact Effect commit behind that release (`fb75264`). Only installed Effect sources and the official Effect repository were used.

## Conclusion

Using Effect schemas as the source of the machine's `State` and `Event` types is a strong fit. The exact beta API is **`Schema.TaggedUnion`** (capitalized), with `Schema.toTaggedUnion(discriminant)` for adding the same utilities to an existing `Schema.Union`. A tagged schema provides runtime validation, decoded and encoded type information, per-case schemas, guards, and exhaustive matching. [`Schema.TaggedUnion`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L6314-L6389)

Effect Workflow validates the broader schema-first pattern, but not quite the proposed state model. A workflow definition has schemas for its **payload, success, and typed failure**; a named `Activity` has schemas for its success and failure. Workflow does **not** declare a schema for an explicit program counter or current workflow state. Durable execution is implemented by rerunning the workflow handler and replaying persisted results at named activity/deferred/clock boundaries. [`Workflow` model](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Workflow.ts#L37-L151), [`Activity` model](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Activity.ts#L28-L84), [cluster replay path](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L351-L443)

The transferable lesson is:

- Make machine states and events schema-first tagged unions.
- Use their schemas to validate, encode, restore, and enrich devtools metadata.
- Keep transition topology in the machine definition.
- Keep guards, reducers, invoked Effects, service implementations, and native Schedules explicitly named but opaque. Schemas describe the data crossing those executable boundaries; they cannot reveal the executable logic.

Schemas make snapshot persistence possible, but **do not themselves provide persistence or correct resume semantics**. That remains a separate interpreter/storage design problem.

## Exact tagged-union APIs

The concise form is:

```ts
import { Schema } from "effect"

export const TodoState = Schema.TaggedUnion({
  Loading: {},
  Idle: { todos: Schema.Array(Todo) },
  Saving: {
    todos: Schema.Array(Todo),
    pending: Todo
  },
  Failed: { message: Schema.String }
}).annotate({
  title: "TodoState",
  description: "The complete serializable state of the todo machine."
})

export type TodoState = typeof TodoState.Type
```

Each record key becomes the `_tag` literal and each value becomes the fields of a `Schema.TaggedStruct`. The result exposes:

- `cases`, mapping each tag to its member schema;
- `guards`, mapping each tag to a type guard;
- `isAnyOf`, for narrowing several cases;
- `match`, for exhaustive case handling;
- the union's decoded `Type`, `Encoded` representation, and decoding/encoding service requirements.

[`TaggedUnion` type and implementation](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L6320-L6389)

`Schema.tag("Loading")` automatically fills a tag when a value is constructed with `.make`, but normal decoding and encoding still require the tag in the input/output. This is useful for ergonomic constructors without removing the discriminator from persisted data. [`Schema.tag`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L6044-L6070), [`Schema.TaggedStruct`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L6107-L6169)

For state-specific descriptions, the more verbose form is preferable because each member can be annotated before forming the union:

```ts
const Loading = Schema.TaggedStruct("Loading", {}).annotate({
  description: "Loads the initial todo collection."
})

const Idle = Schema.TaggedStruct("Idle", {
  todos: Schema.Array(Todo)
}).annotate({
  description: "Accepts todo commands."
})

export const TodoState = Schema.Union([Loading, Idle]).pipe(
  Schema.toTaggedUnion("_tag")
)
```

`toTaggedUnion` accepts any literal discriminant, recursively flattens nested unions, exposes the same case/guard/match utilities, and rejects duplicate or missing discriminants at construction. [`Schema.toTaggedUnion`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L6212-L6312)

This suggests the machine API should accept the structural result of either `Schema.TaggedUnion(...)` or `Schema.Union(...).pipe(Schema.toTaggedUnion("_tag"))`, rather than requiring only the concise constructor.

## What schemas add to graph tooling

Schema nodes carry runtime annotations including `title`, `description`, `documentation`, examples, and stable identifiers. These annotations can be resolved at runtime and are included in generated JSON Schema where representable. [schema annotations](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L16463-L16649)

For a state-machine graph, this means devtools can derive without executing application logic:

- the complete state and event tag vocabulary;
- each variant's field names and schema shapes;
- human-authored state/event titles and descriptions;
- validation and encoding rules that are structurally represented in the schema AST;
- safe decoding of unknown persisted snapshots and events;
- canonical JSON-compatible representations using `Schema.toCodecJson`.

`Schema.toJsonSchemaDocument` is explicitly best-effort: some Effect schema semantics cannot be represented exactly, and opaque declarations without a structural codec become unconstrained JSON Schema. Likewise, `Schema.toCodecJson` always constructs a codec, but encoding/decoding may still fail for opaque declaration values that are not actually JSON-compatible. [`toJsonSchemaDocument` limitations](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L15317-L15350), [`toCodecJson` limitations](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schema.ts#L15355-L15401)

The raw Schema AST should consequently not become the devtools protocol. Some AST nodes retain executable predicates, parser functions, or transformations. Devtools should project the safe facts it understands—tags, object fields, literals, selected annotations—into its own small graph metadata model and treat the rest as opaque.

Therefore “uses a Schema” and “is safely persistable JSON” are not identical promises. A v0 machine can avoid surprising runtime requirements by constraining state/event schemas to codecs with no decoding or encoding services and by verifying their canonical JSON codecs. If schema services are allowed later, snapshot encode/decode requirements should become part of the machine Effect's inferred environment.

## What Effect Workflow actually persists and resumes

`Workflow.make(tag, options)` accepts:

- a struct-shaped payload schema or field record;
- optional success and error schemas;
- an idempotency-key function used with the stable workflow tag to derive an execution ID;
- an optional retry Schedule for suspended executions;
- annotations.

There is no workflow-state schema in this definition. [`Workflow.make`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Workflow.ts#L421-L461)

`Activity.make` wraps an arbitrary Effect with a stable name plus success/error schemas. It derives canonical JSON codecs, encodes the resulting success or typed failure, and hands that encoded result to the engine. The Effect itself remains executable and opaque. [`Activity.make`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Activity.ts#L116-L179)

The durable cluster engine turns workflow operations into persisted RPC messages:

- `run` persists the schema-derived workflow payload and workflow result;
- `activity` is keyed by activity name and retry attempt;
- `deferred` is keyed by deferred name;
- `resume` resets a previously suspended `run` request.

[persisted workflow RPC schemas](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L648-L718), [resume reset](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L272-L289)

On resume, the engine calls the registered workflow handler again from its beginning. When execution reaches an activity/deferred that already has a persisted reply, the engine returns that recorded result rather than repeating the external work. Arbitrary Effects and local computations outside those boundaries may therefore execute again. The official integration tests demonstrate both ordinary suspension/resumption and replay of a completed activity after its owning process dies without repeating that activity. [cluster execution and activity replay](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L351-L443), [basic workflow engine test](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/test/cluster/ClusterWorkflowEngine.test.ts#L22-L79), [process-death replay test](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/platform-node/test/cluster-integration/Workflow.test.ts#L305-L347)

This is a replay/history model, not snapshot restoration of an explicit tagged state. For this state-machine project, an explicit state union creates a simpler possible persistence model—encode the current state—but correct resume still requires decisions about:

- whether queued external events are persisted;
- what happens to an invocation that was active at the snapshot;
- whether that operation is restarted, deduplicated, or represented as a durable activity;
- how stale completion events are rejected;
- when snapshot writes are acknowledged relative to transitions.

The Workflow package demonstrates the amount of machinery required for durable side-effect boundaries. It should not be inferred that adding State/Event schemas automatically gives the state-machine interpreter those guarantees.

## Schema evolution status

There is **no first-class `version`, `migrate`, or workflow-code version API** in `effect@4.0.0-beta.106`'s Workflow definition or workflow package. The complete `Workflow.make` option surface has none of these fields, and the workflow source contains no migration/evolution facility. [`Workflow.make` options](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Workflow.ts#L429-L461)

Schema itself provides ingredients for compatible evolution, not an automatic policy. Defaults and transformations can decode an older encoded shape into the current type. The cluster workflow engine uses this approach internally: the persisted `activity` RPC's newer `withTransaction` boolean has a decoding default of `false`, allowing old payloads without the field to decode. [compatible field addition](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L651-L665)

Stable executable names are also persistence identities, not merely documentation: a workflow execution ID hashes the workflow tag with its idempotency key, and an activity request is keyed by activity name plus attempt. Renaming either can make previously stored execution history unreachable under the new code. [`Workflow` execution identity](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/workflow/Workflow.ts#L316-L317), [activity persistence identity](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/unstable/cluster/ClusterWorkflowEngine.ts#L696-L727)

For future persisted machine snapshots, the robust design would be an explicit envelope such as:

```ts
Schema.Struct({
  machineId: Schema.String,
  schemaVersion: Schema.Int,
  state: PersistedState
})
```

Versioned legacy schemas can then decode through explicit transformations into the current State type. Renaming/removing a state tag or changing an event payload is otherwise a persisted-data compatibility break. This policy is not necessary to obtain the immediate validation and graph benefits, so automatic persistence/resume should remain outside v0 unless it becomes a deliberate feature.

## Recommendation for this project

1. **Adopt schema-first `State` and `Event` definitions.** Derive TypeScript types from the schemas; do not maintain parallel type declarations.
2. **Require a canonical `_tag` union with exposed cases.** Accept both `Schema.TaggedUnion` and `Schema.toTaggedUnion("_tag")` results so users can choose concise cases or individually annotated case schemas.
3. **Keep the entire active state in the tagged union.** This preserves the prototype's “impossible states are unrepresentable” property and gives snapshot encoding a natural unit.
4. **Use schema metadata in the renderer-independent graph model.** Case names, field shapes, titles, and descriptions are honest static information.
5. **Do not imply that schemas reveal behavior.** Transition topology comes from the machine definition. Pure guard predicates, pure reducers, invoked Effects, Layer-provided services, and native Schedules remain named executable logic whose code or authored description must be inspected.
6. **Separate serialization from durability.** Offer encode/decode or snapshot helpers before promising automatic persistence. Design durable invocation and resume semantics independently if the acceptance application proves they are needed.
7. **Treat evolution as explicit.** If persisted snapshots enter scope, add a machine identity/version envelope and user-authored Schema transformations; do not assume the current Workflow beta supplies migration semantics to borrow.

The important architectural result is that Schema strengthens the library's core promise without creating a second orchestration system: the machine remains responsible for behavior, while Schema owns the data vocabulary at its boundaries.
