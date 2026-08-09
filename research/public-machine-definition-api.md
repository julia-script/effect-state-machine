# Public machine-definition API prototype

**Status:** Recommended by ticket 01

**Artifact:** `prototypes/public-machine-definition-api/`

The code in this prototype is deliberately throwaway evidence. It is compile-checked and synchronously executable for structural inspection, but it is not the production interpreter and should not be imported by application code.

## Verdict

Proceed with the schema-bound builder shape exercised by the prototype:

```ts
const document = Machine.builder({
  input: DocumentInput,
  state: DocumentState,
  event: DocumentEvent,
})

const definition = document.make({
  id: "document-session",
  description: "Own one document session.",
  initial: (input) => ({ _tag: "Closed", documentId: input.documentId }),
  nodes: [
    document.state("Closed", { on: { /* event routes */ } }),
    document.invoke("Opening", { /* one named Effect */ }),
    document.child("Resolving", { /* one named child */ }),
    document.final("Done"),
  ],
})
```

Binding the three Schemas once gives every node the complete state and event vocabulary while preserving exact case narrowing. `Machine.make` is not recommended: keeping `make` on the schema-bound builder prevents definitions from drifting away from their vocabulary.

`Schema.TaggedUnion({...})` and annotated `Schema.TaggedStruct` cases combined with `Schema.toTaggedUnion("_tag")` are both accepted inputs. The longer annotated-case form is recommended whenever individual state or event descriptions matter. This keeps descriptions beside the values they explain and lets tooling read them with `Schema.resolveAnnotations`.

## Recommended node surface

The four node methods are:

- `builder.state(tag, { on })` for an ordinary state.
- `builder.invoke(tag, { name, description?, effect, retry?, onSuccess, onFailure, on? })` for one named Effect.
- `builder.child(tag, { name, description?, machine, input, forward, onDone, on? })` for one statically declared child.
- `builder.final(tag)` for a final state whose state value is the completion value.

The state tag selects and narrows the current state variant. Event-map keys select and narrow the event variant. Transition targets accept only tags from the State Schema. Reducers remain inline and pure; they do not need artificial names because the event, source, target, and optional transition description already explain their role.

Each transition type couples its literal `target` to the reducer's return variant. A transition that declares `target: "Saving"` cannot return a `Done` state and make runtime behavior disagree with the graph.

An invoked Effect infers its success, typed failure, and service requirements. A child infers its input, forwarded event vocabulary, final output, and transitive service requirements. A parent event tag is forwardable only when that parent's full event variant is assignable to the child's same-tag variant, preventing equal tags from hiding incompatible payloads. `MachineCompletion<Definition>` and `MachineRequirements<Definition>` expose those results without parallel declarations.

## Recommended branch surface

A direct transition remains the smallest form:

```ts
Save: {
  target: "Saving",
  description: "Persist current edits.",
  reduce: ({ state, event }) => nextState,
}
```

Guarded alternatives use an ordered `branches` tuple:

```ts
Save: {
  branches: [
    {
      when: {
        name: "document has changes",
        description: "Do not write unchanged content.",
        guard: ({ state, event }) => state.dirty,
      },
      target: "Saving",
      reduce: ({ state, event }) => nextState,
    },
    {
      otherwise: true,
      target: "Done",
      reduce: ({ state }) => completedState,
    },
  ],
}
```

Array order is evaluation order and therefore graph data. Every opaque predicate has a stable name; a final `{ otherwise: true }` is the explicit fallback. The tuple type permits at most one fallback and only in the final position. Omitting it deliberately leaves a possible protocol defect. An intentionally accepted no-op uses `{ ignore: { description? } }`, making ignored events visible instead of silently swallowing them.

This record shape borrows `when` and fallback ergonomics from Effect Match without using Match as storage. A standalone `builder.when(...)` helper was rejected because it loses the source-state and event-key contextual types at the call site unless authors repeat them. Raw branch records keep narrowing, ordering, names, descriptions, targets, and reducers together for tooling.

The production API should reuse this ordered branch vocabulary for tagged typed-failure alternatives when that capability is implemented. The predicate remains opaque and named; tag-specific conveniences may add narrowing without changing the stored branch record.

## Recommended retry surface

Operational retry belongs directly on an invoked node:

```ts
retry: {
  name: "retry transient open failures",
  description: "Retry opening twice before exposing the failure.",
  schedule: Schedule.recurs(2),
}
```

The native Schedule remains executable and opaque. Static tooling displays only the authored name and description; runtime inspection later reports actual attempts and delays. No wrapper Schedule AST or simulated static trace is introduced. Retry requirements contribute to the node's inferred environment. When attempts affect accepted events or visible state, authors model them as ordinary machine behavior rather than adding callbacks to this operational-retry object.

## Recommended inspection placement

Static topology is read directly from the completed definition: `id`, `description`, `schemas`, and ordered `nodes`. Nodes retain their named behavior and transition records, so graph tooling needs neither dependencies nor Effect execution. There is no `mermaid` field and no duplicate metadata tree on the application API.

Runtime inspection belongs on the Effect-native handle:

```ts
interface MachineHandle<Definition> {
  readonly snapshot: Effect<MachineState<Definition>>
  readonly changes: Stream<MachineState<Definition>>
  readonly send: (event: MachineEvent<Definition>) => Effect<void>
  readonly can: (event: MachineEvent<Definition>) => Effect<boolean>
  readonly completion: Effect<MachineCompletion<Definition>>
  readonly inspection: Stream<InspectionEvent>
}
```

`changes` remains application state observation; `inspection` explains interpreter decisions. Putting both on the scoped handle makes ownership and lifetime obvious and avoids a global inspector. The precise inspection-event union belongs to the runtime tracer bullet, but its placement and metadata-only default are settled here.

## Rejected alternatives

- **Extend the existing Todo builder:** rejected because it mixes an older TypeScript-only API with interpreter decisions that later tickets intentionally revisit.
- **One large untyped configuration object:** rejected because it weakens tag-specific narrowing and hides the four distinct lifecycle kinds.
- **Effect Match as the stored transition:** rejected because Match erases authored patterns, names, descriptions, and branch order into executable functions.
- **Named reducers:** rejected as ceremony; pure inline reducers are already located beside visible topology.
- **Descriptions in a separate registry:** rejected because metadata would drift away from the element it explains.
- **A custom retry DSL:** rejected because it would duplicate Effect Schedule and still fail to represent arbitrary native policies honestly.
- **Graph or Mermaid output on the machine handle:** rejected as devtools responsibility and because static topology does not require a running instance.
- **A Promise or core-owned runtime surface:** rejected because consumers should execute Effects and provide Layers at their own composition root.

## What this prototype proves

- Input, state, and event types derive from Effect Schema without parallel unions.
- State and event callbacks narrow from their tags.
- Invalid transition targets fail compilation.
- Reducer return variants must agree with their declared targets.
- Ordered named guards and explicit fallback remain directly inspectable.
- A guarded fallback can occur only once and in the final branch position.
- Effect output, typed failure, and service requirements remain inferred.
- Native retry metadata remains graphable without inspecting Schedule internals.
- Child input, forwarded events, completion, and requirements compose through the parent.
- Same-tag parent/child events with incompatible payloads cannot be forwarded.
- Final nodes infer the completion union.
- The complete definition can be inspected synchronously without running Effects or providing services.

It does not prove interpreter behavior, cancellation, validation, persistence, graph projection, or the final inspection-event vocabulary. Those remain production work in later tickets.
