import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as DevToolsSession from "./DevToolsSession.js"

export interface MountOptions<Details> {
  readonly session: DevToolsSession.Session<Details>
  readonly container: HTMLElement
  readonly hidden?: boolean
}

/** A deliberately small embedded viewer used to prove the renderer-independent session seam. */
export const mount = <Details>(
  options: MountOptions<Details>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const root = yield* Effect.sync(() => {
      const element = document.createElement("section")
      element.dataset.effectStateMachineDevtools = ""
      element.hidden = options.hidden ?? false
      element.setAttribute("aria-live", "polite")
      options.container.append(element)
      return element
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        root.remove()
      }),
    )

    yield* options.session.changes.pipe(
      Stream.runForEach((view) =>
        Effect.sync(() => {
          root.replaceChildren()
          const machine = document.createElement("strong")
          machine.textContent = view.machine.id
          const state = document.createElement("span")
          state.textContent = ` ${view.selected.state.title}`
          state.dataset.stateTag = view.selected.state.tag
          const history = document.createElement("ol")
          history.setAttribute("aria-label", "Semantic history")
          for (const step of view.history.semantic.slice(-6)) {
            const item = document.createElement("li")
            item.textContent = step.title
            item.dataset.stepKind = step.kind
            history.append(item)
          }
          const raw = document.createElement("details")
          const summary = document.createElement("summary")
          summary.textContent = `${view.history.raw.length} raw records`
          const rawList = document.createElement("ol")
          for (const record of view.history.raw) {
            const item = document.createElement("li")
            item.textContent = record.event._tag
            rawList.append(item)
          }
          raw.append(summary, rawList)
          root.append(machine, state, history, raw)
        }),
      ),
      Effect.forkScoped,
    )
  })
