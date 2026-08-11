import type { Protocol } from "@effect-state-machine/studio-client"
import type { Graph } from "effect-state-machine/devtools"

const separator = "::"

export const nodeId = (definitionPath: string, localId: string): string =>
  `${definitionPath}${separator}node${separator}${localId}`

export const edgeId = (definitionPath: string, localId: string): string =>
  `${definitionPath}${separator}edge${separator}${localId}`

const relationshipId = (definitionPath: string, invocation: string, childPath: string): string =>
  edgeId(definitionPath, `child:${invocation}:${childPath}`)

export interface ComposedNode {
  readonly id: string
  readonly localId: string
  readonly definitionPath: string
  readonly node: Graph.Node
}

export interface ComposedEdge {
  readonly id: string
  readonly localId: string
  readonly definitionPath: string
  readonly edge: Graph.Edge
  readonly relationship?: Readonly<{
    invocation: string
    childDefinitionPath: string
  }>
}

export interface DefinitionRegion {
  readonly definitionPath: string
  readonly machineId: string
  readonly depth: number
  readonly parentDefinitionPath?: string
  readonly ownerStateTag?: string
  readonly invocation?: string
}

export interface ComposedGraph {
  readonly graph: Graph.Graph
  readonly definitions: ReadonlyMap<string, Protocol.DefinitionDescriptorMessage>
  readonly nodes: ReadonlyMap<string, ComposedNode>
  readonly edges: ReadonlyMap<string, ComposedEdge>
  readonly regions: ReadonlyArray<DefinitionRegion>
  /** A deterministic marker target for every definition, including inactive definitions. */
  readonly initialNodeIds: ReadonlyMap<string, string>
}

/** Flattens a structural definition registry into one path-qualified graph. */
export const composeDefinitions = (
  descriptors: ReadonlyArray<Protocol.DefinitionDescriptorMessage>,
): ComposedGraph => {
  const definitions = new Map(
    descriptors.map((descriptor) => [descriptor.definitionPath, descriptor]),
  )
  const parents = new Map<
    string,
    Readonly<{ definitionPath: string; ownerStateTag: string; invocation: string }>
  >()
  for (const descriptor of descriptors) {
    for (const child of descriptor.children) {
      parents.set(child.definitionPath, {
        definitionPath: descriptor.definitionPath,
        ownerStateTag: child.ownerStateTag,
        invocation: child.invocation,
      })
    }
  }

  const depthOf = (path: string): number => {
    let depth = 0
    let parent = parents.get(path)
    const seen = new Set<string>()
    while (parent !== undefined && !seen.has(parent.definitionPath)) {
      seen.add(parent.definitionPath)
      depth += 1
      parent = parents.get(parent.definitionPath)
    }
    return depth
  }

  const nodes = new Map<string, ComposedNode>()
  const edges = new Map<string, ComposedEdge>()
  const graphNodes: Array<Graph.Node> = []
  const graphEdges: Array<Graph.Edge> = []
  const graphIgnores: Array<Graph.Ignore> = []
  const initialNodeIds = new Map<string, string>()

  for (const descriptor of descriptors) {
    const graph = descriptor.graph as Graph.Graph
    const first = graph.nodes[0]
    if (first !== undefined) {
      initialNodeIds.set(descriptor.definitionPath, nodeId(descriptor.definitionPath, first.id))
    }
    for (const localNode of graph.nodes) {
      const id = nodeId(descriptor.definitionPath, localNode.id)
      nodes.set(id, {
        id,
        localId: localNode.id,
        definitionPath: descriptor.definitionPath,
        node: localNode,
      })
      graphNodes.push({ ...localNode, id })
    }
    for (const localEdge of graph.edges) {
      const id = edgeId(descriptor.definitionPath, localEdge.id)
      const edge: Graph.Edge = {
        ...localEdge,
        id,
        source: nodeId(descriptor.definitionPath, localEdge.source),
        target: nodeId(descriptor.definitionPath, localEdge.target),
      }
      edges.set(id, {
        id,
        localId: localEdge.id,
        definitionPath: descriptor.definitionPath,
        edge: localEdge,
      })
      graphEdges.push(edge)
    }
    for (const ignore of graph.ignores) {
      graphIgnores.push({ ...ignore, source: nodeId(descriptor.definitionPath, ignore.source) })
    }
  }

  for (const descriptor of descriptors) {
    for (const child of descriptor.children) {
      const target = initialNodeIds.get(child.definitionPath)
      if (target === undefined) continue
      const localId = `child:${child.invocation}:${child.definitionPath}`
      const id = relationshipId(descriptor.definitionPath, child.invocation, child.definitionPath)
      const edge: Graph.Edge = {
        id,
        source: nodeId(descriptor.definitionPath, child.ownerStateTag),
        target,
        event: { tag: `child · ${child.invocation}` },
        description: `Invokes ${definitions.get(child.definitionPath)?.machine.id ?? child.definitionPath}`,
      }
      edges.set(id, {
        id,
        localId,
        definitionPath: descriptor.definitionPath,
        edge,
        relationship: {
          invocation: child.invocation,
          childDefinitionPath: child.definitionPath,
        },
      })
      graphEdges.push(edge)
    }
  }

  return {
    graph: {
      id: descriptors[0]?.machine.id ?? "machine-tree",
      nodes: graphNodes,
      edges: graphEdges,
      ignores: graphIgnores,
    },
    definitions,
    nodes,
    edges,
    regions: descriptors.map((descriptor) => {
      const parent = parents.get(descriptor.definitionPath)
      return {
        definitionPath: descriptor.definitionPath,
        machineId: descriptor.machine.id,
        depth: depthOf(descriptor.definitionPath),
        ...(parent === undefined
          ? {}
          : {
              parentDefinitionPath: parent.definitionPath,
              ownerStateTag: parent.ownerStateTag,
              invocation: parent.invocation,
            }),
      }
    }),
    initialNodeIds,
  }
}
