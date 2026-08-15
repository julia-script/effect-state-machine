# @effect-state-machine/studio-client

Connects running [`effect-state-machine`](https://www.npmjs.com/package/effect-state-machine)
machines to [Studio](https://www.npmjs.com/package/@effect-state-machine/studio), the standalone
devtool.

## Install

```sh
pnpm add @effect-state-machine/studio-client
```

`effect` and `effect-state-machine` are peer dependencies.

## Attach a running machine

```ts
import { Attach, Transport, WebSocketTransport } from "@effect-state-machine/studio-client"
import { Effect } from "effect"
import { Machine } from "effect-state-machine"

const program = Effect.scoped(
  Effect.gen(function* () {
    const handle = yield* Machine.run(definition, input)
    yield* Attach.attach({
      definition,
      handle,
      quickEvents: [{ id: "save", label: "Save", event: { _tag: "Save" } }],
    })
    // …the application continues normally
  }),
).pipe(Effect.provideService(Transport.StudioTransport, WebSocketTransport.make()))
```

Attaching is scoped and observational: it never interrupts the machine, and it is inert when no
Studio is running — the client connects lazily, retries in the background, and buffers unsent facts
(bounded, oldest dropped with a truncation notice). One attachment represents the root machine and
every child machine it owns as a single ordered Studio session.

The transport is a swappable Effect service (`StudioTransport`): `WebSocketTransport` reaches a
local Studio server, and an in-memory pair ships for tests and embedded use.

For a runnable walkthrough see
[`examples/checkout-demo.ts`](https://github.com/julia-script/effect-state-machine/blob/main/packages/studio-client/examples/checkout-demo.ts).
