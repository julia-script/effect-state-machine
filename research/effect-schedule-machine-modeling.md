# Effect Schedule capabilities for state-machine modeling

Research snapshot: **2026-08-09**. The target is the repository's pinned `effect@4.0.0-beta.106`; source links are pinned to the exact Effect commit behind that release (`fb75264`).

## Conclusion

Effect's `Schedule` is a strong execution primitive for retries inside a state-machine interpreter, and Effect 4 exposes enough metadata to inspect attempts while they run. It is **not** a declarative structure that devtools can reverse into a faithful static graph. At runtime, a schedule is essentially an Effect that allocates a stateful step function; the public model retains no constructor/combinator AST, label, or description. [Schedule model and representation](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L53-L55), [constructor representation](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L186-L195), [`fromStep`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L250-L260)

This supports a useful distinction:

- A machine can accept any native `Schedule` and execute it without giving up Effect's typed errors, requirements, cancellation, or test clock.
- A graph can honestly show that a transition is retried and display an authored name/description.
- Exact visualization of arbitrary schedule internals would require a separate declarative description (or a restricted descriptor algebra compiled to `Schedule`); it cannot be recovered from the native value.

## What a Schedule is

`Schedule<Output, Input, Error, Env>` captures four relevant types: the value produced by each decision, the input used to make decisions, failures raised by the schedule itself, and its service requirements. For `Effect.retry`, the failing Effect's typed error becomes the schedule input, and the returned Effect includes both the schedule's error and environment types. [`Schedule` type parameters](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L53-L55), [`Effect.retry` contract](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Effect.ts#L7102-L7123)

The operational representation is:

```ts
(now: number, input: Input) =>
  Pull<[Output, Duration], ScheduleError, FinalOutput, Env>
```

Each step either produces an output and delay, fails, or finishes with a final output. `Schedule.toStep` exposes this directly, while `toStepWithMetadata` reads `Clock`, executes the step, sleeps for the selected delay, and then returns metadata. [`fromStep` signature](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L250-L260), [`toStep`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L344-L354), [`toStepWithMetadata`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L356-L405)

Because `fromStep` accepts arbitrary Effectful code and stores only that executable step, two schedules with identical behavior can have unrelated source shapes, and a custom schedule may depend on services, input values, time, randomness, private mutable state, or effects. Static devtools cannot discover those semantics from the `Schedule` object.

## Attempts, outputs, delays, and observation

Effect 4's schedule metadata contains:

```ts
interface Metadata<Output, Input> {
  input: Input
  output: Output
  duration: Duration
  attempt: number
  start: number
  now: number
  elapsed: number
  elapsedSincePrevious: number
}
```

[`InputMetadata` and `Metadata`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L57-L81)

There are several distinct observation points:

1. **Inside the retried Effect:** `Schedule.CurrentMetadata` is provided to each evaluation. The initial evaluation sees the default metadata with `attempt: 0`; after a failure, the retry driver steps and sleeps the schedule, then supplies the new metadata to the next evaluation. Therefore the human-facing evaluation number is normally `CurrentMetadata.attempt + 1`. [`CurrentMetadata`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L83-L107), [retry loop](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/schedule.ts#L51-L80)
2. **At every schedule decision:** `Schedule.tap` receives the full metadata without changing the schedule's output; this can publish attempt/delay telemetry. `Schedule.map`, `modifyDelay`, and filtering callbacks also receive metadata, although they change policy behavior. [`Schedule.tap`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1554-L1658), [`Schedule.map`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1198-L1305)
3. **When driving the policy manually:** `toStep` exposes the chosen output and delay before sleeping; `toStepWithMetadata` performs the sleep and returns metadata afterward. The former is the useful seam if an interpreter needs to emit an explicit “waiting to retry” observation before time passes. [`toStep` and `toStepWithMetadata`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L318-L405)
4. **At exhaustion:** `Effect.retryOrElse` receives the last typed error and the schedule's final output. That output is generic—not necessarily a retry count. For example, `recurs` outputs counts, while exponential schedules output durations. [`retryOrElse` type](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Effect.ts#L7530-L7587), [retry implementation](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/schedule.ts#L66-L79), [exponential output](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1069-L1100), [`recurs` output and bound](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1477-L1518)

Attempt terminology needs care: the source Effect is evaluated once before the Schedule is stepped. `Schedule.recurs(3)` means up to three **retries**, hence up to four total evaluations. Effect explicitly does not retry defects or interruptions. [`Effect.retry` gotchas](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Effect.ts#L7117-L7123), [`Schedule.recurs` semantics](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1477-L1518)

## Composition is expressive but erased

The beta provides meaningful policy composition:

- `concat` runs one schedule to completion and then another; `concatResult` preserves which phase produced an output. [`concat` / `concatResult`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L532-L672)
- `max([...])` continues only while every schedule continues and selects the longest delay. [`max`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L804-L855)
- `min([...])` continues while at least one schedule continues and selects the shortest delay. [`min`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1002-L1055)
- `upTo` bounds a schedule by number of outputs, elapsed duration, or both. [`upTo`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1660-L1785)
- `map`, `modifyDelay`, `addDelay`, `while`, and `tap` may themselves run Effects and consequently add typed failures and service requirements. `jittered` adds runtime randomness. [`map`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1198-L1305), [`modifyDelay` and `jittered`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L1318-L1452)

All of these combinators compile back into `fromStep`. Their composition tree is not retained. Even “simulating” a schedule for visualization is not generally safe or complete: it may execute user effects, require unavailable services or realistic error inputs, consult clock/randomness, run forever, or choose behavior dynamically. Simulation can produce an example trace, not a faithful static description.

## Cancellation and deterministic tests

Schedule delays use the active Effect `Clock`. `toStepWithMetadata` reads that Clock and sleeps through it, so retry timing follows normal fiber cancellation and service substitution. The live Clock implements sleep with a cancellable callback whose interruption cleanup clears its timer. [`toStepWithMetadata`](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/Schedule.ts#L377-L405), [live Clock sleep](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/internal/effect.ts#L5986-L6017)

Consequently, if an invoked machine operation owns the retry fiber, leaving/cancelling that operation can interrupt both the current attempt and an in-progress retry delay; interruption is not converted into another retry.

`TestClock.layer()` replaces real time for sleeps, schedules, retries, and timeouts. Tests fork the effect, advance time with `TestClock.adjust` or `setTime`, then observe/join the fiber. This makes retry-state tests deterministic and fast without adding a custom clock abstraction to the machine. [`TestClock` overview and testing pattern](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/testing/TestClock.ts#L1-L88), [`adjust` / `setTime` implementation](https://github.com/Effect-TS/effect/blob/fb75264aa78a17a12c5e69adb139fccc421acae0/packages/effect/src/testing/TestClock.ts#L327-L373)

## Viable integration shapes to investigate

These are capability shapes, not a proposed final API:

### 1. Opaque native Schedule

The machine accepts a native `Schedule` and delegates retrying to `Effect.retry`. Devtools display an authored name/description such as “exponential backoff, at most three retries.” This retains full Schedule compatibility and minimal interpreter code, but retry progress is not a separate machine state unless instrumented.

### 2. Opaque Schedule plus runtime inspection

Wrap the schedule with `Schedule.tap`, and/or read `Schedule.CurrentMetadata` inside the attempted Effect, to publish retry decisions, selected delays, elapsed time, and evaluation count to an inspection stream. The static graph remains summarized; a live inspector can show the actual trace.

### 3. Interpreter-driven Schedule

Use `Schedule.toStep` directly. After a typed operation failure, the interpreter asks the Schedule for its next output and delay, emits an observable retry/wait phase, sleeps via Effect, and evaluates again. This exposes precise runtime phases and still supports arbitrary schedules, their typed errors, and their dependencies. It also means the machine owns a retry loop that `Effect.retry` otherwise already supplies.

### 4. Declarative descriptor compiled to Schedule

Define a restricted, inspectable retry description and compile it to a native `Schedule`. Devtools can faithfully render the supported descriptor while an escape hatch accepts an opaque native Schedule with a required label/description. This trades direct access to the entire Schedule algebra for exact static visualization.

## Implication for the design discussion

The user's proposed middle ground is technically sound: the machine can know **that** an invoked Effect has a retry policy, infer the policy's errors and dependencies, and observe actual attempt metadata. For an arbitrary native Schedule, the graph should treat its detailed policy like a guard: show a stable authored name/description and link the developer back to code, rather than claiming to reconstruct behavior that Effect deliberately represents as executable logic.
