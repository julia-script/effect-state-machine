// @vitest-environment jsdom

import { assert, describe, it } from "@effect/vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { JsonTree } from "../src/components/JsonTree.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const board = (changed = false): ReadonlyArray<ReadonlyArray<number>> =>
  Array.from({ length: 20 }, (_, row) =>
    Array.from({ length: 10 }, (_, column) => (changed && row === 0 && column === 0 ? 1 : 0)),
  )

describe("JsonTree", () => {
  it("collapses long arrays, compacts numeric rows, and retains expansion across updates", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const before = { _tag: "Falling", board: board(), score: 1 }

    await act(async () => root.render(<JsonTree value={before} />))

    const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand board"]')
    assert.ok(expand !== null)
    assert.match(expand.textContent ?? "", /20 items/)
    assert.strictEqual(/\[0,0,0,0,0,0,0,0,0,0\]/.test(container.textContent ?? ""), false)

    await act(async () => expand.click())
    assert.ok(container.querySelector('[aria-label="Collapse board"]') !== null)
    assert.match(container.textContent ?? "", /\[0,0,0,0,0,0,0,0,0,0\]/)

    const after = { _tag: "Falling", board: board(true), score: 2 }
    await act(async () => root.render(<JsonTree value={after} previous={before} diff />))

    assert.ok(container.querySelector('[aria-label="Collapse board"]') !== null)
    assert.strictEqual(
      container.querySelector('[data-json-path="$/score"]')?.getAttribute("data-diff"),
      "changed",
    )
    assert.strictEqual(
      container.querySelector('[data-json-path="$/board/0"]')?.getAttribute("data-diff"),
      "changed",
    )

    await act(async () => root.unmount())
    container.remove()
  })

  it("renders added and removed object keys in structured diff mode", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <JsonTree value={{ kept: true, added: 2 }} previous={{ kept: true, removed: 1 }} diff />,
      ),
    )

    assert.strictEqual(
      container.querySelector('[data-json-path="$/added"]')?.getAttribute("data-diff"),
      "added",
    )
    assert.strictEqual(
      container.querySelector('[data-json-path="$/removed"]')?.getAttribute("data-diff"),
      "removed",
    )

    await act(async () => root.unmount())
  })
})
