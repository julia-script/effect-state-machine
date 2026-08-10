import * as Schema from "effect/Schema"
import type { Machine } from "effect-state-machine"
import { Graph, type SourceLocation } from "effect-state-machine/devtools"
import * as Protocol from "./Protocol.js"

/**
 * Builds the self-describing session announcement from a machine definition.
 * Everything Studio needs to render the machine — graph, descriptions, source
 * locations, JSON Schemas — is derived here, application-side, so the wire
 * carries only plain data.
 */

export interface MakeOptions {
  readonly definition: Machine.DefinitionMetadata
  readonly sessionId: string
  readonly parentSessionId?: string
  readonly app: Schema.Schema.Type<typeof Protocol.AppIdentity>
  readonly quickEvents?: ReadonlyArray<Protocol.QuickEventControlMessage>
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

export const make = (options: MakeOptions): Protocol.HelloMessage => ({
  _tag: "Hello",
  protocolVersion: Protocol.VERSION,
  sessionId: options.sessionId,
  ...(options.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }),
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
})
