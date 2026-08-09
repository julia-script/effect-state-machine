# Retry policies

An invoked state can attach an arbitrary native Effect `Schedule` as an operational retry
policy. Give the policy a stable name and, when useful, a description. The machine remains in
the invoked state while Effect evaluates attempts and delays. Static tooling shows only the
authored metadata because a native `Schedule` is executable policy rather than an inspectable
syntax tree. Runtime inspection reports the decisions the policy actually makes.

Use operational retry only when attempts do not change application behavior. If an attempt
count affects visible state, accepted events, or a later transition, represent it with ordinary
state variants and events. For example, an invocation may transition from `Saving` to
`WaitingToRetry { attempt }`; a `Retry` event can then return to `Saving`. That modeled form is
deliberately more explicit: both code and graph show that the application observes the retry.
