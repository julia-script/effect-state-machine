# 06 — Jump automatically from behavior to source code

**What to build:** Automatically associate authored machine elements with trustworthy declaration
locations and let a developer open those locations without maintaining file paths or line numbers.

**Blocked by:** 01 — Attach a live devtools session to a real machine

**Status:** resolved

- [x] Machine construction captures lazy caller information for state, invoked Effect, child, final,
      and named guard builder operations without importing Effect internals.
- [x] Machine authors provide no file paths, line numbers, or manually maintained source-location
      metadata.
- [x] Ordinary transitions and inline reducers without their own construction helper fall back to
      the owning node declaration instead of claiming exact statement precision.
- [x] Captured source references remain opaque to machine execution and do not alter transition
      semantics or Effect requirements.
- [x] Devtools normalization parses common browser and Node stack-frame forms and removes frames
      belonging to the state-machine library itself.
- [x] Missing, malformed, generated-only, or otherwise untrustworthy locations produce no source
      link rather than an incorrect one.
- [x] An optional development resolver can map generated locations through available source maps and
      prefers an authored location when mapping succeeds.
- [x] Source locations flow through definition metadata, graph projection, and the session view to
      the relevant state or decision point.
- [x] Built-in editor resolvers create VS Code and Cursor links, and a public resolver seam supports
      another editor or copyable reference.
- [x] The embedded viewer can invoke the selected resolver and clearly omits navigation when no
      trustworthy location exists.
- [x] Tests verify useful declaration-level locations without pinning assertions to exact test-file
      line numbers and cover common frame formats, filtering, absent stacks, malformed stacks,
      source-map success, and resolver output.

## Answer

Machine node helpers and the named-guard helper now capture an opaque lazy stack reference at
construction time. Devtools parses common Node and browser frames, filters library/internal frames,
optionally maps the generated location, and omits unresolvable references. Graph nodes carry the
resolved declaration location; transitions and inline reducers fall back to their owning node while
helper-authored guards may supply a more precise decision location. Sessions preserve this graph
metadata, and the embedded viewer exposes Cursor by default with built-in Cursor, VS Code, and custom
resolver seams. Tests assert useful files but deliberately avoid brittle exact line numbers.
