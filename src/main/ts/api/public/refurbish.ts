import {
  refurbish as refurbishInternal,
  type RefurbishOptions as InternalRefurbishOptions,
  type RefurbishSources as InternalRefurbishSources,
  type TarballSource as InternalTarballSource,
} from '../../enrich/refurbish.ts'
import type { FormatId } from '../../api/format-contract.ts'
import type {
  ArtifactResourceLimits,
  ArtifactResourcePolicy,
} from '../../recipe/artifact-envelope.ts'
import type {
  NpmTarballSource,
  YarnBerryChecksumSource,
} from '../../registry/types.ts'
import { internalObserver } from './diagnostics.ts'
import {
  internalGraph,
  publicDiagnostics,
  publicGraph,
  type Graph,
  type NodeId,
} from './graph.ts'
import type { Diagnostic, DiagnosticObserver } from './operation.ts'

export type {
  ArtifactResourceLimits,
  ArtifactResourcePolicy,
  NpmTarballSource,
  YarnBerryChecksumSource,
}

/** Separate npm-tarball bytes from Yarn-cache checksum evidence. */
export interface RefurbishSources {
  readonly npmTarballs: NpmTarballSource
  readonly yarnBerryChecksums?: YarnBerryChecksumSource
}

/** Historical combined byte/checksum source retained for repair callers. */
export interface TarballSource extends NpmTarballSource {
  berryChecksum?(
    name: string,
    version: string,
    cacheKey: string,
  ): Promise<string | undefined>
}

export interface RefurbishOptions {
  readonly onDiagnostic?: DiagnosticObserver
  readonly seed?: ReadonlySet<NodeId>
  readonly concurrency?: number
  readonly cacheKey?: string
  readonly cacheKeyInference?: 'format-default' | 'observed-only'
  readonly artifactResources?: ArtifactResourcePolicy
}

export interface RefurbishResult {
  graph: Graph
  enriched: NodeId[]
  unresolved: Diagnostic[]
}

/**
 * Repair payload fields on existing nodes for the graph's own lockfile format.
 * This does not complete, materialize, or project the graph.
 */
export async function refurbish(
  graph: Graph,
  format: FormatId,
  source: RefurbishSources | TarballSource,
  options: RefurbishOptions = {},
): Promise<RefurbishResult> {
  const { onDiagnostic, ...coreOptions } = options
  const result = await refurbishInternal(
    internalGraph(graph),
    format,
    source as InternalRefurbishSources | InternalTarballSource,
    {
      ...coreOptions,
      ...(onDiagnostic === undefined
        ? {}
        : { onDiagnostic: internalObserver(onDiagnostic) }),
    } as InternalRefurbishOptions,
  )
  return {
    graph: publicGraph(result.graph),
    enriched: result.enriched,
    unresolved: [...publicDiagnostics(result.unresolved)],
  }
}
