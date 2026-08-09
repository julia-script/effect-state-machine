# 01 — Prototype the public machine-definition API

**What to build:** Create a throwaway, compile-checked API prototype that lets an Effect user describe a Schema-first state machine clearly enough to evaluate its ergonomics before the production interpreter is built.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] A representative definition binds Effect Schema input, state, and event vocabularies once and derives their TypeScript types from those Schemas.
- [ ] The example expresses all four planned node kinds: ordinary state, invoked Effect, invoked child machine, and final state.
- [ ] State and event descriptions remain adjacent to their Schemas, while guards, invocations, children, and retry policies carry stable names and optional nearby descriptions.
- [ ] The API demonstrates ordered guarded alternatives, an inferred typed Effect, named retry metadata, child input and event forwarding, and inferred final-state completion.
- [ ] Compile-time examples prove state/event narrowing, valid transition targets, completion inference, and transitive Effect requirements; intentional misuse is rejected by TypeScript.
- [ ] A completed definition is synchronously inspectable without running Effects or providing services, and exposes enough immutable structure for a graph projection.
- [ ] The prototype records a recommendation for the exact builder, branch, retry, and inspection surfaces, including rejected alternatives and their trade-offs.
- [ ] The artifact is explicitly marked as throwaway evidence rather than production implementation.
- [ ] The repository's type-check command passes with the prototype and its compile-time examples.
