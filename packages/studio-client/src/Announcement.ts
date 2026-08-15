import * as Schema from "effect/Schema"
import { Machine } from "effect-state-machine"
import { Graph, type SourceLocation } from "effect-state-machine/devtools"
import * as Protocol from "./Protocol.js"

/**
 * Inputs used to build a self-describing Studio session announcement.
 *
 * @category configuration
 * @since 0.1.0
 */
export interface MakeOptions {
  readonly definition: Machine.DefinitionMetadata
  readonly sessionId: string
  readonly instanceKey?: string
  readonly rootActorId: Machine.ActorId
  readonly parentSessionId?: string
  readonly app: Schema.Schema.Type<typeof Protocol.AppIdentity>
  readonly quickEvents?: ReadonlyArray<Protocol.QuickEventControlMessage>
  readonly quickEventsByDefinition?: Readonly<
    Record<string, ReadonlyArray<Protocol.QuickEventControlMessage>>
  >
  readonly mapSource?: SourceLocation.Mapper
}

/**
 * JSON Schema derivation is best effort: a case whose schema cannot be
 * represented is omitted rather than failing the announcement.
 */
const jsonSchemas = (
  cases: Readonly<Record<string, Schema.Top>>,
): Readonly<Record<string, unknown>> => {
  const documents: Record<string, unknown> = {}
  for (const [tag, caseSchema] of Object.entries(cases)) {
    try {
      documents[tag] = Schema.toJsonSchemaDocument(caseSchema)
    } catch {
      // Unrepresentable schema — the viewer simply shows no schema for this case.
    }
  }
  return documents
}

const definitionRegistry = (
  definition: Machine.DefinitionMetadata,
  options: MakeOptions,
): ReadonlyArray<Protocol.DefinitionDescriptorMessage> => {
  const entries: Array<Protocol.DefinitionDescriptorMessage> = []

  const visit = (current: Machine.DefinitionMetadata, path: Machine.DefinitionPath): void => {
    const children = current.nodes.flatMap((node) => {
      if (node.kind !== "child") return []
      return [
        {
          ownerStateTag: node.tag,
          invocation: node.name,
          definitionPath: Machine.DefinitionPath.child(path, node.tag, node.name),
          definition: node.definition,
        },
      ]
    })
    const quickEvents =
      path === Machine.DefinitionPath.root
        ? (options.quickEvents ?? [])
        : (options.quickEventsByDefinition?.[path] ?? [])
    entries.push({
      definitionPath: path,
      machine: {
        id: current.id,
        ...(current.description === undefined ? {} : { description: current.description }),
      },
      graph: Graph.fromDefinition(current, { mapSource: options.mapSource }),
      jsonSchemas: {
        states: jsonSchemas(current.schemas.state.cases),
        events: jsonSchemas(current.schemas.event.cases),
      },
      quickEvents,
      children: children.map(({ definition: _, ...child }) => child),
    })
    for (const child of children) {
      visit(child.definition, child.definitionPath)
    }
  }

  visit(definition, Machine.DefinitionPath.root)
  return entries
}

/**
 * Builds the initial Studio protocol announcement from a machine definition.
 *
 * **Details**
 *
 * Graph metadata, source locations, and per-case JSON Schemas are derived application-side so the
 * wire message contains only plain data. JSON Schema derivation is best-effort: cases that cannot
 * be represented are omitted rather than failing the announcement.
 *
 * @category constructors
 * @since 0.1.0
 */
export const make = (options: MakeOptions): Protocol.HelloMessage => ({
  _tag: "Hello",
  protocolVersion: Protocol.VERSION,
  sessionId: options.sessionId,
  ...(options.instanceKey === undefined ? {} : { instanceKey: options.instanceKey }),
  ...(options.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }),
  rootActorId: options.rootActorId,
  app: options.app,
  machine: {
    id: options.definition.id,
    ...(options.definition.description === undefined
      ? {}
      : { description: options.definition.description }),
  },
  graph: Graph.fromDefinition(options.definition, { mapSource: options.mapSource }),
  jsonSchemas: {
    states: jsonSchemas(options.definition.schemas.state.cases),
    events: jsonSchemas(options.definition.schemas.event.cases),
  },
  quickEvents: options.quickEvents ?? [],
  definitions: definitionRegistry(options.definition, options),
})
