// @vitest-environment jsdom

import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { Machine } from "effect-state-machine"
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Studio } from "../src/Studio.js"
import { definition, regionDefinition } from "./fixtures/Runner.js"

class ResizeObserverDouble {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverDouble
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const react = (run: () => void) => Effect.promise(() => act(async () => run()))

const findButton = (root: ShadowRoot, label: string): HTMLButtonElement | undefined =>
  [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)

const findEnabledButton = (root: ShadowRoot, label: string): HTMLButtonElement | undefined => {
  const button = findButton(root, label)
  return button?.disabled === false ? button : undefined
}

const assertStrongSurfaceContrast = (root: ShadowRoot) => {
  const mutedOnStrongSurface = root.querySelectorAll(
    ".bg-accent .text-muted, .bg-focus .text-muted, .bg-pear .text-muted, .bg-cyan .text-muted",
  )
  assert.strictEqual(mutedOnStrongSurface.length, 0)
}

const selectEvent = (root: ShadowRoot, tag: string) => {
  const select = root.querySelector<HTMLSelectElement>("details select")
  if (select === null) throw new Error("custom event selector was not rendered")
  select.value = tag
  select.dispatchEvent(new Event("change", { bubbles: true }))
}

const waitFor = <A,>(read: () => A | undefined): Effect.Effect<A> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const value = read()
      if (value !== undefined) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(new Error("embedded Studio did not become ready"))
  })

describe("Studio", () => {
  it.live("observes parallel region state and one atomic macrostep", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(regionDefinition, undefined)
        const container = document.createElement("div")
        document.body.append(container)
        const root = createRoot(container)

        yield* react(() =>
          root.render(
            <Studio
              machine={{
                definition: regionDefinition,
                handle,
                quickEvents: [{ id: "toggle", label: "Toggle", event: { _tag: "Toggle" } }],
              }}
            />,
          ),
        )
        const shadow = yield* waitFor(() => container.firstElementChild?.shadowRoot ?? undefined)
        yield* waitFor(() =>
          shadow.textContent?.includes('"playback"') === true &&
          shadow.textContent.includes('"Playing"') &&
          shadow.textContent.includes('"Audible"')
            ? true
            : undefined,
        )
        assertStrongSurfaceContrast(shadow)

        yield* handle.send({ _tag: "Toggle" })
        yield* waitFor(() =>
          shadow.textContent?.includes('"Paused"') === true &&
          shadow.textContent.includes('"Muted"')
            ? true
            : undefined,
        )
        assertStrongSurfaceContrast(shadow)
        assert.match(
          shadow.textContent ?? "",
          /Active\/playback\/Playing → Active\/playback\/Paused/,
        )
        assert.match(shadow.textContent ?? "", /Active\/volume\/Audible → Active\/volume\/Muted/)
        assert.deepStrictEqual(yield* handle.snapshot, {
          _tag: "Active",
          playback: { _tag: "Paused" },
          volume: { _tag: "Muted" },
        })

        yield* react(() => root.unmount())
        container.remove()
      }),
    ),
  )

  it.live("observes quick and custom dispatches and shows protocol rejections", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(definition, {})
        const container = document.createElement("div")
        document.body.append(container)
        const root = createRoot(container)

        yield* react(() =>
          root.render(
            <Studio
              machine={{
                definition,
                handle,
                quickEvents: [{ id: "start", label: "Start", event: { _tag: "Start", speed: 7 } }],
              }}
            />,
          ),
        )
        const shadow = yield* waitFor(() => container.firstElementChild?.shadowRoot ?? undefined)
        const start = yield* waitFor(() => findEnabledButton(shadow, "Start"))
        yield* react(() => start.click())
        yield* waitFor(() =>
          shadow.textContent?.includes('"speed": 7') === true ? true : undefined,
        )
        assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Running", speed: 7 })

        yield* react(() => selectEvent(shadow, "Start"))
        const dispatch = yield* waitFor(() => findButton(shadow, "Dispatch to actor:0"))
        yield* react(() => dispatch.click())
        yield* waitFor(() =>
          shadow.textContent?.includes("rejected:") === true ? true : undefined,
        )

        yield* react(() => selectEvent(shadow, "Stop"))
        yield* react(() => dispatch.click())
        assert.deepStrictEqual(yield* handle.completion, { _tag: "Done" })

        yield* react(() => root.unmount())
        container.remove()
      }),
    ),
  )

  it.live("releases only its attachment when unmounted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(definition, {})
        const container = document.createElement("div")
        const copied: Array<string> = []
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: (text: string) => Promise.resolve(copied.push(text)) },
        })
        document.body.append(container)
        const root = createRoot(container)

        yield* react(() =>
          root.render(
            <StrictMode>
              <Studio machine={{ definition, handle }} />
            </StrictMode>,
          ),
        )
        const shadow = yield* waitFor(() => container.firstElementChild?.shadowRoot ?? undefined)
        const source = yield* waitFor(() =>
          [...shadow.querySelectorAll("button")].find((button) =>
            button.title.includes("Runner.ts"),
          ),
        )
        yield* react(() => source.click())
        assert.strictEqual(copied.length, 1)
        assert.ok(copied[0]?.includes("Runner.ts"))
        yield* react(() => root.unmount())
        yield* handle.send({ _tag: "Start", speed: 3 })
        assert.deepStrictEqual(yield* handle.snapshot, { _tag: "Running", speed: 3 })
        yield* handle.send({ _tag: "Stop" })
        assert.deepStrictEqual(yield* handle.completion, { _tag: "Done" })
        container.remove()
      }),
    ),
  )

  it.live("passes source locations to the host and renders callback failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Machine.run(definition, {})
        const container = document.createElement("div")
        document.body.append(container)
        const root = createRoot(container)
        const opened: Array<{
          readonly file: string
          readonly line: number
          readonly column: number
        }> = []

        yield* react(() =>
          root.render(
            <Studio
              machine={{ definition, handle }}
              onOpenSource={(location) => {
                opened.push(location)
                throw new Error("host editor unavailable")
              }}
            />,
          ),
        )
        const shadow = yield* waitFor(() => container.firstElementChild?.shadowRoot ?? undefined)
        const source = yield* waitFor(() =>
          [...shadow.querySelectorAll("button")].find((button) =>
            button.title.includes("Runner.ts"),
          ),
        )
        yield* react(() => source.click())
        yield* waitFor(() =>
          shadow.textContent?.includes("Could not open source location.") === true
            ? true
            : undefined,
        )
        assert.strictEqual(opened.length, 1)
        assert.ok(opened[0]?.file.endsWith("Runner.ts"))

        yield* react(() => root.unmount())
        container.remove()
      }),
    ),
  )

  it.live("isolates simultaneous embeds and rebuilds for a replacement handle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstHandle = yield* Machine.run(definition, {})
        const secondHandle = yield* Machine.run(definition, {})
        const container = document.createElement("div")
        document.body.append(container)
        const root = createRoot(container)
        const machine = (handle: typeof firstHandle, speed: number, label: string) => ({
          definition,
          handle,
          quickEvents: [{ id: `start-${speed}`, label, event: { _tag: "Start" as const, speed } }],
        })

        yield* react(() =>
          root.render(
            <>
              <Studio
                className="first"
                machine={machine(firstHandle, 1, "Start first")}
                theme="dark"
              />
              <Studio
                className="second"
                machine={machine(secondHandle, 2, "Start second")}
                theme="light"
              />
            </>,
          ),
        )
        const firstShadow = yield* waitFor(
          () => container.querySelector<HTMLElement>(".first")?.shadowRoot ?? undefined,
        )
        const secondShadow = yield* waitFor(
          () => container.querySelector<HTMLElement>(".second")?.shadowRoot ?? undefined,
        )
        const firstStart = yield* waitFor(() => findEnabledButton(firstShadow, "Start first"))
        yield* react(() => firstStart.click())
        yield* waitFor(() =>
          firstShadow.textContent?.includes('"speed": 1') === true ? true : undefined,
        )
        assert.deepStrictEqual(yield* firstHandle.snapshot, { _tag: "Running", speed: 1 })
        assert.deepStrictEqual(yield* secondHandle.snapshot, { _tag: "Idle" })
        assert.strictEqual(
          firstShadow.querySelector<HTMLElement>(".studio-surface")?.dataset.theme,
          "dark",
        )
        assert.strictEqual(
          secondShadow.querySelector<HTMLElement>(".studio-surface")?.dataset.theme,
          "light",
        )

        yield* react(() =>
          root.render(
            <Studio
              className="replacement"
              machine={machine(secondHandle, 2, "Start replacement")}
            />,
          ),
        )
        const replacementShadow = yield* waitFor(
          () => container.querySelector<HTMLElement>(".replacement")?.shadowRoot ?? undefined,
        )
        yield* waitFor(() =>
          replacementShadow.textContent?.includes("STATEIdle") === true ? true : undefined,
        )
        const replacementStart = yield* waitFor(() =>
          findEnabledButton(replacementShadow, "Start replacement"),
        )
        yield* react(() => replacementStart.click())
        yield* waitFor(() =>
          replacementShadow.textContent?.includes('"speed": 2') === true ? true : undefined,
        )
        assert.deepStrictEqual(yield* secondHandle.snapshot, { _tag: "Running", speed: 2 })

        yield* react(() => root.unmount())
        yield* firstHandle.send({ _tag: "Stop" })
        yield* secondHandle.send({ _tag: "Stop" })
        container.remove()
      }),
    ),
  )
})
