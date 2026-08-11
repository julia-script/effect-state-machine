// @vitest-environment node

import { assert, describe, it } from "@effect/vitest"
import { renderToString } from "react-dom/server"
import { StudioViewer, ViewerClient } from "../src/index.js"

describe("studio-react import", () => {
  it("is inert during server rendering", () => {
    const html = renderToString(<StudioViewer viewerLayer={ViewerClient.layer()} />)
    assert.ok(html.includes("data-effect-state-machine-studio"))
    assert.ok(!html.includes("studio-surface"))
  })
})
