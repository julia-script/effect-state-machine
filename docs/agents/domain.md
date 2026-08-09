# Domain Docs

Before exploring the codebase, read the root `CONTEXT.md` and relevant ADRs under `docs/adr/` when they exist. Their absence is not an error; domain-modeling workflows create them lazily.

This repository uses a single-context layout:

```
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

Use terminology defined in `CONTEXT.md`. If work contradicts an existing ADR, surface the conflict explicitly rather than silently overriding it.
