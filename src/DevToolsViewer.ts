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
          const navigation = document.createElement("nav")
          navigation.setAttribute("aria-label", "History navigation")
          const previous = document.createElement("button")
          previous.type = "button"
          previous.textContent = "Previous"
          previous.disabled = view.cursor === 0
          previous.addEventListener("click", () => {
            Effect.runFork(options.session.previous)
          })
          const next = document.createElement("button")
          next.type = "button"
          next.textContent = "Next"
          next.disabled = view.cursor === view.liveHead
          next.addEventListener("click", () => {
            Effect.runFork(options.session.next)
          })
          const live = document.createElement("button")
          live.type = "button"
          live.textContent = view.isLive ? "Live" : `Return live (+${view.liveHead - view.cursor})`
          live.disabled = view.isLive
          live.addEventListener("click", () => {
            Effect.runFork(options.session.returnToLive)
          })
          navigation.append(previous, next, live)
          const quickEvents = document.createElement("section")
          quickEvents.setAttribute("aria-label", "Quick events")
          const groups = new Map<string, typeof view.quickEvents>()
          for (const quickEvent of view.quickEvents) {
            const group = quickEvent.group ?? "Events"
            groups.set(group, [...(groups.get(group) ?? []), quickEvent])
          }
          for (const [group, controls] of groups) {
            const fieldset = document.createElement("fieldset")
            const legend = document.createElement("legend")
            legend.textContent = group
            fieldset.append(legend)
            for (const control of controls) {
              const button = document.createElement("button")
              button.type = "button"
              button.textContent = control.label
              button.title = control.description ?? ""
              button.disabled = control.available === false
              button.addEventListener("click", () => {
                Effect.runFork(options.session.dispatchQuickEvent(control.id).pipe(Effect.ignore))
              })
              fieldset.append(button)
            }
            quickEvents.append(fieldset)
          }
          if (view.controlFailure !== undefined) {
            const failure = document.createElement("p")
            failure.setAttribute("role", "alert")
            failure.textContent = `${view.controlFailure.quickEventId}: ${view.controlFailure.reason}`
            quickEvents.append(failure)
          }
          const history = document.createElement("ol")
          history.setAttribute("aria-label", "Semantic history")
          for (const step of view.history.semantic.slice(-6)) {
            const item = document.createElement("li")
            item.dataset.stepKind = step.kind
            const select = document.createElement("button")
            select.type = "button"
            select.textContent = step.title
            select.addEventListener("click", () => {
              Effect.runFork(options.session.selectStep(step.index))
            })
            item.append(select)
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
          root.append(machine, state, navigation, quickEvents, history, raw)
        }),
      ),
      Effect.forkScoped,
    )
  })
