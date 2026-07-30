import { LockfileError } from '../api/errors.ts'
import { npmCache } from '../registry/cache-npm.ts'
import { pnpmCache } from '../registry/cache-pnpm.ts'
import { yarnBerryCache } from '../registry/cache-yarn-berry.ts'
import type {
  CacheAdapter,
  NpmTarballSource,
  RegistryAdapter,
  YarnBerryChecksumSource,
} from '../registry/types.ts'
import type { RefurbishSources, TarballSource } from './refurbish.ts'

export type ArtifactCacheFamily = 'npm' | 'yarn-berry' | 'pnpm'

export type ArtifactCacheSpecifier =
  | ArtifactCacheFamily
  | `${ArtifactCacheFamily}:${string}`

export interface RemoteArtifactSource {
  readonly registry: RegistryAdapter
}

export type ArtifactSourceList = readonly (
  | ArtifactCacheSpecifier
  | RemoteArtifactSource
)[]

export type ArtifactSourcesInput =
  | RefurbishSources
  | TarballSource
  | ArtifactSourceList

export type NormalizedArtifactSource =
  | Readonly<{
      kind: 'cache'
      family: ArtifactCacheFamily
      cache: CacheAdapter
    }>
  | Readonly<{
      kind: 'remote'
      registry: RegistryAdapter
    }>

export interface NormalizedArtifactSources {
  readonly refurbish: RefurbishSources
  readonly entries: readonly NormalizedArtifactSource[]
  readonly caches: readonly CacheAdapter[]
  readonly remotes: readonly RegistryAdapter[]
}

const emptyNpmTarballs: NpmTarballSource = Object.freeze({
  tarball: () => Promise.resolve(undefined),
})

function invalidArtifactSource(message: string): LockfileError {
  return new LockfileError({
    code: 'INVALID_INPUT',
    message: `sources.artifacts: ${message}`,
  })
}

function hasFunction(
  value: Record<string, unknown>,
  key: string,
): boolean {
  return typeof value[key] === 'function'
}

function isRegistryAdapter(value: unknown): value is RegistryAdapter {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return hasFunction(candidate, 'packument') && hasFunction(candidate, 'resolve')
}

function remoteRegistryOf(value: unknown, index: number): RegistryAdapter {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidArtifactSource(`list item ${index} must be a cache specifier or { registry }`)
  }
  const candidate = value as Record<string, unknown>
  if (!('registry' in candidate) || !isRegistryAdapter(candidate.registry)) {
    throw invalidArtifactSource(`list item ${index} has no valid registry adapter`)
  }
  return candidate.registry
}

interface ParsedCacheSpecifier {
  readonly family: ArtifactCacheFamily
  readonly path: string | undefined
}

function cacheSpecifierOf(value: string, index: number): ParsedCacheSpecifier {
  const separator = value.indexOf(':')
  const family = (separator < 0 ? value : value.slice(0, separator)) as ArtifactCacheFamily
  const path = separator < 0 ? undefined : value.slice(separator + 1)
  if (family !== 'npm' && family !== 'yarn-berry' && family !== 'pnpm') {
    throw invalidArtifactSource(`list item ${index} has unknown cache family ${JSON.stringify(family)}`)
  }
  if (path !== undefined && path.length === 0) {
    throw invalidArtifactSource(`list item ${index} has an empty ${family} cache path`)
  }
  return { family, path }
}

interface CacheCapabilities {
  readonly cache: CacheAdapter
  readonly npmTarballs?: NpmTarballSource
  readonly yarnBerryChecksums?: YarnBerryChecksumSource
}

function cacheCapabilitiesOf(specifier: ParsedCacheSpecifier): CacheCapabilities {
  if (specifier.family === 'npm') {
    const cache = npmCache(
      specifier.path === undefined ? {} : { cacheDir: specifier.path },
    )
    return { cache, npmTarballs: cache }
  }
  if (specifier.family === 'yarn-berry') {
    const cache = yarnBerryCache(
      specifier.path === undefined ? {} : { cacheFolder: specifier.path },
    )
    return { cache, yarnBerryChecksums: cache }
  }
  return {
    cache: pnpmCache(
      specifier.path === undefined ? {} : { storeDir: specifier.path },
    ),
  }
}

function firstNpmTarball(
  sources: readonly NpmTarballSource[],
): NpmTarballSource {
  if (sources.length === 0) return emptyNpmTarballs
  if (sources.length === 1) return sources[0]!
  return Object.freeze({
    async tarball(name: string, version: string) {
      for (const source of sources) {
        const bytes = await source.tarball(name, version)
        if (bytes !== undefined) return bytes
      }
      return undefined
    },
  })
}

function firstYarnBerryChecksum(
  sources: readonly YarnBerryChecksumSource[],
): YarnBerryChecksumSource | undefined {
  if (sources.length === 0) return undefined
  if (sources.length === 1) return sources[0]!
  return Object.freeze({
    async berryChecksum(name: string, version: string, cacheKey: string) {
      for (const source of sources) {
        const checksum = await source.berryChecksum(name, version, cacheKey)
        if (checksum !== undefined) return checksum
      }
      return undefined
    },
  })
}

function normalizeList(list: ArtifactSourceList): NormalizedArtifactSources {
  const entries: NormalizedArtifactSource[] = []
  const caches: CacheAdapter[] = []
  const remotes: RegistryAdapter[] = []
  const npmTarballs: NpmTarballSource[] = []
  const yarnBerryChecksums: YarnBerryChecksumSource[] = []

  for (let index = 0; index < list.length; index++) {
    const item = list[index]
    if (typeof item === 'string') {
      const specifier = cacheSpecifierOf(item, index)
      const capabilities = cacheCapabilitiesOf(specifier)
      caches.push(capabilities.cache)
      entries.push(Object.freeze({
        kind: 'cache',
        family: specifier.family,
        cache: capabilities.cache,
      }))
      if (capabilities.npmTarballs !== undefined) {
        npmTarballs.push(capabilities.npmTarballs)
      }
      if (capabilities.yarnBerryChecksums !== undefined) {
        yarnBerryChecksums.push(capabilities.yarnBerryChecksums)
      }
    } else {
      const registry = remoteRegistryOf(item, index)
      remotes.push(registry)
      entries.push(Object.freeze({ kind: 'remote', registry }))
    }
  }

  const yarnChecksums = firstYarnBerryChecksum(yarnBerryChecksums)
  const refurbish: RefurbishSources = Object.freeze({
    npmTarballs: firstNpmTarball(npmTarballs),
    ...(yarnChecksums === undefined ? {} : { yarnBerryChecksums: yarnChecksums }),
  })
  return Object.freeze({
    refurbish,
    entries: Object.freeze(entries),
    caches: Object.freeze(caches),
    remotes: Object.freeze(remotes),
  })
}

function normalizeSplit(source: RefurbishSources): NormalizedArtifactSources {
  if (source.npmTarballs === null
    || typeof source.npmTarballs !== 'object'
    || typeof source.npmTarballs.tarball !== 'function') {
    throw invalidArtifactSource('npmTarballs must supply tarball()')
  }
  if (source.yarnBerryChecksums !== undefined
    && (source.yarnBerryChecksums === null
      || typeof source.yarnBerryChecksums !== 'object'
      || typeof source.yarnBerryChecksums.berryChecksum !== 'function')) {
    throw invalidArtifactSource('yarnBerryChecksums must supply berryChecksum()')
  }
  return Object.freeze({
    refurbish: source,
    entries: Object.freeze([]),
    caches: Object.freeze([]),
    remotes: Object.freeze([]),
  })
}

function normalizeLegacy(source: TarballSource): NormalizedArtifactSources {
  if (typeof source.tarball !== 'function') {
    throw invalidArtifactSource('legacy source must supply tarball()')
  }
  if (source.berryChecksum !== undefined && typeof source.berryChecksum !== 'function') {
    throw invalidArtifactSource('legacy berryChecksum must be a function')
  }
  const berryChecksum = source.berryChecksum?.bind(source)
  const refurbish: RefurbishSources = Object.freeze({
    npmTarballs: source,
    ...(berryChecksum === undefined
      ? {}
      : { yarnBerryChecksums: Object.freeze({ berryChecksum }) }),
  })
  return Object.freeze({
    refurbish,
    entries: Object.freeze([]),
    caches: Object.freeze([]),
    remotes: Object.freeze([]),
  })
}

export function normalizeArtifactSources(
  source: ArtifactSourcesInput,
): NormalizedArtifactSources {
  if (Array.isArray(source)) return normalizeList(source as ArtifactSourceList)
  if (source === null || typeof source !== 'object') {
    throw invalidArtifactSource('expected a source object or ordered list')
  }
  if ('npmTarballs' in source) return normalizeSplit(source as RefurbishSources)
  if ('tarball' in source) return normalizeLegacy(source as TarballSource)
  throw invalidArtifactSource('object matches neither RefurbishSources nor TarballSource')
}
