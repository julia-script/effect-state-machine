import * as Schema from "effect/Schema"
import type * as Machine from "./Machine.js"

export interface Node {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly kind: "state" | "final"
}

export interface Edge {
  readonly source: string
  readonly target: string
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
    }
  })

  const edges = definition.nodes.flatMap((node) =>
    Object.entries(node.kind === "state" ? node.on : {}).flatMap(
      ([eventTag, transition]): ReadonlyArray<Edge> => {
        if (transition === undefined) return []
        const eventDescription = descriptionOf(definition.schemas.event.cases[eventTag])
        return [
          {
            source: node.tag,
            target: transition.target,
            event: {
              tag: eventTag,
              ...(eventDescription === undefined ? {} : { description: eventDescription }),
            },
            ...(transition.description === undefined
              ? {}
              : { description: transition.description }),
          },
        ]
      },
    ),
  )

  return {
    id: definition.id,
    nodes,
    edges,
    ...(definition.description === undefined ? {} : { description: definition.description }),
  }
}
