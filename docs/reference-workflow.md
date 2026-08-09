# Local-first document reference workflow

[`examples/LocalFirstDocument.ts`](../examples/LocalFirstDocument.ts) is the integrated v0 proof.
It is a headless single-document session whose definition is used unchanged for execution,
inspection, codec tests, renderer-independent graph projection, and Mermaid rendering.

The parent machine opens a document from an injected local service, accepts edits, saves locally,
synchronizes through an injected remote service, continues editing offline, and closes the
session. Offline synchronization uses a named native Effect `Schedule`; conflicts enter a visible
parent state that owns one typed conflict-resolution child machine. Typed local and remote
failures follow declared transitions, while defects terminate completion with their `Cause`.

The example intentionally performs no Promise conversion and has no framework binding. The
composition root supplies `Documents` and `Synchronizer` Layers, so tests can replace either
implementation without changing the definition.

## Composition evidence

The workflow required a statically invoked child because conflict resolution is interactive,
reusable, and state-owned. It did not require hierarchy: no group of parent states needed inherited
transitions or one shared lifetime that survived transitions among descendants. It did not require
parallel regions: editing, connectivity, and synchronization were modeled as exclusive protocol
phases, with no need for one event to atomically update several active regions. It did not require
dynamic children because the session owns exactly one document and at most one conflict resolver.

Those omissions are evidence from this bounded application, not claims that the features are
universally unnecessary. A multi-document workspace would reopen dynamic identity; independently
active editing, connectivity, and sync modes with atomic event semantics would reopen parallel
regions; inherited behavior spanning several nested phases would reopen hierarchy.

Schema encoding in this example covers explicit input, state, and event boundaries only. It does
not claim persistence, event replay, migration, or resumption of an interrupted Effect.
