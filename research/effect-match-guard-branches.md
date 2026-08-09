# Effect Match as inspiration for guarded transition branches

Research snapshot: **2026-08-09**. The target is the repository's installed `effect@4.0.0-beta.106`; source links are pinned to the exact Effect release commit (`fb75264`). Only the installed package source/types and the official Effect repository were used.

## Conclusion

Effect `Match` is a strong **API-design reference** for guarded transitions, but it should not be the machine definition representation.

The useful ideas are ordered first-match-wins cases, narrowed branch inputs, explicit fallback/exhaustive finalizers, `_tag`/arbitrary-discriminator conveniences, and separate OR/AND combinators. However, a `TypeMatcher` retains only an ordered array of `{ _tag, guard, evaluate }` cases. The original literal/object pattern, discriminator field and values, and any human name or description have already been compiled into opaque functions. A completed matcher is reduced to an ordinary function, and a `ValueMatcher` evaluates eagerly without retaining a public case list. That is insufficient for honest static graph tooling. [`TypeMatcher`, `ValueMatcher`, and `Case`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L56-L166), [runtime representations](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L12-L104)

The state-machine DSL should therefore own first-class, named branch records and may borrow Match's *shape*:

```ts
on("Submit").choose(
  when(canSubmit, "Submitting"),
  when(isDraftEmpty, "Rejected"),
  otherwise("Invalid")
)
```

Each `when` must retain a stable name/description, predicate, target, and reducer as separate fields. Runtime evaluation can follow Match semantics; graph tooling reads the retained metadata rather than reverse-engineering functions.

## Ordered-case semantics

`Match.type<A>()` appends cases immutably in declaration order. Final evaluation loops from index zero and returns immediately on the first matching case. `Match.any` is documented as normally belonging last for that reason. [`TypeMatcher.add`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L12-L38), [`result` evaluation loop](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L551-L583), [`Match.any`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1480-L1496)

`Match.value(value)` has the same first-match-wins behavior but performs it while cases are added: once its internal `Result` is successful, later cases are ignored. This eager value form is not relevant as a static machine-definition primitive. [`ValueMatcher.add`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L40-L86)

**Borrow:** guarded alternatives should be an explicitly ordered readonly list, evaluated first-match-wins. Order should remain visible in both definition metadata and graph output. This matches the decision already made for the machine and avoids pretending overlapping predicates are commutative.

## Exhaustiveness and fallback APIs

Match has several distinct completion choices:

- `exhaustive` is accepted only when its type-level `Remaining` has reached `never`; it then returns the result/function and still throws an “absurd” error if an unsafe cast allows an unmatched runtime value through. [`Match.exhaustive` signature](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L2089-L2116), [`exhaustive` runtime](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L604-L632)
- `orElse` supplies an explicit catch-all handler and receives the remaining input type, not the original full input type. [`Match.orElse`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1907-L1943)
- `result` and `option` preserve non-match as data instead of inventing a fallback; `orElseAbsurd` throws without requiring compile-time exhaustiveness. [`result` and `option`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1991-L2081), [`orElseAbsurd`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1945-L1990)
- `discriminatorsExhaustive(field)` and `tagsExhaustive` require a handler for every discriminant member and finalize immediately. Their mapped type also rejects keys outside the union. [`discriminatorsExhaustive`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L973-L1030), [`tagsExhaustive`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1193-L1245)

**Borrow:** distinguish structural exhaustiveness from predicate fallback. The machine can prove that all schema-declared event tags/states are represented, but arbitrary boolean guards are not a statically enumerable partition. A guarded event should therefore either end in an explicit `otherwise` branch or define no-match as the already-decided protocol defect. Calling such arbitrary predicates “exhaustive” would overstate what TypeScript can prove.

## Predicate, pattern, and discriminator ergonomics

`when` accepts literal values, predicates/refinements, arrays, and recursively partial object patterns. Runtime compilation turns all of them into one predicate function: functions are used directly, arrays match element-wise, objects match their declared own keys recursively, and primitives use equality. [`when` API](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L620-L681), [`makePredicate`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L106-L154)

`whenOr` combines several patterns into one branch, while `whenAnd` requires all patterns and narrows the callback to their intersection. `not` provides the inverse case. [`whenOr` and `whenAnd`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L683-L795), [`not`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1250-L1296)

For discriminated unions, `discriminator(field)(...values, handler)` narrows the handler with `Extract`; `discriminators(field)({...})` adds several tag handlers from a typed map. `tag`, `tags`, and their exhaustive forms specialize those APIs to Effect's conventional `_tag` field. [`discriminator`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L797-L851), [`discriminators`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L905-L971), [`tag` and `tags`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L1032-L1191)

**Borrow selectively:**

- `when(namedGuard, transition)` and `otherwise(transition)` are the essential guarded-event API.
- `whenOr` / `whenAnd` are useful later if the operands are named guard values whose metadata is retained; an arbitrary nested object pattern is harder to explain in a graph.
- `_tag` conveniences fit schema-first state/events particularly well. A tagged event dispatch API can narrow payloads without representing that tag check as an opaque guard.
- Avoid a universal structural-pattern language in v0 unless an executable reference case needs it. The machine already gets structural vocabulary from `Schema.TaggedUnion`; duplicating Match's pattern compiler would add another data language and complicate visualization.

## Type inference worth emulating

Match carries the original input, accumulated filters, remaining input, result union, and optional fixed return type as phantom type parameters. Each positive case narrows its callback with `WhenMatch`, subtracts what can safely be excluded from the remaining union, and unions the branch result with prior results. [`Matcher` model](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L23-L100), [`when` type transformation](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L664-L681), [filter utilities](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L2423-L2556)

The practical consequences to emulate are:

- A branch on event tag `"Submit"` receives only the `Submit` event payload.
- Later branches see the remaining union when earlier patterns are safely subtractable.
- A fallback receives the remaining type.
- Branch reducers' return states contribute to the definition's inferred state union/target constraints.
- An optional `withReturnType`-like constraint can require every branch to produce the transition representation expected by that event. [`withReturnType`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L574-L613)

A plain boolean predicate does not describe a provable finite subset as well as a literal/tag pattern or type refinement. The machine DSL should still narrow from the event tag first, then pass the state/event pair to a named boolean guard; it should not attempt to claim that several arbitrary guards exhaust all possible runtime data.

## Why Match is not a graphable definition representation

There is a supported public surface for inspecting a *building* `TypeMatcher`: its `cases` property is public, and `Case` is a public `When | Not` union. But each case exposes only `_tag`, `guard`, and `evaluate`. The concrete authored pattern is discarded by `makePredicate`; discriminator helpers likewise close over their field/value data and store only the resulting predicate. [`public case model`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L89-L166), [`case construction`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L88-L154), [`discriminator compilation`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L323-L380)

That means tooling can observe case **order** and positive/negative kind, but cannot supportably recover:

- the guard's authored name or description;
- literal/object pattern data;
- a discriminator field, selected tag values, or OR/AND composition;
- transition targets or reducers;
- a stable serializable identity for a predicate.

Completion also erases even that limited structure: `result` closes over the cases in a plain function, `orElse` wraps that function, and `exhaustive` returns a result/function. `ValueMatcher` exposes its provided value and current `Result`, not `cases`. [`completion implementation`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/matcher.ts#L524-L632), [`ValueMatcher` public interface](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Match.ts#L102-L144)

Therefore a machine definition built *as* a Match value would either lose its static graph or depend on unsupported function introspection. Wrapping Match cases with parallel metadata would create two sources of ordering/topology. A small native branch record is both simpler and more honest.

## Recommendation

1. Keep the decided ordered, first-match-wins semantics.
2. Use first-class `when` and `otherwise` branch records owned by the machine library; require every opaque guard to be named and optionally described next to its predicate.
3. Narrow the event payload by schema `_tag` before guard evaluation. Borrow `tag`/`discriminator` ergonomics only where the discriminant remains explicit metadata.
4. Treat a final unguarded branch as fallback. Without it, no matching guard is a protocol defect; do not label arbitrary boolean branches compile-time exhaustive.
5. Consider `and`/`or` combinators only for named guard values so graph labels and descriptions remain available.
6. Preserve branch order, names, descriptions, targets, and reducer identity in the renderer-independent graph model.
7. Do not import `Match` as the definition representation. It can remain useful inside user-authored pure guard implementations, where its opacity is appropriately contained.

The design lesson is not “reimplement Effect Match.” It is to borrow its disciplined case-selection ergonomics while retaining the semantic metadata a state-machine library uniquely needs.
