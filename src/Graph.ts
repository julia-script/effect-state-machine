import * as Schema from "effect/Schema"
import type * as Machine from "./Machine.js"

export interface Node {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly kind: "state" | "invoke" | "child" | "final"
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

export interface Edge {
  readonly source: string
  readonly target: string
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

export interface Ignore {
  readonly source: string
  readonly event: Readonly<{
    tag: string
    description?: string
  }>
  readonly description?: string
}

export interface Graph {
  readonly id: string
  readonly description?: string
  readonly nodes: ReadonlyArray<Node>
  readonly edges: ReadonlyArray<Edge>
  readonly ignores: ReadonlyArray<Ignore>
}

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

export const fromDefinition = (definition: Machine.DefinitionMetadata): Graph => {
  const nodes = definition.nodes.map((node): Node => {
    const schema = definition.schemas.state.cases[node.tag]
    const description = descriptionOf(schema)
    return {
      id: node.tag,
      title: titleOf(schema, node.tag),
      kind: node.kind,
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
              definition: fromDefinition(node.definition),
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

  const edges: Array<Edge> = []
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

  return {
    id: definition.id,
    nodes,
    edges,
    ignores,
    ...(definition.description === undefined ? {} : { description: definition.description }),
  }
}
