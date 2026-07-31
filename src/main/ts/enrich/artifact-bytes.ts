import { createHash } from 'node:crypto'
import {
  toTarballKey,
  type Diagnostic,
  type Node,
  type TarballKey,
  type TarballPayload,
} from '../graph.ts'
import {
  ArtifactEnvelopeError,
  ArtifactLiveMeter,
  ArtifactTrafficError,
  ArtifactTrafficMeter,
  DEFAULT_ARTIFACT_MAX_NETWORK_TRAFFIC_BYTES,
  artifactResourceLimits,
  assertArtifactRepresentation,
  inflateArtifact,
  type ArtifactResourcePolicy,
  type EffectiveArtifactResourceLimits,
} from '../recipe/artifact-envelope.ts'
import {
  berryCacheKeyReproducible,
  computeBerryChecksum,
} from '../recipe/berry-checksum.ts'
import {
  berryLibzipAvailable,
  computeBerryChecksumViaLibzip,
} from '../recipe/berry-pack-libzip.ts'
import { stripRegistrySha1Fragment } from '../recipe/resolution.ts'
import type {
  ArtifactRoute,
  NpmTarballSource,
  RegistryAdapter,
  RemoteArtifactRegistry,
} from '../registry/types.ts'
import type {
  NormalizedArtifactSource,
  NormalizedArtifactSources,
} from './artifact-sources.ts'
import {
  enrichArtifactDiagnostic,
  enrichArtifactLimit,
  enrichArtifactTrafficLimit,
  type EnrichArtifactDiagnosticCode,
} from './diagnostics.ts'
import {
  readArtifactStore,
  writeArtifactStore,
  type ArtifactStoreAlias,
  type ArtifactStoreEvidence,
  type ArtifactStoreSource,
} from './artifact-store.ts'

export interface ArtifactTarballRequest {
  readonly node: Node
  readonly payload: TarballPayload
}

export interface RequestNpmTarballSource extends NpmTarballSource {
  readonly liveMeter: ArtifactLiveMeter
  tarballFor(request: ArtifactTarballRequest): Promise<Uint8Array | undefined>
  releaseTarball(bytes: Uint8Array): void
}

export class ArtifactByteFailure extends Error {
  readonly diagnostic: Diagnostic

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message)
    this.name = 'ArtifactByteFailure'
    this.diagnostic = diagnostic
  }
}

function fail(
  code: EnrichArtifactDiagnosticCode,
  key: TarballKey,
  message: string,
  data?: Record<string, unknown>,
): never {
  throw new ArtifactByteFailure(enrichArtifactDiagnostic(code, key, message, data))
}

function isRemoteRegistry(registry: RegistryAdapter): registry is RemoteArtifactRegistry {
  return typeof (registry as Partial<RemoteArtifactRegistry>).artifactRoute === 'function'
}

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

function canonicalUrl(raw: string): string | undefined {
  try {
    const url = new URL(stripRegistrySha1Fragment(raw))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    url.hash = ''
    return url.href
  } catch {
    return undefined
  }
}

function containsEncodedSeparator(url: URL): boolean {
  return /%2f|%5c/i.test(url.pathname)
}

function isWithinRoute(rawUrl: string, rawRegistryUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const registry = new URL(rawRegistryUrl)
    if (containsEncodedSeparator(url) || containsEncodedSeparator(registry)) return false
    if (url.username !== '' || url.password !== '') return false
    if (url.protocol !== registry.protocol || url.host !== registry.host) return false
    const base = registry.pathname.replace(/\/+$/, '')
    return url.pathname === base || url.pathname.startsWith(`${base}/`)
  } catch {
    return false
  }
}

function lockNamedUrl(payload: TarballPayload): string | undefined {
  const native = payload.nativeResolution
  if (native !== undefined && /^https?:\/\//i.test(native)) return canonicalUrl(native)
  if (native !== undefined && /(?:^|@)npm:/.test(native)) return undefined
  if (payload.berryChecksumCacheKey !== undefined) return undefined
  if (payload.resolution?.type === 'tarball'
    && payload.resolution.bind !== undefined) return undefined
  return payload.resolution?.type === 'tarball'
    ? canonicalUrl(payload.resolution.url)
    : undefined
}

interface ClaimedRoute {
  readonly registry: RemoteArtifactRegistry
  readonly route: ArtifactRoute
}

function claimedRoute(
  entries: readonly NormalizedArtifactSource[],
  name: string,
  key: TarballKey,
): ClaimedRoute {
  const claimed: ClaimedRoute[] = []
  for (const entry of entries) {
    if (entry.kind !== 'remote' || !isRemoteRegistry(entry.registry)) continue
    const route = entry.registry.artifactRoute(name)
    if (route !== undefined) claimed.push({ registry: entry.registry, route })
  }
  if (claimed.length === 0) {
    fail('ENRICH_ARTIFACT_ROUTE_MISSING', key, 'have no byte-capable registry route')
  }

  const unique = new Map<string, ClaimedRoute>()
  for (const claim of claimed) {
    const route = stripTrailingSlashes(claim.route.registryUrl)
    if (!unique.has(route)) unique.set(route, claim)
  }
  if (unique.size !== 1) {
    fail(
      'ENRICH_ARTIFACT_ROUTE_AMBIGUOUS',
      key,
      'match multiple configured registry routes; sibling fallback is disabled',
      { routes: [...unique.keys()].sort() },
    )
  }
  return unique.values().next().value!
}

async function authorizedInitialUrl(
  claim: ClaimedRoute,
  request: ArtifactTarballRequest,
  key: TarballKey,
): Promise<string> {
  const lockUrl = lockNamedUrl(request.payload)
  if (lockUrl !== undefined && isWithinRoute(lockUrl, claim.route.registryUrl)) {
    return lockUrl
  }

  let exact
  try {
    exact = await claim.registry.resolve(request.node.name, request.node.version)
  } catch (error) {
    fail(
      'ENRICH_ARTIFACT_REGISTRY_METADATA_FAILED',
      key,
      'could not obtain exact-version registry metadata',
      { cause: error instanceof Error ? error.message : String(error) },
    )
  }
  const attested = exact?.name === request.node.name
    && exact.version === request.node.version
    && exact.tarball !== undefined
    ? canonicalUrl(exact.tarball)
    : undefined

  if (lockUrl !== undefined) {
    if (new URL(lockUrl).protocol !== 'https:' || attested !== lockUrl) {
      fail(
        'ENRICH_ARTIFACT_URL_UNAUTHORIZED',
        key,
        'name an URL outside the configured route without matching exact-version HTTPS attestation',
        { url: lockUrl },
      )
    }
    return lockUrl
  }
  if (attested === undefined) {
    fail(
      'ENRICH_ARTIFACT_URL_UNAUTHORIZED',
      key,
      'have neither a lock-named route URL nor exact-version registry attestation',
    )
  }
  if (new URL(attested).protocol === 'http:' && !isWithinRoute(attested, claim.route.registryUrl)) {
    fail(
      'ENRICH_ARTIFACT_URL_UNAUTHORIZED',
      key,
      'cannot use a plaintext URL outside the explicitly configured route',
      { url: attested },
    )
  }
  return attested
}

function responseRedirect(response: Response): boolean {
  return response.status === 301
    || response.status === 302
    || response.status === 303
    || response.status === 307
    || response.status === 308
}

async function readResponseBytes(
  response: Response,
  key: TarballKey,
  limits: EffectiveArtifactResourceLimits,
  liveMeter: ArtifactLiveMeter,
  trafficMeter: ArtifactTrafficMeter,
): Promise<{ bytes: Uint8Array; release: () => void }> {
  const rawLength = response.headers.get('content-length')
  const expected = rawLength === null ? undefined : Number(rawLength)
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0)) {
    fail(
      'ENRICH_ARTIFACT_CONTENT_LENGTH_MISMATCH',
      key,
      'carry an invalid Content-Length commitment',
      { contentLength: rawLength },
    )
  }
  if (expected !== undefined) {
    assertArtifactRepresentation('compressed', expected, limits)
    trafficMeter.assertCanConsume(expected)
  }

  const chunks: Uint8Array[] = []
  const releases: Array<() => void> = []
  let received = 0
  try {
    if (response.body !== null) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value === undefined) continue
        received += value.byteLength
        assertArtifactRepresentation('compressed', received, limits)
        trafficMeter.consume(value.byteLength)
        releases.push(liveMeter.acquire(value.byteLength))
        chunks.push(value)
      }
    }
    if (expected !== undefined && received !== expected) {
      fail(
        'ENRICH_ARTIFACT_CONTENT_LENGTH_MISMATCH',
        key,
        `violated the Content-Length commitment (${expected} promised, ${received} received)`,
        { expected, received },
      )
    }
    const release = liveMeter.acquire(received)
    try {
      const out = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.byteLength
      }
      for (const releaseChunk of releases.splice(0)) releaseChunk()
      return { bytes: out, release }
    } catch (error) {
      release()
      throw error
    }
  } finally {
    for (const release of releases) release()
  }
}

async function fetchArtifact(
  claim: ClaimedRoute,
  initialUrl: string,
  key: TarballKey,
  limits: EffectiveArtifactResourceLimits,
  liveMeter: ArtifactLiveMeter,
  trafficMeter: ArtifactTrafficMeter,
): Promise<{ bytes: Uint8Array; release: () => void }> {
  let url = initialUrl
  for (let hop = 0; hop <= 5; hop++) {
    const headers: Record<string, string> = {}
    const parsed = new URL(url)
    const auth = parsed.protocol === 'https:' ? claim.route.authHeaderFor(url) : undefined
    if (auth !== undefined) headers.authorization = auth

    let response: Response
    try {
      response = await claim.route.limit(() => claim.route.fetch(url, {
        headers,
        redirect: 'manual',
      }))
    } catch (error) {
      fail(
        'ENRICH_ARTIFACT_FETCH_FAILED',
        key,
        'could not be fetched',
        { url, cause: error instanceof Error ? error.message : String(error) },
      )
    }
    if (responseRedirect(response)) {
      const location = response.headers.get('location')
      if (location === null || hop === 5) {
        fail(
          'ENRICH_ARTIFACT_REDIRECT_REJECTED',
          key,
          'encountered an invalid or overlong redirect chain',
          { url, hop },
        )
      }
      const next = canonicalUrl(new URL(location, url).href)
      if (next === undefined || !isWithinRoute(next, claim.route.registryUrl)) {
        fail(
          'ENRICH_ARTIFACT_REDIRECT_REJECTED',
          key,
          'redirect outside the configured registry route was rejected before request',
          { from: url, to: next ?? location },
        )
      }
      url = next
      continue
    }
    if (!response.ok) {
      fail(
        'ENRICH_ARTIFACT_HTTP_FAILED',
        key,
        `returned HTTP ${response.status}`,
        { url, status: response.status },
      )
    }
    return readResponseBytes(response, key, limits, liveMeter, trafficMeter)
  }
  fail('ENRICH_ARTIFACT_REDIRECT_REJECTED', key, 'exceeded the redirect bound')
}

function tarContentBytes(tar: Buffer, limits: EffectiveArtifactResourceLimits): number {
  let total = 0
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const field = header.subarray(124, 136)
    const nul = field.indexOf(0)
    const raw = field.toString('ascii', 0, nul < 0 ? field.length : nul).trim()
    const size = Number.parseInt(raw || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('invalid tar entry size')
    }
    total += size
    assertArtifactRepresentation('tar-content', total, limits)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return total
}

function validateEnvelope(
  bytes: Uint8Array,
  limits: EffectiveArtifactResourceLimits,
  liveMeter: ArtifactLiveMeter,
): void {
  assertArtifactRepresentation('compressed', bytes.byteLength, limits)
  const tar = inflateArtifact(bytes, limits)
  const releaseTar = liveMeter.acquire(tar.byteLength)
  try {
    const content = tarContentBytes(tar, limits)
    // Every valid zip has a 22-byte end record; content is a conservative lower
    // bound. The packers enforce the exact output ceiling when they materialize it.
    assertArtifactRepresentation('repacked', content + 22, limits)
  } finally {
    releaseTar()
  }
}

function translateEnvelopeError(key: TarballKey, error: unknown): never {
  if (error instanceof ArtifactEnvelopeError) {
    throw new ArtifactByteFailure(enrichArtifactLimit(
      key,
      error.representation,
      error.limitBytes,
      error.origin,
    ))
  }
  if (error instanceof ArtifactTrafficError) {
    throw new ArtifactByteFailure(enrichArtifactTrafficLimit(
      key,
      error.limitBytes,
      error.origin,
    ))
  }
  throw error
}

async function verifyIntegrity(
  bytes: Uint8Array,
  request: ArtifactTarballRequest,
  key: TarballKey,
  limits: EffectiveArtifactResourceLimits,
  liveMeter: ArtifactLiveMeter,
): Promise<void> {
  const hashes = verificationHashes(request)
  if (hashes.length === 0) {
    const sourceDigest = request.payload.integrity?.hashes.find(hash =>
      hash.algorithm === 'sha512' && hash.origin === 'berry-zip')?.digest
    const sourceCacheKey = request.payload.berryChecksumCacheKey
    if (sourceDigest !== undefined && sourceCacheKey !== undefined) {
      let reproduced: string | undefined
      if (berryCacheKeyReproducible(sourceCacheKey)) {
        let lazy: string | undefined
        let dirsFirst: string | undefined
        try {
          lazy = computeBerryChecksum(
            bytes,
            request.node.name,
            sourceCacheKey,
            false,
            limits,
            liveMeter,
          )
          dirsFirst = computeBerryChecksum(
            bytes,
            request.node.name,
            sourceCacheKey,
            true,
            limits,
            liveMeter,
          )
        } catch {
          // Unsupported source archive shape: no proof, never a silent pass.
        }
        reproduced = lazy === sourceDigest || dirsFirst === sourceDigest
          ? sourceDigest
          : lazy ?? dirsFirst
      } else {
        if (!await berryLibzipAvailable()) {
          fail(
            'ENRICH_ARTIFACT_INTEGRITY_UNSUPPORTED',
            key,
            `cannot reproduce source cacheKey ${sourceCacheKey}; install @yarnpkg/libzip to verify this lock-carried Berry checksum`,
            { sourceCacheKey, remedy: 'install-@yarnpkg/libzip' },
          )
        }
        reproduced = await computeBerryChecksumViaLibzip(
          bytes,
          request.node.name,
          sourceCacheKey,
          limits,
          liveMeter,
        )
        if (reproduced === undefined) {
          fail(
            'ENRICH_ARTIFACT_INTEGRITY_UNSUPPORTED',
            key,
            `cannot reproduce the lock-carried Berry checksum for source cacheKey ${sourceCacheKey}`,
            { sourceCacheKey },
          )
        }
      }
      if (reproduced !== sourceDigest) {
        fail(
          'ENRICH_ARTIFACT_INTEGRITY_MISMATCH',
          key,
          `failed source cacheKey ${sourceCacheKey} Berry checksum verification before target repack`,
          { sourceCacheKey, expected: sourceDigest, actual: reproduced },
        )
      }
      return
    }
    fail(
      'ENRICH_ARTIFACT_INTEGRITY_MISSING',
      key,
      'have no lock-recorded tarball integrity; returned bytes were not recomputed',
    )
  }

  const supported = hashes.filter(hash =>
    hash.algorithm === 'sha1'
    || hash.algorithm === 'sha256'
    || hash.algorithm === 'sha384'
    || hash.algorithm === 'sha512')
  if (supported.length === 0) {
    fail(
      'ENRICH_ARTIFACT_INTEGRITY_UNSUPPORTED',
      key,
      'carry only unsupported lock integrity algorithms',
      { algorithms: [...new Set(hashes.map(hash => hash.algorithm))] },
    )
  }
  for (const hash of supported) {
    const actual = createHash(hash.algorithm).update(bytes).digest('hex')
    if (actual !== hash.digest) {
      fail(
        'ENRICH_ARTIFACT_INTEGRITY_MISMATCH',
        key,
        `failed ${hash.algorithm} verification before recompute`,
        { algorithm: hash.algorithm, expected: hash.digest, actual },
      )
    }
  }
}

interface VerificationHash {
  readonly algorithm: string
  readonly digest: string
  readonly origin: string
}

function verificationHashes(
  request: ArtifactTarballRequest,
): VerificationHash[] {
  const hashes: VerificationHash[] = [...(request.payload.integrity?.hashes
    .filter(hash => hash.origin !== 'berry-zip') ?? [])]
  const rawResolution = request.payload.nativeResolution
    ?? (request.payload.resolution?.type === 'tarball'
      ? request.payload.resolution.url
      : undefined)
  const fragment = rawResolution !== undefined
    ? /\.tgz#([0-9a-f]{40})$/i.exec(rawResolution)?.[1]?.toLowerCase()
    : undefined
  if (fragment !== undefined && !hashes.some(hash =>
    hash.algorithm === 'sha1' && hash.digest === fragment)) {
    hashes.push({ algorithm: 'sha1', digest: fragment, origin: 'url-fragment' })
  }
  return hashes
}

const algorithmPriority: Record<ArtifactStoreAlias['algorithm'], number> = {
  sha512: 0,
  sha384: 1,
  sha256: 2,
  sha1: 3,
}

function artifactStoreEvidence(
  request: ArtifactTarballRequest,
): ArtifactStoreEvidence {
  const aliases: ArtifactStoreAlias[] = []
  for (const hash of verificationHashes(request)) {
    if (hash.algorithm !== 'sha1'
      && hash.algorithm !== 'sha256'
      && hash.algorithm !== 'sha384'
      && hash.algorithm !== 'sha512') continue
    aliases.push({
      namespace: 'tarball',
      algorithm: hash.algorithm,
      digest: hash.digest,
    })
  }
  const sourceDigest = request.payload.integrity?.hashes.find(hash =>
    hash.algorithm === 'sha512' && hash.origin === 'berry-zip')?.digest
  const sourceCacheKey = request.payload.berryChecksumCacheKey
  if (sourceDigest !== undefined && sourceCacheKey !== undefined) {
    aliases.push({
      namespace: 'berry-zip',
      algorithm: 'sha512',
      digest: sourceDigest,
      cacheKey: sourceCacheKey,
    })
  }
  const unique = new Map<string, ArtifactStoreAlias>()
  for (const alias of aliases) {
    const key = alias.namespace === 'berry-zip'
      ? `${alias.namespace}:${alias.cacheKey}:${alias.algorithm}:${alias.digest}`
      : `${alias.namespace}:${alias.algorithm}:${alias.digest}`
    if (!unique.has(key)) unique.set(key, alias)
  }
  return {
    aliases: Object.freeze([...unique.values()].sort((left, right) => {
      const priority = algorithmPriority[left.algorithm]
        - algorithmPriority[right.algorithm]
      if (priority !== 0) return priority
      if (left.namespace !== right.namespace) {
        return left.namespace === 'tarball' ? -1 : 1
      }
      return left.digest.localeCompare(right.digest)
    })),
  }
}

async function settleHit(
  action: () => Promise<void>,
  key: TarballKey,
  onDiagnostic: (diagnostic: Diagnostic) => void,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    onDiagnostic(enrichArtifactDiagnostic(
      'ENRICH_ARTIFACT_STORE_READ_FAILED',
      key,
      'could not settle an artifact-store pin; stale coordination will be recovered later',
      { cause: error instanceof Error ? error.message : String(error) },
    ))
  }
}

async function writeBack(
  artifacts: NormalizedArtifactSources,
  request: ArtifactTarballRequest,
  bytes: Uint8Array,
  onDiagnostic: (diagnostic: Diagnostic) => void,
  beforeMutation: () => void,
): Promise<void> {
  if (artifacts.store === undefined) return
  if (bytes.byteLength <= artifacts.store.maxBytes) beforeMutation()
  await writeArtifactStore(
    artifacts.store,
    artifactStoreEvidence(request),
    bytes,
    toTarballKey(request.node),
    onDiagnostic,
  )
}

async function checkedStoreHit(
  store: ArtifactStoreSource,
  request: ArtifactTarballRequest,
  policy: ArtifactResourcePolicy | undefined,
  liveMeter: ArtifactLiveMeter,
  onDiagnostic: (diagnostic: Diagnostic) => void,
  beforeMutation: () => void,
): Promise<{ bytes: Uint8Array; release: () => void } | undefined> {
  const key = toTarballKey(request.node)
  const limits = artifactResourceLimits(policy, key)
  const evidence = artifactStoreEvidence(request)
  if (evidence.aliases.length === 0) return undefined
  beforeMutation()
  let hit
  while (true) {
    hit = await readArtifactStore(
      store,
      evidence,
      key,
      onDiagnostic,
      Math.min(limits.maxCompressedBytes, liveMeter.remainingBytes),
    )
    if (hit === undefined) return undefined
    if (!('exceededBytes' in hit)) break
    try {
      assertArtifactRepresentation('compressed', hit.exceededBytes, limits)
      const release = liveMeter.acquire(hit.exceededBytes)
      release()
    } catch (error) {
      translateEnvelopeError(key, error)
    }
    // Capacity may have become available after the store stat. Re-open under
    // the current meter instead of materializing past the earlier reservation.
  }
  try {
    const leased = await checked(hit.bytes, request, policy, liveMeter)
    await settleHit(() => hit.accept(), key, onDiagnostic)
    return leased
  } catch (error) {
    if (hit.viaAlias) {
      await settleHit(() => hit.rejectAlias(), key, onDiagnostic)
      return undefined
    }
    await settleHit(() => hit.release(), key, onDiagnostic)
    throw error
  }
}

async function checked(
  input: Uint8Array | { bytes: Uint8Array; release: () => void },
  request: ArtifactTarballRequest,
  policy: ArtifactResourcePolicy | undefined,
  liveMeter: ArtifactLiveMeter,
): Promise<{ bytes: Uint8Array; release: () => void }> {
  const key = toTarballKey(request.node)
  const limits = artifactResourceLimits(policy, key)
  let leased: { bytes: Uint8Array; release: () => void }
  try {
    leased = input instanceof Uint8Array
      ? { bytes: input, release: liveMeter.acquire(input.byteLength) }
      : input
  } catch (error) {
    translateEnvelopeError(key, error)
  }
  const { bytes } = leased
  try {
    validateEnvelope(bytes, limits, liveMeter)
    await verifyIntegrity(bytes, request, key, limits, liveMeter)
  } catch (error) {
    leased.release()
    translateEnvelopeError(key, error)
  }
  return leased
}

function npmTarballCapability(
  entry: NormalizedArtifactSource,
): NpmTarballSource | undefined {
  if (entry.kind !== 'cache' || entry.family !== 'npm') return undefined
  const candidate = entry.cache as Partial<NpmTarballSource>
  return typeof candidate.tarball === 'function'
    ? candidate as NpmTarballSource
    : undefined
}

export function artifactTarballSource(
  artifacts: NormalizedArtifactSources,
  policy: ArtifactResourcePolicy | undefined,
  onDiagnostic: (diagnostic: Diagnostic) => void = () => {},
  traffic: Readonly<{
    maxBytes: number
    origin: 'default' | 'global'
  }> = {
    maxBytes: DEFAULT_ARTIFACT_MAX_NETWORK_TRAFFIC_BYTES,
    origin: 'default',
  },
): RequestNpmTarballSource {
  const fallback = artifacts.refurbish.npmTarballs
  const liveMeter = new ArtifactLiveMeter(policy)
  const trafficMeter = new ArtifactTrafficMeter(traffic.maxBytes, traffic.origin)
  let storePathReported = false
  const beforeStoreMutation = (): void => {
    if (storePathReported || artifacts.store === undefined) return
    storePathReported = true
    onDiagnostic({
      code: 'STORE_PATH_RESOLVED',
      severity: 'info',
      message: `store: resolved persistence path ${artifacts.store.path}`,
      data: { path: artifacts.store.path },
    })
  }
  const leases = new WeakMap<Uint8Array, Array<() => void>>()
  const retain = (leased: { bytes: Uint8Array; release: () => void }): Uint8Array => {
    const pending = leases.get(leased.bytes) ?? []
    pending.push(leased.release)
    leases.set(leased.bytes, pending)
    return leased.bytes
  }
  const source: RequestNpmTarballSource = {
    liveMeter,
    tarball(name: string, version: string) {
      return fallback.tarball(name, version)
    },
    releaseTarball(bytes: Uint8Array) {
      const pending = leases.get(bytes)
      const release = pending?.shift()
      release?.()
      if (pending?.length === 0) leases.delete(bytes)
    },
    async tarballFor(request: ArtifactTarballRequest) {
      const key = toTarballKey(request.node)
      if (artifacts.store !== undefined) {
        const leased = await checkedStoreHit(
          artifacts.store,
          request,
          policy,
          liveMeter,
          onDiagnostic,
          beforeStoreMutation,
        )
        if (leased !== undefined) return retain(leased)
      }
      if (artifacts.entries.length === 0) {
        const bytes = await fallback.tarball(request.node.name, request.node.version)
        if (bytes === undefined) return undefined
        const leased = await checked(bytes, request, policy, liveMeter)
        await writeBack(
          artifacts,
          request,
          leased.bytes,
          onDiagnostic,
          beforeStoreMutation,
        )
        return retain(leased)
      }

      let remotesVisited = false
      for (const entry of artifacts.entries) {
        const cache = npmTarballCapability(entry)
        if (cache !== undefined) {
          const bytes = await cache.tarball(request.node.name, request.node.version)
          if (bytes !== undefined) {
            const leased = await checked(bytes, request, policy, liveMeter)
            await writeBack(
              artifacts,
              request,
              leased.bytes,
              onDiagnostic,
              beforeStoreMutation,
            )
            return retain(leased)
          }
          continue
        }
        if (entry.kind !== 'remote' || remotesVisited) continue
        remotesVisited = true
        const claim = claimedRoute(artifacts.entries, request.node.name, key)
        const url = await authorizedInitialUrl(claim, request, key)
        const limits = artifactResourceLimits(policy, key)
        let leased: { bytes: Uint8Array; release: () => void }
        try {
          leased = await fetchArtifact(
            claim,
            url,
            key,
            limits,
            liveMeter,
            trafficMeter,
          )
        } catch (error) {
          translateEnvelopeError(key, error)
        }
        const checkedBytes = await checked(leased, request, policy, liveMeter)
        await writeBack(
          artifacts,
          request,
          checkedBytes.bytes,
          onDiagnostic,
          beforeStoreMutation,
        )
        return retain(checkedBytes)
      }
      return undefined
    },
  }
  return Object.freeze(source)
}
