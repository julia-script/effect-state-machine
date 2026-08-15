# @effect-state-machine/studio

Studio — the standalone devtool for
[`effect-state-machine`](https://www.npmjs.com/package/effect-state-machine). A local server plus a
browser interface that any number of applications — browser or Node — connect to over WebSocket.

## Run

```sh
npx @effect-state-machine/studio        # serves http://127.0.0.1:4747
```

Then attach a running machine from your application with
[`@effect-state-machine/studio-client`](https://www.npmjs.com/package/@effect-state-machine/studio-client).

## What you get

The interface shows the behavior map with depth-limited focus and traversed-edge emphasis, the
current actor state as JSON with an actor-local line diff, node and event detail cards with their
JSON Schemas and source links (opened in your editor by the local server, `--editor` to configure),
grouped quick events, a custom-event editor, and a semantic history with local time travel — the
cursor is per-viewer state and never touches the wire or the machine.

Multiple root machines appear as sessions in the top bar; descendants stay in their root session,
and disconnected sessions keep their history inspectable.

To embed the same interface inside a React app without the CLI, use
[`@effect-state-machine/studio-react`](https://www.npmjs.com/package/@effect-state-machine/studio-react).
