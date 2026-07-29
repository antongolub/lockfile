import type { Graph, Node } from '../graph.ts'

/**
 * Locate a project root only from evidence that carries project identity.
 *
 * Graph reachability is deliberately excluded: a sole DAG root can be an
 * ordinary top-level dependency in a rootless source format.
 */
export function locateAuthoritativeRootNode(
  graph: Graph,
  native: { rootId?: string } | undefined,
): Node | undefined {
  if (native?.rootId !== undefined) {
    const node = graph.getNode(native.rootId)
    if (node !== undefined) return node
  }
  for (const node of graph.nodes()) {
    if (node.workspacePath === '') return node
  }
  return undefined
}
