import type { Graph as InternalGraph } from '../../graph.ts'
import {
  enrich as enrichInternal,
  type EnrichOptions as InternalEnrichOptions,
  type EnrichResult as InternalEnrichResult,
  type EnrichSources as InternalEnrichSources,
} from '../../enrich/facade.ts'
import type { ConversionContract } from './assessment.ts'
import {
  internalGraph,
  isPublicGraph,
  publicDiagnostics,
  publicGraph,
  type Graph,
} from './graph.ts'
import type { GraphOperationResult, ProjectionOptions } from './operation.ts'
import { internalProjectionOptions } from './options.ts'
import { rethrowPublic } from './errors.ts'

export interface EnrichOptions extends ProjectionOptions {
  readonly contract?: ConversionContract
}

export type EnrichResult = GraphOperationResult

export function enrich(graph: Graph, options: EnrichOptions): Promise<EnrichResult>
/** @internal Source-compatibility for the pre-0.6 proof engine and its tests. */
export function enrich(graph: InternalGraph, options: InternalEnrichOptions): Promise<InternalEnrichResult>
/** @internal Source-compatibility for the pre-0.6 positional source boundary. */
export function enrich(
  graph: InternalGraph,
  sources: InternalEnrichSources,
  options: Omit<InternalEnrichOptions, 'sources'>,
): Promise<InternalEnrichResult>
export function enrich(
  graph: Graph | InternalGraph,
  sourcesOrOptions: EnrichOptions | InternalEnrichOptions | InternalEnrichSources,
  legacyOptions?: Omit<InternalEnrichOptions, 'sources'>,
): Promise<EnrichResult | InternalEnrichResult> {
  if (legacyOptions !== undefined) {
    return enrichInternal(graph as InternalGraph, sourcesOrOptions as InternalEnrichSources, legacyOptions)
  }
  if (!isPublicGraph(graph)) {
    return enrichInternal(graph as InternalGraph, sourcesOrOptions as InternalEnrichOptions)
  }
  const options = sourcesOrOptions as EnrichOptions
  const contract = options.contract === 'install' ? 'project' : options.contract
  return enrichInternal(internalGraph(graph), {
    ...internalProjectionOptions(options),
    ...(contract === undefined ? {} : { contract }),
  } as InternalEnrichOptions).then(result => Object.freeze({
    graph: publicGraph(result.graph),
    diagnostics: publicDiagnostics(result.diagnostics),
  }), rethrowPublic)
}
