import { fetch as nodeFetchNative } from 'node-fetch-native'
import {
  resolveRegistry as resolveRegistryInternal,
  type RegistryConfig as InternalRegistryConfig,
} from '../../registry/config.ts'
import { frozenRegistry as frozenRegistryInternal } from '../../registry/frozen.ts'
import {
  liveRegistry as liveRegistryInternal,
  type LiveRegistryAdapter as InternalLiveRegistryAdapter,
} from '../../registry/live.ts'
import type {
  RegistryAdapter as InternalRegistryAdapter,
} from '../../registry/types.ts'
import {
  internalGraph,
  isPublicGraph,
  type Graph,
  type Integrity,
} from './graph.ts'
import type { Graph as InternalGraph } from '../../graph.ts'

export type Awaitable<T> = T | Promise<T>
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>
export type Fetch = typeof globalThis.fetch

export interface PackumentVersion {
  readonly name: string
  readonly version: string
  readonly integrity?: Integrity
  readonly tarball?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<
    Record<string, Readonly<{ optional?: boolean }>>
  >
  readonly engines?: Readonly<Record<string, string>>
  readonly funding?: unknown
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly libc?: readonly string[]
  readonly deprecated?: string
  readonly bin?: string | Readonly<Record<string, string>>
  readonly bundledDependencies?: readonly string[]
  readonly hasInstallScript?: boolean
  readonly license?: string
  readonly type?: string
  readonly main?: string
  readonly exports?: unknown
}

export interface Packument {
  readonly name: string
  readonly distTags: Readonly<Record<string, string>>
  readonly versions: Readonly<Record<string, PackumentVersion>>
}

export interface RegistryAdapter {
  packument(name: string): Promise<Packument | undefined>
  resolve(name: string, range: string): Promise<PackumentVersion | undefined>
  manifest?(name: string, version: string): Promise<PackumentVersion | undefined>
  readonly limit?: Limiter
}

export interface ArtifactRoute {
  readonly registryUrl: string
  readonly fetch: Fetch
  readonly authHeaderFor: (url: string) => string | undefined
  readonly limit: Limiter
}

export interface RemoteArtifactRegistry extends RegistryAdapter {
  artifactRoute(name: string): ArtifactRoute | undefined
}

export type RegistryConfigDialect =
  | 'npm'
  | 'pnpm'
  | 'yarn-classic'
  | 'yarn-berry'

export interface RegistryConfig {
  registryFor(packageName: string): string
  authHeaderFor(registryUrl: string): string | undefined
}

export interface ResolveRegistryOptions {
  readonly config: RegistryConfigDialect
  readonly registry?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly home?: string
}

export interface LiveRegistryDirectOptions {
  readonly url?: string
  readonly authHeader?: string
  readonly cwd?: never
  readonly config?: never
  readonly registry?: never
  readonly env?: never
  readonly home?: never
  readonly fetch?: Fetch
  readonly limit?: Limiter
}

export interface LiveRegistryDiscoveryOptions extends ResolveRegistryOptions {
  readonly cwd: string
  readonly url?: never
  readonly authHeader?: never
  readonly fetch?: Fetch
  readonly limit?: Limiter
}

export interface LiveRegistryConfigOptions {
  readonly config: RegistryConfig
  readonly cwd?: never
  readonly registry?: never
  readonly env?: never
  readonly home?: never
  readonly url?: never
  readonly authHeader?: never
  readonly fetch?: Fetch
  readonly limit?: Limiter
}

export type LiveRegistryOptions =
  | LiveRegistryDiscoveryOptions
  | LiveRegistryConfigOptions
  | LiveRegistryDirectOptions

export type RawAdvisory = Readonly<Record<string, unknown>>

export interface AuditOptions {
  readonly chunkSize?: number
}

export interface LiveRegistryAdapter extends RemoteArtifactRegistry {
  audit(
    packages: Readonly<Record<string, readonly string[]>>,
    options?: AuditOptions,
  ): Promise<Readonly<Record<string, readonly RawAdvisory[]>>>
}

export const resolveRegistry = resolveRegistryInternal as unknown as (
  cwd: string,
  options: ResolveRegistryOptions,
) => RegistryConfig

export const liveRegistry = liveRegistryInternal as unknown as (
  options?: LiveRegistryOptions,
) => LiveRegistryAdapter

export function frozenRegistry(graph: Graph): RegistryAdapter
/** @internal Core-graph compatibility; stripped from the declaration. */
export function frozenRegistry(graph: InternalGraph): InternalRegistryAdapter
export function frozenRegistry(
  graph: Graph | InternalGraph,
): RegistryAdapter | InternalRegistryAdapter {
  const adapter = frozenRegistryInternal(internalGraph(graph))
  return isPublicGraph(graph)
    ? adapter as unknown as RegistryAdapter
    : adapter
}

export const defaultFetch: Fetch = nodeFetchNative as Fetch

/** @internal Adapts an external public registry to the existing core. */
export function internalRegistry(value: RegistryAdapter): InternalRegistryAdapter {
  return value as unknown as InternalRegistryAdapter
}

/** @internal Adapts the resolved public route object to the existing core. */
export function internalRegistryConfig(value: RegistryConfig): InternalRegistryConfig {
  return value as InternalRegistryConfig
}

/** @internal Adapts a core live registry to the public structural seam. */
export function publicLiveRegistry(value: InternalLiveRegistryAdapter): LiveRegistryAdapter {
  return value as unknown as LiveRegistryAdapter
}
