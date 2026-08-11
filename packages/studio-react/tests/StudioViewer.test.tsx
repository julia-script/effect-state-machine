// @vitest-environment jsdom

import { assert, describe, it } from "@effect/vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { StudioViewer } from "../src/StudioViewer.js"
import * as ViewerClient from "../src/state/ViewerClient.js"

describe("StudioViewer", () => {
  it("installs isolated styles and independent themes without a CSS import", async () => {
    const container = document.createElement("div")
    document.body.dataset.theme = "host-light"
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <>
          <StudioViewer className="first" viewerLayer={ViewerClient.layer()} theme="dark" />
          <StudioViewer className="second" viewerLayer={ViewerClient.layer()} theme="light" />
        </>,
      )
    })

    const first = container.querySelector<HTMLElement>(".first")
    const second = container.querySelector<HTMLElement>(".second")
    assert.ok(first?.shadowRoot !== null)
    assert.ok(second?.shadowRoot !== null)
    assert.strictEqual(first?.shadowRoot?.querySelectorAll("style[data-studio-styles]").length, 1)
    assert.strictEqual(second?.shadowRoot?.querySelectorAll("style[data-studio-styles]").length, 1)
    assert.strictEqual(
      first?.shadowRoot?.querySelector<HTMLElement>(".studio-surface")?.dataset.theme,
      "dark",
    )
    assert.strictEqual(
      second?.shadowRoot?.querySelector<HTMLElement>(".studio-surface")?.dataset.theme,
      "light",
    )
    assert.strictEqual(document.body.dataset.theme, "host-light")
    assert.strictEqual(document.head.querySelector("[data-studio-styles]"), null)

    await act(async () => root.unmount())
    container.remove()
  })
})
