import { useAtom, useAtomValue } from "@effect/atom-react"
import type { Graph } from "effect-state-machine/devtools"
import * as React from "react"
import { focus, layout, NODE_HEIGHT, NODE_WIDTH, toJson } from "../lib/layout.js"
import { depthAtom, displayedPositionAtom, graphJsonAtom } from "../state/atoms.js"
import type * as ViewerClient from "../state/ViewerClient.js"
import { DetailCard, type Selection } from "./DetailCard.js"

const clampScale = (value: number) => Math.min(1.15, Math.max(0.35, value))

export function BehaviorMap({ session }: { readonly session: ViewerClient.SessionView }) {
  const displayed = useAtomValue(displayedPositionAtom)
  const [depth, setDepth] = useAtom(depthAtom(session.sessionId))
  const [showJson, setShowJson] = useAtom(graphJsonAtom(session.sessionId))
  const [scale, setScale] = React.useState(1)
  const [selection, setSelection] = React.useState<Selection | undefined>(undefined)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  const graph = session.hello.graph as Graph.Graph
  const history = session.history
  const initialTag = history.positions[0]?.stateTag
  const activeTag = displayed === undefined ? undefined : history.positions[displayed]?.stateTag
  const visible = focus(graph, activeTag, depth === "all" ? "all" : depth)
  const placed = layout(visible, initialTag ?? activeTag)

  const traversedStep = history.steps.find(
    (step) =>
      step.committedPosition !== undefined &&
      step.committedPosition === displayed &&
      step.sourceStateTag !== undefined &&
      step.targetStateTag !== undefined,
  )
  const traversedEdge = visible.edges.find(
    (edge) =>
      traversedStep !== undefined &&
      edge.source === traversedStep.sourceStateTag &&
      edge.target === traversedStep.targetStateTag &&
      (traversedStep.eventTag === undefined || edge.event?.tag === traversedStep.eventTag) &&
      (traversedStep.branch === undefined || edge.branch?.index === traversedStep.branch.index),
  )

  const fit = React.useCallback(() => {
    const container = containerRef.current
    if (container === null) return
    setScale(
      clampScale(
        Math.min(
          (container.clientWidth - 60) / placed.width,
          (container.clientHeight - 60) / placed.height,
        ),
      ),
    )
  }, [placed.width, placed.height])

  const graphSignature = `${session.sessionId}:${visible.nodes.length}:${depth}`
  // Refit when the visible graph shape changes; manual zoom wins afterwards.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit keyed by shape signature
  React.useEffect(() => {
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [graphSignature])

  React.useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const observer = new ResizeObserver(() => fit())
    observer.observe(container)
    return () => observer.disconnect()
  }, [fit])

  return (
    <div className="relative min-w-0 flex-1">
      {showJson ? (
        <pre className="h-full overflow-auto bg-surface p-4 font-mono text-[11px] leading-relaxed">
          {JSON.stringify(toJson(graph), null, 2)}
        </pre>
      ) : (
        <div ref={containerRef} className="dot-grid h-full overflow-auto bg-surface">
          <div
            className="relative"
            style={{ width: placed.width * scale, height: placed.height * scale }}
          >
            <svg
              width={placed.width * scale}
              height={placed.height * scale}
              viewBox={`0 0 ${placed.width} ${placed.height}`}
              role="img"
              aria-label={`Behavior map for ${session.hello.machine.id}`}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
                </marker>
              </defs>
              {visible.edges.map((edge) => {
                const source = placed.positions.get(edge.source)
                const target = placed.positions.get(edge.target)
                if (source === undefined || target === undefined) return null
                const isTraversed = traversedEdge?.id === edge.id
                const isSelected = selection?.kind === "edge" && selection.id === edge.id
                const self = edge.source === edge.target
                const x1 = source.x + NODE_WIDTH
                const y1 = source.y + NODE_HEIGHT / 2
                const x2 = target.x
                const y2 = target.y + NODE_HEIGHT / 2
                const path = self
                  ? `M ${source.x + NODE_WIDTH / 2} ${source.y} C ${source.x + NODE_WIDTH / 2 - 40} ${source.y - 44}, ${source.x + NODE_WIDTH / 2 + 40} ${source.y - 44}, ${source.x + NODE_WIDTH / 2} ${source.y}`
                  : `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`
                const midX = self ? source.x + NODE_WIDTH / 2 : (x1 + x2) / 2
                const midY = self ? source.y - 40 : (y1 + y2) / 2
                const label =
                  edge.event?.tag ?? (edge.outcome !== undefined ? edge.outcome.kind : "→")
                return (
                  <g key={edge.id}>
                    <path
                      d={path}
                      fill="none"
                      markerEnd="url(#arrow)"
                      className={isTraversed ? "edge-traversed" : undefined}
                      style={{
                        stroke: isTraversed ? "var(--color-focus)" : "var(--color-rule-strong)",
                        strokeWidth: isTraversed ? 3 : 1.6,
                        opacity: isTraversed ? 1 : 0.55,
                      }}
                    />
                    {/* biome-ignore lint/a11y/useSemanticElements: SVG interactive label */}
                    <g
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() =>
                        setSelection(isSelected ? undefined : { kind: "edge", id: edge.id })
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          setSelection(isSelected ? undefined : { kind: "edge", id: edge.id })
                        }
                      }}
                    >
                      <rect
                        x={midX - label.length * 3.2 - 7}
                        y={midY - 9}
                        width={label.length * 6.4 + 14}
                        height={18}
                        rx={9}
                        style={{
                          fill: isTraversed ? "var(--color-focus)" : "var(--color-accent)",
                          stroke: "var(--color-accent-ink)",
                          strokeWidth: 1,
                        }}
                      />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        style={{
                          fill: isTraversed ? "var(--color-surface)" : "var(--color-accent-ink)",
                          font: "700 10px var(--font-mono)",
                        }}
                      >
                        {label}
                      </text>
                    </g>
                  </g>
                )
              })}
              {visible.nodes.map((node) => {
                const point = placed.positions.get(node.id)
                if (point === undefined) return null
                const isActive = node.id === activeTag
                const subtitle =
                  node.kind === "invoke"
                    ? `invoke · ${node.invocation?.name ?? ""}`
                    : node.kind === "final"
                      ? `final${node.description === undefined ? "" : ` · ${node.description}`}`
                      : node.kind === "child"
                        ? `child · ${node.child?.name ?? ""}`
                        : (node.description ?? "")
                return (
                  // biome-ignore lint/a11y/useSemanticElements: SVG interactive node
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() =>
                      setSelection(
                        selection?.kind === "node" && selection.id === node.id
                          ? undefined
                          : { kind: "node", id: node.id },
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSelection({ kind: "node", id: node.id })
                    }}
                  >
                    {node.id === initialTag ? (
                      <text
                        x={point.x - 8}
                        y={point.y + NODE_HEIGHT / 2 + 3}
                        textAnchor="end"
                        style={{ fill: "var(--color-muted)", font: "700 8px var(--font-mono)" }}
                      >
                        INITIAL ▸
                      </text>
                    ) : null}
                    <rect
                      x={point.x}
                      y={point.y}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={10}
                      style={{
                        fill: isActive ? "var(--color-pear)" : "var(--color-surface)",
                        stroke: "var(--color-ink)",
                        strokeWidth: isActive ? 2.5 : 1.5,
                        ...(node.kind === "final" ? { strokeDasharray: "2 2" } : {}),
                      }}
                    />
                    <text
                      x={point.x + NODE_WIDTH / 2}
                      y={point.y + 20}
                      textAnchor="middle"
                      style={{
                        fill: isActive ? "var(--color-pear-ink)" : "var(--color-ink)",
                        font: "800 12.5px var(--font-display)",
                      }}
                    >
                      {node.title}
                    </text>
                    {subtitle === "" ? null : (
                      <text
                        x={point.x + NODE_WIDTH / 2}
                        y={point.y + 35}
                        textAnchor="middle"
                        style={{ fill: "var(--color-muted)", font: "600 9px var(--font-mono)" }}
                      >
                        {subtitle.length > 26 ? `${subtitle.slice(0, 25)}…` : subtitle}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
            {selection === undefined ? null : (
              <DetailCard
                graph={visible}
                session={session}
                selection={selection}
                scale={scale}
                positions={placed.positions}
                onClose={() => setSelection(undefined)}
              />
            )}
          </div>
        </div>
      )}

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-ink bg-surface px-3 py-1 shadow-hard-sm">
        <span className="font-mono text-[9px] font-bold tracking-widest text-muted">DEPTH</span>
        <button
          type="button"
          className="font-mono text-[11px] font-bold"
          onClick={() => setDepth(depth === "all" ? 2 : Math.max(1, (depth as number) - 1))}
        >
          −
        </button>
        <span className="font-mono text-[11px]">{depth === "all" ? "·" : depth}</span>
        <button
          type="button"
          className="font-mono text-[11px] font-bold"
          onClick={() => setDepth(depth === "all" ? 1 : Math.min(9, (depth as number) + 1))}
        >
          +
        </button>
        <span className="text-rule">|</span>
        <button
          type="button"
          className={`font-mono text-[10px] font-bold ${depth === "all" ? "text-focus underline" : "text-muted"}`}
          onClick={() => setDepth("all")}
        >
          All
        </button>
        <span className="text-rule">|</span>
        <button
          type="button"
          className={`font-mono text-[10px] font-bold ${showJson ? "text-focus underline" : "text-muted"}`}
          onClick={() => setShowJson(!showJson)}
        >
          {"{ } JSON"}
        </button>
      </div>

      {showJson ? null : (
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-ink bg-surface px-3 py-1 shadow-hard-sm">
          <button
            type="button"
            className="font-mono text-[12px] font-bold"
            onClick={() => setScale(clampScale(scale / 1.2))}
          >
            −
          </button>
          <span className="font-mono text-[10px]">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="font-mono text-[12px] font-bold"
            onClick={() => setScale(clampScale(scale * 1.2))}
          >
            +
          </button>
          <button type="button" className="font-mono text-[10px] font-bold" onClick={fit}>
            Fit
          </button>
        </div>
      )}
    </div>
  )
}
