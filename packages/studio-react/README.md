# `@effect-state-machine/studio-react`

Embed the interactive effect-state-machine Studio beside a running machine. The component connects directly in memory: it does not need the Studio CLI, a WebSocket server, or a stylesheet import.

## Install

```sh
pnpm add @effect-state-machine/studio-react
```

React, Effect, and `effect-state-machine` are peer dependencies.

## Render a machine

```tsx
import { Studio } from "@effect-state-machine/studio-react"

export function CheckoutDemo({ definition, handle }) {
  return (
    <Studio
      machine={{
        definition,
        handle,
        quickEvents: [
          { id: "submit", label: "Submit", event: { _tag: "Submit" } },
        ],
      }}
      defaultTheme="light"
      style={{ height: 640 }}
    />
  )
}
```

Do not import a CSS file. Studio installs its compiled styles inside its own shadow root, keeping both the host page and the embedded interface isolated.

The supplied machine handle must already be running. Studio owns only its observation attachment: unmounting the component does not stop or dispose the machine.

## Host integration

- Use `className` or `style` to size the shadow host. It defaults to full width and 640 pixels high.
- Use `theme`, `onThemeChange`, and `defaultTheme` for controlled or uncontrolled light/dark theming.
- Provide `onOpenSource` to open captured source locations in a playground editor. Without it, source links use the browser-safe copy action.
- Render one `Studio` per handle. Multiple components have independent connections, cursors, selections, and themes.
