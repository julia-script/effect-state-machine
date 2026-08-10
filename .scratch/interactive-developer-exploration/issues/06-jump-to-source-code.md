# 06 — Jump automatically from behavior to source code

**What to build:** Automatically associate authored machine elements with trustworthy declaration
locations and let a developer open those locations without maintaining file paths or line numbers.

**Blocked by:** 01 — Attach a live devtools session to a real machine

**Status:** ready-for-agent

- [ ] Machine construction captures lazy caller information for state, invoked Effect, child, final,
      and named guard builder operations without importing Effect internals.
- [ ] Machine authors provide no file paths, line numbers, or manually maintained source-location
      metadata.
- [ ] Ordinary transitions and inline reducers without their own construction helper fall back to
      the owning node declaration instead of claiming exact statement precision.
- [ ] Captured source references remain opaque to machine execution and do not alter transition
      semantics or Effect requirements.
- [ ] Devtools normalization parses common browser and Node stack-frame forms and removes frames
      belonging to the state-machine library itself.
- [ ] Missing, malformed, generated-only, or otherwise untrustworthy locations produce no source
      link rather than an incorrect one.
- [ ] An optional development resolver can map generated locations through available source maps and
      prefers an authored location when mapping succeeds.
- [ ] Source locations flow through definition metadata, graph projection, and the session view to
      the relevant state or decision point.
- [ ] Built-in editor resolvers create VS Code and Cursor links, and a public resolver seam supports
      another editor or copyable reference.
- [ ] The embedded viewer can invoke the selected resolver and clearly omits navigation when no
      trustworthy location exists.
- [ ] Tests verify useful declaration-level locations without pinning assertions to exact test-file
      line numbers and cover common frame formats, filtering, absent stacks, malformed stacks,
      source-map success, and resolver output.

