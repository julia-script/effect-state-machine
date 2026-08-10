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
          root.append(machine, state)
        }),
      ),
      Effect.forkScoped,
    )
  })
