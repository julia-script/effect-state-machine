import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as DevToolsSession from "./DevToolsSession.js"
import * as SourceLocation from "./SourceLocation.js"

export interface MountOptions<Details> {
  readonly session: DevToolsSession.Session<Details>
  readonly container: HTMLElement
  readonly hidden?: boolean
  readonly editorResolver?: SourceLocation.EditorResolver
  readonly editorLabel?: string
}

interface Camera {
  scale: number
  x: number
  y: number
}

const svgElement = <Name extends keyof SVGElementTagNameMap>(
  name: Name,
): SVGElementTagNameMap[Name] => document.createElementNS("http://www.w3.org/2000/svg", name)

const renderGraph = <Details>(
  view: DevToolsSession.SessionView<Details>,
  session: DevToolsSession.Session<Details>,
  camera: Camera,
): HTMLElement => {
  const section = document.createElement("section")
  section.setAttribute("aria-label", "Machine graph")
  const controls = document.createElement("nav")
  controls.setAttribute("aria-label", "Graph controls")
  for (const depth of [1, 2, "full"] as const) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = depth === "full" ? "Full" : `Depth ${depth}`
    button.disabled = view.focus.depth === depth
    button.addEventListener("click", () => {
      Effect.runFork(session.setFocusDepth(depth))
    })
    controls.append(button)
  }

  const svg = svgElement("svg")
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", `${view.machine.id} focused graph`)
  svg.setAttribute("viewBox", "0 0 1000 560")
  svg.style.width = "100%"
  svg.style.height = "min(56vh, 560px)"
  svg.style.touchAction = "none"
  const scene = svgElement("g")
  const applyCamera = () => {
    scene.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.scale})`)
  }
  applyCamera()

  const columns = Math.max(1, Math.ceil(Math.sqrt(view.graph.nodes.length)))
  const positions = new Map(
    view.graph.nodes.map((node, index) => [
      node.id,
      { x: 70 + (index % columns) * 220, y: 60 + Math.floor(index / columns) * 120 },
    ]),
  )
  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true
  for (const edge of view.focus.graph.edges) {
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (source === undefined || target === undefined) continue
    const traversed = view.focus.activity.traversedEdges.includes(edge.id)
    const path = svgElement("path")
    const self = edge.source === edge.target
    path.setAttribute(
      "d",
      self
        ? `M ${source.x + 70} ${source.y} C ${source.x + 135} ${source.y - 70}, ${source.x - 55} ${source.y - 70}, ${source.x} ${source.y}`
        : `M ${source.x + 70} ${source.y} L ${target.x} ${target.y}`,
    )
    path.setAttribute("fill", "none")
    path.setAttribute("stroke", traversed ? "var(--color-focus)" : "var(--color-muted)")
    path.setAttribute("stroke-width", traversed ? "4" : "2")
    path.setAttribute("marker-end", "url(#devtools-arrow)")
    if (traversed) {
      path.setAttribute("stroke-dasharray", "9 7")
      if (!reducedMotion) {
        const animate = svgElement("animate")
        animate.setAttribute("attributeName", "stroke-dashoffset")
        animate.setAttribute("from", "32")
        animate.setAttribute("to", "0")
        animate.setAttribute("dur", "1s")
        animate.setAttribute("repeatCount", "indefinite")
        path.append(animate)
      }
    }
    scene.append(path)
    const label = svgElement("text")
    label.textContent = edge.event?.tag ?? edge.outcome?.kind ?? ""
    label.setAttribute("x", String((source.x + target.x) / 2 + 35))
    label.setAttribute("y", String((source.y + target.y) / 2 - 8))
    label.setAttribute("font-size", "12")
    scene.append(label)
  }

  for (const node of view.focus.graph.nodes) {
    const point = positions.get(node.id)
    if (point === undefined) continue
    const group = svgElement("g")
    const rect = svgElement("rect")
    rect.setAttribute("x", String(point.x))
    rect.setAttribute("y", String(point.y - 28))
    rect.setAttribute("width", "150")
    rect.setAttribute("height", "56")
    rect.setAttribute("rx", "14")
    rect.setAttribute(
      "fill",
      view.focus.activity.activeNode === node.id ? "var(--color-pear)" : "var(--color-surface)",
    )
    rect.setAttribute("stroke", "var(--color-ink)")
    rect.setAttribute("stroke-width", view.focus.activity.activeNode === node.id ? "4" : "2")
    const label = svgElement("text")
    label.textContent = node.title
    label.setAttribute("x", String(point.x + 75))
    label.setAttribute("y", String(point.y + 5))
    label.setAttribute("text-anchor", "middle")
    label.setAttribute("font-size", "15")
    group.append(rect, label)
    scene.append(group)
  }

  const definitions = svgElement("defs")
  const marker = svgElement("marker")
  marker.id = "devtools-arrow"
  marker.setAttribute("viewBox", "0 0 10 10")
  marker.setAttribute("refX", "9")
  marker.setAttribute("refY", "5")
  marker.setAttribute("markerWidth", "7")
  marker.setAttribute("markerHeight", "7")
  marker.setAttribute("orient", "auto-start-reverse")
  const arrow = svgElement("path")
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z")
  arrow.setAttribute("fill", "var(--color-focus)")
  marker.append(arrow)
  definitions.append(marker)
  svg.append(definitions, scene)

  for (const [label, change] of [
    ["Zoom in", 1.2],
    ["Zoom out", 1 / 1.2],
  ] as const) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = label
    button.addEventListener("click", () => {
      camera.scale = Math.min(4, Math.max(0.25, camera.scale * change))
      applyCamera()
    })
    controls.append(button)
  }
  const fit = document.createElement("button")
  fit.type = "button"
  fit.textContent = "Fit"
  fit.addEventListener("click", () => {
    camera.scale = 1
    camera.x = 0
    camera.y = 0
    applyCamera()
  })
  controls.append(fit)

  let drag: { x: number; y: number } | undefined
  svg.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY }
    svg.setPointerCapture(event.pointerId)
  })
  svg.addEventListener("pointermove", (event) => {
    if (drag === undefined) return
    camera.x += event.clientX - drag.x
    camera.y += event.clientY - drag.y
    drag = { x: event.clientX, y: event.clientY }
    applyCamera()
  })
  svg.addEventListener("pointerup", () => {
    drag = undefined
  })
  svg.addEventListener("wheel", (event) => {
    event.preventDefault()
    camera.scale = Math.min(4, Math.max(0.25, camera.scale * (event.deltaY < 0 ? 1.1 : 0.9)))
    applyCamera()
  })

  section.append(controls, svg)
  return section
}

/** A deliberately small embedded viewer used to prove the renderer-independent session seam. */
export const mount = <Details>(
  options: MountOptions<Details>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const camera: Camera = { scale: 1, x: 0, y: 0 }
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
          const graph = renderGraph(view, options.session, camera)
          const machine = document.createElement("strong")
          machine.textContent = view.machine.id
          const state = document.createElement("span")
          state.textContent = ` ${view.selected.state.title}`
          state.dataset.stateTag = view.selected.state.tag
          const selectedNode = view.graph.nodes.find((node) => node.id === view.selected.state.tag)
          const source = selectedNode?.location
          const editorResolver = options.editorResolver ?? SourceLocation.cursor
          const editorUrl = source === undefined ? undefined : editorResolver(source)
          const sourceLink = document.createElement("a")
          if (source !== undefined && editorUrl !== undefined) {
            sourceLink.href = editorUrl
            sourceLink.textContent = options.editorLabel ?? "Open in Cursor"
            sourceLink.title = `${source.file}:${source.line}:${source.column}`
          }
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
          root.append(machine, state, sourceLink, navigation, graph, quickEvents, history, raw)
        }),
      ),
      Effect.forkScoped,
    )
  })
