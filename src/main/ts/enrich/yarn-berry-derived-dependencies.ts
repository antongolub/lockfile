import type { FormatId } from '../api/format-contract.ts'
import {
  type Edge,
  type EdgeTriple,
  type Graph,
} from '../graph.ts'
import type { TargetRequest } from '../completeness/types.ts'

const BERRY_TARGET_FORMATS: ReadonlySet<FormatId> = new Set([
  'yarn-berry-v4',
  'yarn-berry-v5',
  'yarn-berry-v6',
  'yarn-berry-v7',
  'yarn-berry-v8',
  'yarn-berry-v9',
  'yarn-berry-v10',
])

// The corpus proves these source-derived edges only from lock generation v7
// onward. Older/unknown Berry sources stay fail-closed even if their edge text
// happens to match: source lock schema is imperfect producer evidence, but it
// is still a necessary part of the observed provenance tuple.
const PROVED_SOURCE_FORMATS: ReadonlySet<FormatId> = new Set([
  'yarn-berry-v7',
  'yarn-berry-v8',
  'yarn-berry-v9',
  'yarn-berry-v10',
])

/**
 * Exact registry-package versions for which the fixture corpus and native
 * cross-PM locks prove Yarn's NpmSemverResolver-added `node-gyp@latest` edge.
 *
 * Yarn derives this edge when the published manifest declares neither a hard
 * nor peer node-gyp dependency but a lifecycle script mentions `node-gyp` or
 * `prebuild-install`. A Berry lock doesn't mark that provenance, so unknown
 * versions must not be guessed from the edge spelling alone: a package author
 * could have declared the same `node-gyp: latest` descriptor.
 */
const PROVED_NODE_GYP_INJECTIONS: ReadonlySet<string> = new Set([
  '@parcel/watcher@2.2.0',
  '@parcel/watcher@2.4.1',
  '@parcel/watcher@2.5.1',
  '@swagger-api/apidom-parser-adapter-json@1.11.1',
  '@tree-sitter-grammars/tree-sitter-yaml@0.7.1',
  'better-sqlite3@12.10.0',
  'bufferutil@4.0.7',
  'cbor-extract@2.1.1',
  'cpu-features@0.0.10',
  'dtrace-provider@0.8.8',
  'evp_bytestokey@1.0.3',
  'fsevents@2.3.2',
  'fsevents@2.3.3',
  'isolated-vm@6.1.2',
  'keytar@7.9.0',
  'lmdb@2.8.5',
  'lmdb@3.2.2',
  'lmdb@3.2.6',
  'msgpackr-extract@3.0.3',
  'nan@2.15.0',
  'nan@2.17.0',
  'nan@2.22.0',
  'nan@2.22.2',
  'nan@2.26.2',
  'node-addon-api@3.2.1',
  'node-addon-api@4.3.0',
  'node-addon-api@6.1.0',
  'node-addon-api@7.0.0',
  'node-addon-api@7.1.1',
  'node-addon-api@8.5.0',
  'sharp@0.28.3',
  'sharp@0.32.6',
  'tree-sitter@0.21.1',
  'tree-sitter@0.22.4',
  'tree-sitter-json@0.24.8',
  'utf-8-validate@5.0.10',
])

export interface YarnBerryDerivedDependencyResult {
  readonly graph: Graph
  readonly unwired: readonly EdgeTriple[]
}

function isProvedNodeGypInjection(graph: Graph, edge: Edge): boolean {
  if (edge.kind !== 'dep'
    || edge.attrs?.range !== 'npm:latest'
    || edge.attrs.alias !== undefined) return false
  const owner = graph.getNode(edge.src)
  const dependency = graph.getNode(edge.dst)
  return owner !== undefined
    && dependency?.name === 'node-gyp'
    && PROVED_NODE_GYP_INJECTIONS.has(`${owner.name}@${owner.version}`)
}

/**
 * Remove source-Yarn manifest injections before projecting to a PM that does
 * not derive them. Parsing remains lossless and every Berry→Berry conversion
 * retains the edge; only exact proved source rows are lowered.
 */
export function projectYarnBerryDerivedDependencies(
  graph: Graph,
  sourceFormat: FormatId | undefined,
  target: TargetRequest,
): YarnBerryDerivedDependencyResult {
  if (sourceFormat === undefined
    || !PROVED_SOURCE_FORMATS.has(sourceFormat)
    || BERRY_TARGET_FORMATS.has(target.format)) {
    return Object.freeze({ graph, unwired: Object.freeze([]) })
  }

  const removed = [...graph.nodes()]
    .flatMap(node => graph.out(node.id))
    .filter(edge => isProvedNodeGypInjection(graph, edge))
  if (removed.length === 0) {
    return Object.freeze({ graph, unwired: Object.freeze([]) })
  }

  const result = graph.mutate(mutator => {
    for (const edge of removed) {
      mutator.removeEdge(edge.src, edge.dst, edge.kind)
    }
  })
  return Object.freeze({
    graph: result.graph,
    unwired: Object.freeze(removed.map(edge =>
      Object.freeze({ src: edge.src, dst: edge.dst, kind: edge.kind }))),
  })
}
