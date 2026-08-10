import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as DevToolsSession from "./DevToolsSession.js"
import type * as Graph from "./Graph.js"
import * as SourceLocation from "./SourceLocation.js"

export type Presentation = "inline" | "dock"
export type SourceAction = "cursor" | "vscode" | "copy"

export interface MountOptions<Details> {
  readonly session: DevToolsSession.Session<Details>
  readonly container: HTMLElement
  readonly hidden?: boolean
  readonly presentation?: Presentation
  readonly initiallyOpen?: boolean
  readonly connectionLabel?: string
  readonly sourceAction?: SourceAction
  readonly editorResolver?: SourceLocation.EditorResolver
  readonly editorLabel?: string
}

interface Camera {
  scale: number
  x: number
  y: number
}

interface Point {
  readonly x: number
  readonly y: number
}

interface GraphLayout {
  readonly positions: ReadonlyMap<string, Point>
  readonly viewBox: string
}

interface ViewerState {
  sourceAction: SourceAction | "custom"
  historyMode: "steps" | "events"
  graphOnly: boolean
  expanded: boolean
  open: boolean
}

const NODE_WIDTH = 144
const NODE_HEIGHT = 48

const button = (label: string, className?: string): HTMLButtonElement => {
  const control = document.createElement("button")
  control.type = "button"
  control.textContent = label
  if (className !== undefined) control.className = className
  return control
}

const svgElement = <Name extends keyof SVGElementTagNameMap>(
  name: Name,
): SVGElementTagNameMap[Name] => document.createElementNS("http://www.w3.org/2000/svg", name)

const fitViewBox = (points: ReadonlyArray<Point>, targetAspect = 1.7): string => {
  if (points.length === 0) return "0 0 1000 560"

  const horizontalPadding = 68
  const verticalPadding = 76
  let minX = Math.min(...points.map((point) => point.x)) - horizontalPadding
  const maxX = Math.max(...points.map((point) => point.x + NODE_WIDTH)) + horizontalPadding
  let minY = Math.min(...points.map((point) => point.y - NODE_HEIGHT / 2)) - verticalPadding
  const maxY = Math.max(...points.map((point) => point.y + NODE_HEIGHT / 2)) + verticalPadding
  let width = Math.max(360, maxX - minX)
  let height = Math.max(240, maxY - minY)

  if (width / height < targetAspect) {
    const expandedWidth = height * targetAspect
    minX -= (expandedWidth - width) / 2
    width = expandedWidth
  } else {
    const expandedHeight = width / targetAspect
    minY -= (expandedHeight - height) / 2
    height = expandedHeight
  }

  return `${minX} ${minY} ${width} ${height}`
}

const layoutGraph = <Details>(view: DevToolsSession.SessionView<Details>): GraphLayout => {
  const nodes = view.focus.graph.nodes
  const positions = new Map<string, Point>()

  if (view.focus.depth === "full") {
    const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    for (const [index, node] of nodes.entries()) {
      positions.set(node.id, {
        x: 64 + (index % columns) * 190,
        y: 64 + Math.floor(index / columns) * 84,
      })
    }
  } else {
    const outgoing = new Map<string, Array<string>>()
    for (const edge of view.focus.graph.edges) {
      if (edge.source === edge.target) continue
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    }

    const activeNode = view.focus.activity.activeNode ?? nodes[0]?.id
    const distances = new Map<string, number>(activeNode === undefined ? [] : [[activeNode, 0]])
    const queue = activeNode === undefined ? [] : [activeNode]
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const source = queue[cursor]
      if (source === undefined) continue
      const nextDistance = (distances.get(source) ?? 0) + 1
      for (const target of outgoing.get(source) ?? []) {
        if (distances.has(target)) continue
        distances.set(target, nextDistance)
        queue.push(target)
      }
    }

    const fallbackDistance = Math.max(0, ...distances.values()) + 1
    const layers = new Map<number, Array<(typeof nodes)[number]>>()
    for (const node of nodes) {
      const distance = distances.get(node.id) ?? fallbackDistance
      layers.set(distance, [...(layers.get(distance) ?? []), node])
    }
    const maxLayerSize = Math.max(1, ...[...layers.values()].map((layer) => layer.length))
    for (const [distance, layer] of [...layers.entries()].sort(([left], [right]) => left - right)) {
      const verticalOffset = ((maxLayerSize - layer.length) * 92) / 2
      for (const [index, node] of layer.entries()) {
        positions.set(node.id, {
          x: 64 + distance * 224,
          y: 64 + verticalOffset + index * 92,
        })
      }
    }
  }

  return { positions, viewBox: fitViewBox([...positions.values()]) }
}

const sourceResolver = (
  action: ViewerState["sourceAction"],
  options: MountOptions<unknown>,
): SourceLocation.EditorResolver | undefined => {
  if (action === "cursor") return SourceLocation.cursor
  if (action === "vscode") return SourceLocation.vscode
  if (action === "custom") return options.editorResolver
  return undefined
}

const sourceReference = (source: SourceLocation.Location): string =>
  `${source.file}:${source.line}:${source.column}`

const sourceControl = (
  source: SourceLocation.Location,
  label: string,
  action: ViewerState["sourceAction"],
  options: MountOptions<unknown>,
): HTMLElement => {
  if (action === "copy") {
    const control = button(label, "machine-devtools__source-link")
    control.title = `Copy ${sourceReference(source)}`
    control.addEventListener("click", () => {
      const reference = sourceReference(source)
      void navigator.clipboard?.writeText(reference).then(() => {
        control.textContent = "Copied"
        globalThis.setTimeout(() => {
          control.textContent = label
        }, 1200)
      })
    })
    return control
  }

  const resolver = sourceResolver(action, options)
  const href = resolver?.(source)
  if (href === undefined) {
    const unavailable = document.createElement("span")
    unavailable.className = "machine-devtools__source-unavailable"
    unavailable.textContent = "Source unavailable"
    return unavailable
  }
  const link = document.createElement("a")
  link.className = "machine-devtools__source-link"
  link.href = href
  link.textContent = label
  link.title = sourceReference(source)
  return link
}

const stepLocation = <Details>(
  view: DevToolsSession.SessionView<Details>,
  step: DevToolsSession.SemanticStep,
): SourceLocation.Location | undefined => {
  const edge = view.graph.edges.find(
    (candidate) =>
      candidate.source === step.sourceStateTag &&
      candidate.target === step.targetStateTag &&
      (step.eventTag === undefined || candidate.event?.tag === step.eventTag) &&
      (step.branch === undefined || candidate.branch?.index === step.branch.index),
  )
  if (edge?.location !== undefined) return edge.location
  const nodeTag = step.sourceStateTag ?? step.targetStateTag
  return view.graph.nodes.find((candidate) => candidate.id === nodeTag)?.location
}

const edgeLabel = (edge: Graph.Edge): string =>
  edge.event?.tag ?? edge.outcome?.kind ?? "transition"

const focusGraph = <Details>(
  view: DevToolsSession.SessionView<Details>,
  state: ViewerState,
  options: MountOptions<Details>,
): HTMLElement => {
  const canvas = document.createElement("div")
  canvas.className = "machine-devtools__focus-graph"
  const activeTag = view.focus.activity.activeNode ?? view.selected.state.tag
  const activeNode = view.graph.nodes.find((node) => node.id === activeTag)
  const current = document.createElement("article")
  current.className = "machine-devtools__focus-current"
  const eyebrow = document.createElement("span")
  eyebrow.textContent = view.isLive ? "Live state" : `History · ${view.cursor}/${view.liveHead}`
  const title = document.createElement("strong")
  title.textContent = activeNode?.title ?? activeTag
  current.append(eyebrow, title)
  if (activeNode?.description !== undefined) {
    const description = document.createElement("p")
    description.textContent = activeNode.description
    current.append(description)
  }
  if (activeNode?.location !== undefined) {
    current.append(sourceControl(activeNode.location, "Open state", state.sourceAction, options))
  }

  const routes = document.createElement("div")
  routes.className = "machine-devtools__focus-routes"
  const outgoing = view.graph.edges.filter((edge) => edge.source === activeTag)
  if (outgoing.length === 0) {
    const terminal = document.createElement("article")
    terminal.className = "machine-devtools__focus-target"
    terminal.innerHTML = "<span>final state</span><strong>No outgoing transitions</strong>"
    routes.append(terminal)
  }
  for (const edge of outgoing) {
    const target = view.graph.nodes.find((node) => node.id === edge.target)
    const route = document.createElement("article")
    route.className = "machine-devtools__focus-target"
    if (view.focus.activity.traversedEdges.includes(edge.id)) route.dataset.traversed = ""
    const event = document.createElement("span")
    event.textContent = `${edgeLabel(edge)} →`
    const targetTitle = document.createElement("strong")
    targetTitle.textContent = target?.title ?? edge.target
    route.append(event, targetTitle)
    if (edge.description !== undefined) {
      const description = document.createElement("p")
      description.textContent = edge.description
      route.append(description)
    }
    if (edge.location !== undefined) {
      route.append(sourceControl(edge.location, "Open decision", state.sourceAction, options))
    }
    routes.append(route)
  }
  canvas.append(current, routes)
  return canvas
}

interface EdgeRoute {
  readonly path: string
  readonly label: Point
}

const roundedOrthogonalPath = (input: ReadonlyArray<Point>, radius = 8): string => {
  const distinct = input.filter(
    (point, index) =>
      index === 0 || point.x !== input[index - 1]?.x || point.y !== input[index - 1]?.y,
  )
  const points = distinct.filter((point, index) => {
    const previous = distinct[index - 1]
    const next = distinct[index + 1]
    if (previous === undefined || next === undefined) return true
    return !(
      (previous.x === point.x && point.x === next.x) ||
      (previous.y === point.y && point.y === next.y)
    )
  })
  const first = points[0]
  if (first === undefined) return ""
  if (points.length === 1) return `M ${first.x} ${first.y}`

  const commands = [`M ${first.x} ${first.y}`]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const corner = points[index]
    const next = points[index + 1]
    if (previous === undefined || corner === undefined || next === undefined) continue
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    const cornerRadius = Math.min(radius, incoming / 2, outgoing / 2)
    const before = {
      x: corner.x + ((previous.x - corner.x) / incoming) * cornerRadius,
      y: corner.y + ((previous.y - corner.y) / incoming) * cornerRadius,
    }
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoing) * cornerRadius,
      y: corner.y + ((next.y - corner.y) / outgoing) * cornerRadius,
    }
    commands.push(`L ${before.x} ${before.y}`, `Q ${corner.x} ${corner.y} ${after.x} ${after.y}`)
  }
  const last = points.at(-1)
  if (last !== undefined) commands.push(`L ${last.x} ${last.y}`)
  return commands.join(" ")
}

const routedEdge = (source: Point, target: Point, index: number): EdgeRoute => {
  const sourceX = source.x + NODE_WIDTH
  const targetX = target.x
  if (source.x === target.x && source.y === target.y) {
    const start = { x: source.x + NODE_WIDTH * 0.72, y: source.y - NODE_HEIGHT / 2 }
    const end = { x: source.x + NODE_WIDTH * 0.28, y: source.y - NODE_HEIGHT / 2 }
    const loopY = source.y - NODE_HEIGHT / 2 - 38 - (index % 3) * 10
    return {
      path: roundedOrthogonalPath([start, { x: start.x, y: loopY }, { x: end.x, y: loopY }, end]),
      label: { x: source.x + NODE_WIDTH / 2, y: loopY - 8 },
    }
  }
  if (targetX > sourceX + 20) {
    const horizontalGap = targetX - sourceX
    if (source.y === target.y && horizontalGap > 96) {
      const lane = source.y + NODE_HEIGHT / 2 + 18 + (index % 3) * 8
      const exitX = sourceX + 24
      const entryX = targetX - 24
      return {
        path: roundedOrthogonalPath([
          { x: sourceX, y: source.y },
          { x: exitX, y: source.y },
          { x: exitX, y: lane },
          { x: entryX, y: lane },
          { x: entryX, y: target.y },
          { x: targetX, y: target.y },
        ]),
        label: { x: (exitX + entryX) / 2, y: lane - 8 },
      }
    }
    const middle = (sourceX + targetX) / 2 + ((index % 5) - 2) * 6
    return {
      path: roundedOrthogonalPath([
        { x: sourceX, y: source.y },
        { x: middle, y: source.y },
        { x: middle, y: target.y },
        { x: targetX, y: target.y },
      ]),
      label: { x: (sourceX + middle) / 2, y: source.y - 8 },
    }
  }
  const lane = Math.max(source.y, target.y) + 54 + (index % 7) * 12
  const exitX = sourceX + 36 + (index % 4) * 10
  const entryX = targetX - 36 - (index % 4) * 10
  return {
    path: roundedOrthogonalPath([
      { x: sourceX, y: source.y },
      { x: exitX, y: source.y },
      { x: exitX, y: lane },
      { x: entryX, y: lane },
      { x: entryX, y: target.y },
      { x: targetX, y: target.y },
    ]),
    label: { x: (exitX + entryX) / 2, y: lane - 8 },
  }
}

const svgGraph = <Details>(
  view: DevToolsSession.SessionView<Details>,
  camera: Camera,
  state: ViewerState,
  options: MountOptions<Details>,
): HTMLElement => {
  const shell = document.createElement("div")
  shell.className = "machine-devtools__graph-shell"
  const svg = svgElement("svg")
  svg.setAttribute("role", "img")
  svg.setAttribute(
    "aria-label",
    `${view.machine.id} ${view.focus.depth === "full" ? "full" : "nearby"} graph`,
  )
  const layout = layoutGraph(view)
  svg.setAttribute("viewBox", layout.viewBox)
  svg.classList.add("machine-devtools__graph")
  if (view.focus.depth === "full") svg.dataset.full = ""
  svg.style.touchAction = "none"

  const definitions = svgElement("defs")
  const marker = svgElement("marker")
  marker.id = "machine-devtools-arrow"
  marker.setAttribute("viewBox", "0 0 10 10")
  marker.setAttribute("refX", "8")
  marker.setAttribute("refY", "5")
  marker.setAttribute("markerWidth", "6")
  marker.setAttribute("markerHeight", "6")
  marker.setAttribute("orient", "auto-start-reverse")
  const arrow = svgElement("path")
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z")
  arrow.setAttribute("fill", "context-stroke")
  marker.append(arrow)
  definitions.append(marker)

  const scene = svgElement("g")
  scene.classList.add("machine-devtools__graph-scene")
  const applyCamera = () => {
    scene.setAttribute("transform", `translate(${camera.x} ${camera.y}) scale(${camera.scale})`)
  }
  applyCamera()

  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true
  const edgeElements = new Map<string, ReadonlyArray<SVGElement>>()
  for (const [index, edge] of view.focus.graph.edges.entries()) {
    const source = layout.positions.get(edge.source)
    const target = layout.positions.get(edge.target)
    if (source === undefined || target === undefined) continue
    const traversed = view.focus.activity.traversedEdges.includes(edge.id)
    const route = routedEdge(source, target, index)
    const path = svgElement("path")
    path.classList.add("machine-devtools__edge")
    if (traversed) path.classList.add("is-active")
    path.dataset.source = edge.source
    path.dataset.target = edge.target
    path.setAttribute("d", route.path)
    path.setAttribute("marker-end", "url(#machine-devtools-arrow)")
    if (traversed && !reducedMotion) {
      const animate = svgElement("animate")
      animate.setAttribute("attributeName", "stroke-dashoffset")
      animate.setAttribute("from", "32")
      animate.setAttribute("to", "0")
      animate.setAttribute("dur", "1s")
      animate.setAttribute("repeatCount", "indefinite")
      path.append(animate)
    }
    scene.append(path)

    const label = svgElement("text")
    label.classList.add("machine-devtools__edge-label")
    if (traversed) label.classList.add("is-active")
    label.dataset.source = edge.source
    label.dataset.target = edge.target
    label.textContent = edgeLabel(edge)
    label.setAttribute("x", String(route.label.x))
    label.setAttribute("y", String(route.label.y))
    label.setAttribute("text-anchor", "middle")
    scene.append(label)
    edgeElements.set(edge.id, [path, label])
  }

  const setHoveredNode = (nodeId: string | undefined) => {
    if (nodeId === undefined) delete scene.dataset.hovering
    else scene.dataset.hovering = ""
    for (const edge of view.focus.graph.edges) {
      const related = nodeId !== undefined && (edge.source === nodeId || edge.target === nodeId)
      for (const element of edgeElements.get(edge.id) ?? []) {
        element.classList.toggle("is-related", related)
      }
    }
  }

  for (const node of view.focus.graph.nodes) {
    const point = layout.positions.get(node.id)
    if (point === undefined) continue
    const group = svgElement("g")
    group.classList.add("machine-devtools__node")
    if (view.focus.activity.activeNode === node.id) group.classList.add("is-active")
    group.setAttribute("transform", `translate(${point.x} ${point.y - NODE_HEIGHT / 2})`)
    group.addEventListener("pointerenter", () => setHoveredNode(node.id))
    group.addEventListener("pointerleave", () => setHoveredNode(undefined))
    const rect = svgElement("rect")
    rect.setAttribute("width", String(NODE_WIDTH))
    rect.setAttribute("height", String(NODE_HEIGHT))
    rect.setAttribute("rx", "12")
    const label = svgElement("text")
    label.textContent = node.title
    label.setAttribute("x", String(NODE_WIDTH / 2))
    label.setAttribute("y", String(NODE_HEIGHT / 2 + 5))
    label.setAttribute("text-anchor", "middle")
    group.append(rect, label)
    if (node.location !== undefined && state.sourceAction !== "copy") {
      const resolver = sourceResolver(state.sourceAction, options)
      const href = resolver?.(node.location)
      if (href !== undefined) {
        const link = svgElement("a")
        link.setAttribute("href", href)
        link.setAttribute("aria-label", `Open source for ${node.title}`)
        link.append(group)
        scene.append(link)
        continue
      }
    }
    scene.append(group)
  }

  svg.append(definitions, scene)
  shell.append(svg)

  const zoom = document.createElement("nav")
  zoom.className = "machine-devtools__zoom"
  zoom.setAttribute("aria-label", "Map zoom")
  const zoomOut = button("−", "machine-devtools__icon-button")
  zoomOut.setAttribute("aria-label", "Zoom out")
  const level = document.createElement("output")
  level.textContent = `${Math.round(camera.scale * 100)}%`
  const zoomIn = button("+", "machine-devtools__icon-button")
  zoomIn.setAttribute("aria-label", "Zoom in")
  const fit = button("Fit")
  const setScale = (scale: number) => {
    camera.scale = Math.min(4, Math.max(0.25, scale))
    level.textContent = `${Math.round(camera.scale * 100)}%`
    applyCamera()
  }
  zoomOut.addEventListener("click", () => setScale(camera.scale / 1.2))
  zoomIn.addEventListener("click", () => setScale(camera.scale * 1.2))
  fit.addEventListener("click", () => {
    camera.x = 0
    camera.y = 0
    setScale(1)
  })
  zoom.append(zoomOut, level, zoomIn, fit)
  shell.append(zoom)

  let drag: { x: number; y: number; moved: boolean } | undefined
  svg.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false }
    svg.setPointerCapture(event.pointerId)
  })
  svg.addEventListener("pointermove", (event) => {
    if (drag === undefined) return
    const deltaX = event.clientX - drag.x
    const deltaY = event.clientY - drag.y
    drag.moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 2
    camera.x += deltaX / camera.scale
    camera.y += deltaY / camera.scale
    drag.x = event.clientX
    drag.y = event.clientY
    applyCamera()
  })
  svg.addEventListener("pointerup", () => {
    drag = undefined
  })
  svg.addEventListener("wheel", (event) => {
    event.preventDefault()
    setScale(camera.scale * (event.deltaY < 0 ? 1.1 : 0.9))
  })
  return shell
}

const graphPanel = <Details>(
  view: DevToolsSession.SessionView<Details>,
  session: DevToolsSession.Session<Details>,
  camera: Camera,
  state: ViewerState,
  options: MountOptions<Details>,
  rerender: () => void,
): HTMLElement => {
  const section = document.createElement("section")
  section.className = "machine-devtools__map-pane"
  section.setAttribute("aria-label", "Machine graph")
  const heading = document.createElement("header")
  heading.className = "machine-devtools__pane-head"
  const copy = document.createElement("div")
  const title = document.createElement("h2")
  title.textContent = "State map"
  const caption = document.createElement("p")
  caption.textContent = view.isLive
    ? `Live · ${view.selected.state.title}`
    : `History ${view.cursor}/${view.liveHead} · ${view.selected.state.title}`
  copy.append(title, caption)
  const controls = document.createElement("div")
  controls.className = "machine-devtools__map-actions"
  const depthControl = document.createElement("div")
  depthControl.className = "machine-devtools__segmented"
  depthControl.setAttribute("aria-label", "Graph detail")
  for (const [depth, label] of [
    [1, "Focus"],
    [2, "Nearby"],
    ["full", "Full map"],
  ] as const) {
    const control = button(label)
    control.setAttribute("aria-pressed", String(view.focus.depth === depth))
    control.addEventListener("click", () => Effect.runFork(session.setFocusDepth(depth)))
    depthControl.append(control)
  }
  const graphOnly = button(state.graphOnly ? "Show panels" : "Map only")
  graphOnly.addEventListener("click", () => {
    state.graphOnly = !state.graphOnly
    if (state.graphOnly) state.expanded = true
    rerender()
  })
  controls.append(depthControl, graphOnly)
  heading.append(copy, controls)
  const canvas =
    view.focus.depth === 1
      ? focusGraph(view, state, options)
      : svgGraph(view, camera, state, options)
  section.append(heading, canvas)
  return section
}

const quickEventPanel = <Details>(
  view: DevToolsSession.SessionView<Details>,
  session: DevToolsSession.Session<Details>,
): HTMLElement => {
  const section = document.createElement("section")
  section.className = "machine-devtools__quick-events"
  section.setAttribute("aria-label", "Quick events")
  const heading = document.createElement("h2")
  heading.textContent = "Quick events"
  section.append(heading)
  if (!view.isLive) {
    const notice = document.createElement("p")
    notice.className = "machine-devtools__notice"
    notice.textContent = "Inspecting history. Return live to dispatch."
    section.append(notice)
  }
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
      const dispatch = button(control.label)
      dispatch.title = control.description ?? ""
      dispatch.disabled = control.available === false || !view.isLive
      dispatch.addEventListener("click", () => {
        Effect.runFork(session.dispatchQuickEvent(control.id).pipe(Effect.ignore))
      })
      fieldset.append(dispatch)
    }
    section.append(fieldset)
  }
  if (view.controlFailure !== undefined) {
    const failure = document.createElement("p")
    failure.setAttribute("role", "alert")
    failure.textContent = `${view.controlFailure.quickEventId}: ${view.controlFailure.reason}`
    section.append(failure)
  }
  return section
}

const stepSummary = (step: DevToolsSession.SemanticStep): string => {
  const parts: Array<string> = [step.kind]
  if (step.sourceStateTag !== undefined || step.targetStateTag !== undefined) {
    parts.push(
      `${step.sourceStateTag ?? "∅"} → ${step.targetStateTag ?? step.sourceStateTag ?? "∅"}`,
    )
  }
  if (step.branch?.kind === "guard") parts.push(`guard: ${step.branch.name}`)
  else if (step.branch?.kind === "otherwise") parts.push("otherwise")
  if (step.status !== undefined) parts.push(step.status)
  if (step.attempt !== undefined) parts.push(`attempt ${step.attempt}`)
  if (step.delayMillis !== undefined) parts.push(`${step.delayMillis}ms`)
  parts.push(`${step.raw.length} record${step.raw.length === 1 ? "" : "s"}`)
  return parts.join(" · ")
}

const rawSummary = (record: DevToolsSession.RawInspectionRecord): string => {
  const values = Object.entries(record.event).flatMap(([key, value]) => {
    if (key === "_tag" || key === "machineId" || key === "defect") return []
    if (typeof value !== "string" && typeof value !== "number") return []
    return [`${key}=${value}`]
  })
  return values.length === 0 ? record.event._tag : `${record.event._tag} · ${values.join(" · ")}`
}

const historyPanel = <Details>(
  view: DevToolsSession.SessionView<Details>,
  session: DevToolsSession.Session<Details>,
  state: ViewerState,
  options: MountOptions<Details>,
  rerender: () => void,
): HTMLElement => {
  const section = document.createElement("section")
  section.className = "machine-devtools__history"
  section.setAttribute("aria-label", "Semantic history")
  const heading = document.createElement("header")
  heading.className = "machine-devtools__pane-head"
  const copy = document.createElement("div")
  const title = document.createElement("h2")
  title.textContent = "Semantic history"
  const caption = document.createElement("p")
  caption.textContent = `${view.history.raw.length} events → ${view.history.semantic.length} causal steps`
  copy.append(title, caption)
  const controls = document.createElement("div")
  controls.className = "machine-devtools__segmented"
  controls.setAttribute("aria-label", "History detail")
  for (const [mode, label] of [
    ["steps", "Steps"],
    ["events", "All events"],
  ] as const) {
    const control = button(label)
    control.setAttribute("aria-pressed", String(state.historyMode === mode))
    control.addEventListener("click", () => {
      state.historyMode = mode
      rerender()
    })
    controls.append(control)
  }
  heading.append(copy, controls)

  const list = document.createElement("ol")
  list.className = "machine-devtools__history-list"
  const activeStep = [...view.history.semantic]
    .reverse()
    .find((step) => (step.committedPosition ?? step.statePosition) === view.cursor)
  if (state.historyMode === "steps") {
    for (const step of view.history.semantic) {
      const item = document.createElement("li")
      item.className = "machine-devtools__history-entry"
      if (step.index === activeStep?.index) item.setAttribute("aria-current", "step")
      const select = button(String(step.index).padStart(2, "0"))
      select.className = "machine-devtools__history-select"
      select.setAttribute("aria-label", `Inspect ${step.title}`)
      const index = document.createElement("span")
      index.className = "machine-devtools__history-index"
      index.textContent = String(step.index).padStart(2, "0")
      const event = document.createElement("span")
      event.className = "machine-devtools__history-event"
      const strong = document.createElement("strong")
      strong.textContent = step.title
      const meta = document.createElement("span")
      meta.textContent = stepSummary(step)
      event.append(strong, meta)
      const target = document.createElement("span")
      target.className = "machine-devtools__history-state"
      target.textContent =
        step.targetStateTag ??
        step.sourceStateTag ??
        view.positions[step.statePosition]?.state.tag ??
        "—"
      select.replaceChildren(index, event, target)
      select.addEventListener("click", () => Effect.runFork(session.selectStep(step.index)))
      item.append(select)
      const location = stepLocation(view, step)
      if (location !== undefined) {
        item.append(sourceControl(location, "Code", state.sourceAction, options))
      }
      list.append(item)
    }
  } else {
    for (const record of view.history.raw) {
      const item = document.createElement("li")
      item.className = "machine-devtools__history-entry"
      const owner = view.history.semantic.find((step) => step.raw.includes(record.index))
      const select = button(String(record.index).padStart(2, "0"))
      select.className = "machine-devtools__history-select"
      const index = document.createElement("span")
      index.className = "machine-devtools__history-index"
      index.textContent = String(record.index).padStart(2, "0")
      const event = document.createElement("span")
      event.className = "machine-devtools__history-event"
      const strong = document.createElement("strong")
      strong.textContent = record.event._tag
      const meta = document.createElement("span")
      meta.textContent = rawSummary(record)
      event.append(strong, meta)
      select.replaceChildren(index, event)
      select.disabled = owner === undefined
      if (owner !== undefined) {
        select.addEventListener("click", () => Effect.runFork(session.selectStep(owner.index)))
      }
      item.append(select)
      list.append(item)
    }
  }

  const snapshot = document.createElement("details")
  snapshot.className = "machine-devtools__snapshot"
  const summary = document.createElement("summary")
  summary.textContent = "Selected tagged state"
  const pre = document.createElement("pre")
  pre.textContent = JSON.stringify(
    view.selected.state.details ?? { _tag: view.selected.state.tag },
    null,
    2,
  )
  snapshot.append(summary, pre)
  section.append(heading, list, snapshot)
  return section
}

const viewerHeader = <Details>(
  view: DevToolsSession.SessionView<Details>,
  session: DevToolsSession.Session<Details>,
  state: ViewerState,
  options: MountOptions<Details>,
  rerender: () => void,
): HTMLElement => {
  const header = document.createElement("header")
  header.className = "machine-devtools__header"
  const identity = document.createElement("div")
  identity.className = "machine-devtools__identity"
  const title = document.createElement("strong")
  title.textContent = view.machine.id
  const status = document.createElement("span")
  status.className = "machine-devtools__status"
  status.dataset.status = view.status
  status.textContent = options.connectionLabel ?? "browser · direct"
  const current = document.createElement("span")
  current.className = "machine-devtools__current-state"
  current.textContent = view.selected.state.title
  identity.append(title, status, current)

  const actions = document.createElement("div")
  actions.className = "machine-devtools__header-actions"
  const previous = button("←", "machine-devtools__icon-button")
  previous.setAttribute("aria-label", "Previous snapshot")
  previous.disabled = view.cursor === 0
  previous.addEventListener("click", () => Effect.runFork(session.previous))
  const position = document.createElement("span")
  position.className = "machine-devtools__position"
  position.textContent = `${view.cursor + 1}/${view.liveHead + 1}`
  const next = button("→", "machine-devtools__icon-button")
  next.setAttribute("aria-label", "Next snapshot")
  next.disabled = view.cursor === view.liveHead
  next.addEventListener("click", () => Effect.runFork(session.next))
  const live = button(view.isLive ? "Live" : `Return live +${view.liveHead - view.cursor}`)
  live.disabled = view.isLive
  live.addEventListener("click", () => Effect.runFork(session.returnToLive))

  const sourceAction = document.createElement("select")
  sourceAction.setAttribute("aria-label", "Source link action")
  const sourceActions: ReadonlyArray<readonly [ViewerState["sourceAction"], string]> = [
    ...(options.editorResolver === undefined
      ? []
      : ([["custom", options.editorLabel ?? "Open source"]] as const)),
    ["cursor", "Open in Cursor"],
    ["vscode", "Open in VS Code"],
    ["copy", "Copy file reference"],
  ]
  for (const [value, label] of sourceActions) {
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    option.selected = state.sourceAction === value
    sourceAction.append(option)
  }
  sourceAction.addEventListener("change", () => {
    state.sourceAction = sourceAction.value as ViewerState["sourceAction"]
    rerender()
  })

  const expand = button(state.expanded ? "↘" : "↗", "machine-devtools__icon-button")
  expand.setAttribute("aria-label", state.expanded ? "Dock devtools" : "Expand devtools")
  expand.title = state.expanded ? "Dock" : "Expand"
  expand.addEventListener("click", () => {
    state.expanded = !state.expanded
    if (!state.expanded) state.graphOnly = false
    rerender()
  })
  actions.append(previous, position, next, live, sourceAction, expand)
  if ((options.presentation ?? "inline") === "dock") {
    const close = button("×", "machine-devtools__icon-button")
    close.setAttribute("aria-label", "Close devtools")
    close.addEventListener("click", () => {
      state.open = false
      rerender()
    })
    actions.append(close)
  }
  header.append(identity, actions)
  return header
}

/** Mounts the compact browser viewer either inline or as a React Query-style dock. */
export const mount = <Details>(
  options: MountOptions<Details>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const camera: Camera = { scale: 1, x: 0, y: 0 }
    const presentation = options.presentation ?? "inline"
    const state: ViewerState = {
      sourceAction:
        options.editorResolver === undefined ? (options.sourceAction ?? "cursor") : "custom",
      historyMode: "steps",
      graphOnly: false,
      expanded: false,
      open: options.initiallyOpen ?? presentation === "inline",
    }
    const root = yield* Effect.sync(() => {
      const element = document.createElement("div")
      element.dataset.effectStateMachineDevtools = ""
      element.dataset.presentation = presentation
      element.hidden = options.hidden ?? false
      options.container.append(element)
      return element
    })

    yield* Effect.addFinalizer(() => Effect.sync(() => root.remove()))

    let currentView: DevToolsSession.SessionView<Details> | undefined
    const render = () => {
      if (currentView === undefined) return
      const view = currentView
      root.replaceChildren()
      root.dataset.open = String(state.open)
      root.dataset.expanded = String(state.expanded)
      root.dataset.graphOnly = String(state.graphOnly)

      if (presentation === "dock" && !state.open) {
        const launcher = button(`Inspect ${view.machine.id}`, "machine-devtools__launcher")
        const dot = document.createElement("span")
        dot.setAttribute("aria-hidden", "true")
        launcher.prepend(dot)
        launcher.addEventListener("click", () => {
          state.open = true
          render()
        })
        root.append(launcher)
        return
      }

      const panel = document.createElement("aside")
      panel.className = "machine-devtools__panel"
      panel.setAttribute("aria-label", `${view.machine.id} devtools`)
      const header = viewerHeader(view, options.session, state, options, render)
      const body = document.createElement("div")
      body.className = "machine-devtools__body"
      const graph = graphPanel(view, options.session, camera, state, options, render)
      const controls = document.createElement("aside")
      controls.className = "machine-devtools__controls-pane"
      controls.append(quickEventPanel(view, options.session))
      const history = historyPanel(view, options.session, state, options, render)
      body.append(graph, controls, history)
      panel.append(header, body)
      root.append(panel)
    }

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (state.graphOnly) state.graphOnly = false
      else if (state.expanded) state.expanded = false
      else if (presentation === "dock") state.open = false
      else return
      render()
    }
    yield* Effect.sync(() => document.addEventListener("keydown", onEscape))
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => document.removeEventListener("keydown", onEscape)),
    )

    yield* options.session.changes.pipe(
      Stream.runForEach((view) =>
        Effect.sync(() => {
          currentView = view
          render()
        }),
      ),
      Effect.forkScoped,
    )
  })
