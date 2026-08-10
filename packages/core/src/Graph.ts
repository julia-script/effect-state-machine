import * as Schema from "effect/Schema"
import type * as Machine from "./Machine.js"
import * as SourceLocation from "./SourceLocation.js"

/**
 * Renderer-independent description of one machine node.
 *
 * @category models
 * @since 0.1.0
 */
export interface Node {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly kind: "state" | "invoke" | "child" | "final"
  readonly location?: SourceLocation.Location
  readonly invocation?: Readonly<{
    name: string
    description?: string
    retry?: Readonly<{
      name: string
      description?: string
    }>
  }>
  readonly child?: Readonly<{
    name: string
    description?: string
    definition: Graph
    forwards: ReadonlyArray<
      Readonly<{
        parentEvent: Readonly<{
          tag: string
          description?: string
        }>
        childEvent: Readonly<{
          tag: string
          description?: string
        }>
        description?: string
      }>
    >
  }>
}

/**
 * Directed transition between two graph nodes.
 *
 * @category models
 * @since 0.1.0
 */
export interface Edge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly location?: SourceLocation.Location
  readonly event?: Readonly<{
    tag: string
    description?: string
  }>
  readonly outcome?: Readonly<{
    kind: "success" | "failure" | "completion"
  }>
  readonly description?: string
  readonly branch?:
    | Readonly<{
        kind: "guard"
        index: number
        name: string
        description?: string
      }>
    | Readonly<{
        kind: "otherwise"
        index: number
      }>
}

/**
 * Event that a node explicitly accepts without producing a transition edge.
 *
 * @category models
 * @since 0.1.0
 */
export interface Ignore {
  readonly source: string
  readonly event: Readonly<{
    tag: string
    description?: string
  }>
  readonly description?: string
}

/**
 * Read-only, renderer-independent projection of a machine definition.
 *
 * @category models
 * @since 0.1.0
 */
export interface Graph {
  readonly id: string
  readonly description?: string
  readonly nodes: ReadonlyArray<Node>
  readonly edges: ReadonlyArray<Edge>
  readonly ignores: ReadonlyArray<Ignore>
}

/**
 * Number of outgoing transition levels retained by {@link focus}.
 *
 * @category configuration
 * @since 0.1.0
 */
export type FocusDepth = 1 | 2 | "full"

/**
 * Renderer-neutral activity markers for an active node and traversed edges.
 *
 * @category models
 * @since 0.1.0
 */
export interface ActivityOverlay {
  readonly activeNode?: string
  readonly traversedEdges: ReadonlyArray<string>
}

/**
 * Runtime transition identity used to match an authored graph edge.
 *
 * @category models
 * @since 0.1.0
 */
export interface TransitionActivity {
  readonly source: string
  readonly target: string
  readonly event?: string
  readonly branchIndex?: number
}

/**
 * Derives an outgoing, depth-bounded view without changing the source graph.
 *
 * **Details**
 *
 * Node and edge order remain stable. `"full"` returns the original graph by identity, while an
 * unknown center returns an empty projection with the original graph metadata.
 *
 * @category filtering
 * @since 0.1.0
 */
export const focus = (graph: Graph, center: string, depth: FocusDepth): Graph => {
  if (depth === "full") return graph
  if (!graph.nodes.some((node) => node.id === center)) {
    return { ...graph, nodes: [], edges: [], ignores: [] }
  }

  const visible = new Set([center])
  let frontier = [center]
  for (let level = 0; level < depth; level += 1) {
    const next: Array<string> = []
    for (const source of frontier) {
      for (const edge of graph.edges) {
        if (edge.source !== source || visible.has(edge.target)) continue
        visible.add(edge.target)
        next.push(edge.target)
      }
    }
    frontier = next
  }

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
    ignores: graph.ignores.filter((ignore) => visible.has(ignore.source)),
  }
}

/**
 * Matches runtime transition activity to graph edge identifiers without changing topology.
 *
 * **Details**
 *
 * Event tags and branch indices narrow a match only when supplied. An unknown active node is
 * omitted from the returned overlay.
 *
 * @category transforming
 * @since 0.1.0
 */
export const activity = (
  graph: Graph,
  activeNode: string | undefined,
  transitions: ReadonlyArray<TransitionActivity>,
): ActivityOverlay => ({
  ...(activeNode === undefined || !graph.nodes.some((node) => node.id === activeNode)
    ? {}
    : { activeNode }),
  traversedEdges: graph.edges.flatMap((edge) =>
    transitions.some(
      (transition) =>
        transition.source === edge.source &&
        transition.target === edge.target &&
        (transition.event === undefined || transition.event === edge.event?.tag) &&
        (transition.branchIndex === undefined || transition.branchIndex === edge.branch?.index),
    )
      ? [edge.id]
      : [],
  ),
})

const descriptionOf = (schema: Schema.Top | undefined): string | undefined => {
  if (schema === undefined) return undefined
  const description = Schema.resolveAnnotations(schema)?.description
  return typeof description === "string" ? description : undefined
}

const titleOf = (schema: Schema.Top | undefined, fallback: string): string => {
  if (schema === undefined) return fallback
  const title = Schema.resolveAnnotations(schema)?.title
  return typeof title === "string" ? title : fallback
}

/**
 * Projects a machine definition into graphable nodes, edges, ignores, and child graphs.
 *
 * **Details**
 *
 * Schema titles and descriptions become presentation metadata, and authored source references are
 * resolved best-effort. The projection is synchronous and never runs the initializer, guards,
 * reducers, Effects, or child machines.
 *
 * @see {@link SourceLocation.Mapper} for mapping generated positions through source maps.
 * @category converting
 * @since 0.1.0
 */
export const fromDefinition = (
  definition: Machine.DefinitionMetadata,
  options?: Readonly<{ mapSource?: SourceLocation.Mapper }>,
): Graph => {
  const nodes = definition.nodes.map((node): Node => {
    const schema = definition.schemas.state.cases[node.tag]
    const description = descriptionOf(schema)
    const location = SourceLocation.resolve(node.source, { map: options?.mapSource })
    return {
      id: node.tag,
      title: titleOf(schema, node.tag),
      kind: node.kind,
      ...(location === undefined ? {} : { location }),
      ...(description === undefined ? {} : { description }),
      ...(node.kind === "invoke"
        ? {
            invocation: {
              name: node.name,
              ...(node.description === undefined ? {} : { description: node.description }),
              ...(node.retry === undefined
                ? {}
                : {
                    retry: {
                      name: node.retry.name,
                      ...(node.retry.description === undefined
                        ? {}
                        : { description: node.retry.description }),
                    },
                  }),
            },
          }
        : {}),
      ...(node.kind === "child"
        ? {
            child: {
              name: node.name,
              ...(node.description === undefined ? {} : { description: node.description }),
              definition: fromDefinition(node.definition, options),
              forwards: Object.entries(node.forward).flatMap(([parentEventTag, forwarded]) => {
                if (forwarded === undefined) return []
                const parentDescription = descriptionOf(
                  definition.schemas.event.cases[parentEventTag],
                )
                const childDescription = descriptionOf(
                  node.definition.schemas.event.cases[forwarded.target],
                )
                return [
                  {
                    parentEvent: {
                      tag: parentEventTag,
                      ...(parentDescription === undefined
                        ? {}
                        : { description: parentDescription }),
                    },
                    childEvent: {
                      tag: forwarded.target,
                      ...(childDescription === undefined ? {} : { description: childDescription }),
                    },
                    ...(forwarded.description === undefined
                      ? {}
                      : { description: forwarded.description }),
                  },
                ]
              }),
            },
          }
        : {}),
    }
  })

  const edges: Array<Omit<Edge, "id">> = []
  const ignores: Array<Ignore> = []
  for (const node of definition.nodes) {
    if (node.kind === "final") continue
    for (const [eventTag, handler] of Object.entries(node.on)) {
      if (handler === undefined) continue
      const eventDescription = descriptionOf(definition.schemas.event.cases[eventTag])
      const event = {
        tag: eventTag,
        ...(eventDescription === undefined ? {} : { description: eventDescription }),
      }

      if ("ignore" in handler) {
        ignores.push({
          source: node.tag,
          event,
          ...(handler.ignore.description === undefined
            ? {}
            : { description: handler.ignore.description }),
        })
        continue
      }

      if (!("branches" in handler)) {
        edges.push({
          source: node.tag,
          target: handler.target,
          event,
          ...(handler.description === undefined ? {} : { description: handler.description }),
        })
        continue
      }

      for (const [index, branch] of handler.branches.entries()) {
        const branchMetadata =
          "otherwise" in branch
            ? ({ kind: "otherwise", index } as const)
            : ({
                kind: "guard",
                index,
                name: branch.when.name,
                ...(branch.when.description === undefined
                  ? {}
                  : { description: branch.when.description }),
              } as const)
        edges.push({
          source: node.tag,
          target: branch.target,
          event,
          branch: branchMetadata,
          ...(branch.description === undefined ? {} : { description: branch.description }),
        })
      }
    }

    if (node.kind === "invoke") {
      for (const [kind, outcomeHandler] of [
        ["success", node.onSuccess],
        ["failure", node.onFailure],
      ] as const) {
        if (!("branches" in outcomeHandler)) {
          edges.push({
            source: node.tag,
            target: outcomeHandler.target,
            outcome: { kind },
            ...(outcomeHandler.description === undefined
              ? {}
              : { description: outcomeHandler.description }),
          })
          continue
        }
        for (const [index, outcome] of outcomeHandler.branches.entries()) {
          const branch =
            "otherwise" in outcome
              ? ({ kind: "otherwise", index } as const)
              : ({
                  kind: "guard",
                  index,
                  name: outcome.when.name,
                  ...(outcome.when.description === undefined
                    ? {}
                    : { description: outcome.when.description }),
                } as const)
          edges.push({
            source: node.tag,
            target: outcome.target,
            outcome: { kind },
            branch,
            ...(outcome.description === undefined ? {} : { description: outcome.description }),
          })
        }
      }
    }

    if (node.kind === "child") {
      const outcomeHandler = node.onComplete
      if (!("branches" in outcomeHandler)) {
        edges.push({
          source: node.tag,
          target: outcomeHandler.target,
          outcome: { kind: "completion" },
          ...(outcomeHandler.description === undefined
            ? {}
            : { description: outcomeHandler.description }),
        })
      } else {
        for (const [index, outcome] of outcomeHandler.branches.entries()) {
          const branch =
            "otherwise" in outcome
              ? ({ kind: "otherwise", index } as const)
              : ({
                  kind: "guard",
                  index,
                  name: outcome.when.name,
                  ...(outcome.when.description === undefined
                    ? {}
                    : { description: outcome.when.description }),
                } as const)
          edges.push({
            source: node.tag,
            target: outcome.target,
            outcome: { kind: "completion" },
            branch,
            ...(outcome.description === undefined ? {} : { description: outcome.description }),
          })
        }
      }
    }
  }

  const identifiedEdges = edges.map((edge, index): Edge => {
    const authoredNode = definition.nodes.find((node) => node.tag === edge.source)
    let location = nodes.find((node) => node.id === edge.source)?.location
    if (authoredNode !== undefined && edge.branch?.kind === "guard") {
      const handler =
        edge.event !== undefined && authoredNode.kind !== "final"
          ? authoredNode.on[edge.event.tag]
          : authoredNode.kind === "invoke" && edge.outcome?.kind === "success"
            ? authoredNode.onSuccess
            : authoredNode.kind === "invoke" && edge.outcome?.kind === "failure"
              ? authoredNode.onFailure
              : authoredNode.kind === "child" && edge.outcome?.kind === "completion"
                ? authoredNode.onComplete
                : undefined
      if (handler !== undefined && "branches" in handler) {
        const branch = handler.branches[edge.branch.index]
        if (branch !== undefined && "when" in branch) {
          location =
            SourceLocation.resolve(branch.when.source, { map: options?.mapSource }) ?? location
        }
      }
    }
    return {
      ...edge,
      id: `${edge.source}:${edge.event?.tag ?? edge.outcome?.kind ?? "transition"}:${edge.branch?.index ?? 0}:${edge.target}:${index}`,
      ...(location === undefined ? {} : { location }),
    }
  })

  return {
    id: definition.id,
    nodes,
    edges: identifiedEdges,
    ignores,
    ...(definition.description === undefined ? {} : { description: definition.description }),
  }
}
