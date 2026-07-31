import { gunzipSync } from 'node:zlib'
import type { TarballKey } from '../graph.ts'

export type ArtifactRepresentation =
  | 'compressed'
  | 'inflated'
  | 'tar-content'
  | 'repacked'
  | 'live'

export interface ArtifactResourceLimits {
  readonly maxCompressedBytes: number
  readonly maxInflatedBytes: number
  readonly maxTarContentBytes: number
  readonly maxRepackedBytes: number
}

export interface ArtifactResourcePolicy {
  readonly defaults?: Partial<ArtifactResourceLimits>
  readonly overrides?: Readonly<Record<TarballKey, Partial<ArtifactResourceLimits>>>
  readonly maxLiveBytes?: number
}

export type ArtifactLimitOrigin = 'default' | 'global' | 'artifact'

export interface EffectiveArtifactResourceLimits extends ArtifactResourceLimits {
  readonly maxLiveBytes: number
  readonly origins: Readonly<Record<ArtifactRepresentation, ArtifactLimitOrigin>>
}

export const DEFAULT_ARTIFACT_RESOURCE_LIMITS: Readonly<ArtifactResourceLimits> = Object.freeze({
  maxCompressedBytes: 384 * 1024 * 1024,
  maxInflatedBytes: 3 * 1024 * 1024 * 1024,
  maxTarContentBytes: 3 * 1024 * 1024 * 1024,
  maxRepackedBytes: 3 * 1024 * 1024 * 1024,
})

export const DEFAULT_ARTIFACT_MAX_LIVE_BYTES = 7 * 1024 * 1024 * 1024
export const DEFAULT_ARTIFACT_MAX_NETWORK_TRAFFIC_BYTES = 5 * 1024 * 1024 * 1024

const fieldOf = (representation: Exclude<ArtifactRepresentation, 'live'>): keyof ArtifactResourceLimits => {
  if (representation === 'compressed') return 'maxCompressedBytes'
  if (representation === 'inflated') return 'maxInflatedBytes'
  if (representation === 'tar-content') return 'maxTarContentBytes'
  return 'maxRepackedBytes'
}

function validLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

export function artifactMaxLiveBytes(
  policy: ArtifactResourcePolicy | undefined,
): number {
  return validLimit(policy?.maxLiveBytes, DEFAULT_ARTIFACT_MAX_LIVE_BYTES)
}

/** Operation-wide accounting for materialized artifact representations. */
export class ArtifactLiveMeter {
  readonly limitBytes: number
  readonly origin: ArtifactLimitOrigin
  #liveBytes = 0

  constructor(policy: ArtifactResourcePolicy | undefined) {
    this.limitBytes = artifactMaxLiveBytes(policy)
    this.origin = policy?.maxLiveBytes === undefined ? 'default' : 'global'
  }

  acquire(bytes: number): () => void {
    const next = this.#liveBytes + bytes
    if (!Number.isSafeInteger(bytes) || bytes < 0 || next > this.limitBytes) {
      throw new ArtifactEnvelopeError(
        'live',
        next,
        this.limitBytes,
        this.origin,
      )
    }
    this.#liveBytes = next
    let released = false
    return () => {
      if (released) return
      released = true
      this.#liveBytes -= bytes
    }
  }

  get remainingBytes(): number {
    return this.limitBytes - this.#liveBytes
  }
}

export class ArtifactTrafficError extends Error {
  readonly actualBytes: number
  readonly limitBytes: number
  readonly origin: ArtifactLimitOrigin

  constructor(actualBytes: number, limitBytes: number, origin: ArtifactLimitOrigin) {
    super(`artifact network traffic exceeds ${limitBytes} bytes`)
    this.name = 'ArtifactTrafficError'
    this.actualBytes = actualBytes
    this.limitBytes = limitBytes
    this.origin = origin
  }
}

/** Atomic, operation-wide accounting for HTTP response-body bytes. */
export class ArtifactTrafficMeter {
  readonly limitBytes: number
  readonly origin: ArtifactLimitOrigin
  #consumedBytes = 0

  constructor(
    limitBytes = DEFAULT_ARTIFACT_MAX_NETWORK_TRAFFIC_BYTES,
    origin: ArtifactLimitOrigin = 'default',
  ) {
    this.limitBytes = limitBytes
    this.origin = origin
  }

  assertCanConsume(bytes: number): void {
    this.#assert(this.#consumedBytes + bytes)
  }

  consume(bytes: number): void {
    const next = this.#consumedBytes + bytes
    this.#assert(next)
    this.#consumedBytes = next
  }

  #assert(next: number): void {
    if (!Number.isSafeInteger(next) || next < 0 || next > this.limitBytes) {
      throw new ArtifactTrafficError(next, this.limitBytes, this.origin)
    }
  }
}

export function artifactResourceLimits(
  policy: ArtifactResourcePolicy | undefined,
  tarballKey: TarballKey,
): EffectiveArtifactResourceLimits {
  const global = policy?.defaults
  const artifact = policy?.overrides?.[tarballKey]
  const values = { ...DEFAULT_ARTIFACT_RESOURCE_LIMITS }
  const origins: Record<ArtifactRepresentation, ArtifactLimitOrigin> = {
    compressed: 'default',
    inflated: 'default',
    'tar-content': 'default',
    repacked: 'default',
    live: 'default',
  }

  for (const representation of ['compressed', 'inflated', 'tar-content', 'repacked'] as const) {
    const field = fieldOf(representation)
    if (global?.[field] !== undefined) {
      values[field] = validLimit(global[field], values[field])
      origins[representation] = 'global'
    }
    if (artifact?.[field] !== undefined) {
      values[field] = validLimit(artifact[field], values[field])
      origins[representation] = 'artifact'
    }
  }

  const maxLiveBytes = artifactMaxLiveBytes(policy)
  if (policy?.maxLiveBytes !== undefined) origins.live = 'global'
  return Object.freeze({ ...values, maxLiveBytes, origins: Object.freeze(origins) })
}

export class ArtifactEnvelopeError extends Error {
  readonly representation: ArtifactRepresentation
  readonly actualBytes: number
  readonly limitBytes: number
  readonly origin: ArtifactLimitOrigin

  constructor(
    representation: ArtifactRepresentation,
    actualBytes: number,
    limitBytes: number,
    origin: ArtifactLimitOrigin,
  ) {
    super(`artifact ${representation} representation exceeds ${limitBytes} bytes`)
    this.name = 'ArtifactEnvelopeError'
    this.representation = representation
    this.actualBytes = actualBytes
    this.limitBytes = limitBytes
    this.origin = origin
  }
}

export function assertArtifactRepresentation(
  representation: ArtifactRepresentation,
  actualBytes: number,
  limits: EffectiveArtifactResourceLimits,
): void {
  const limit = representation === 'live'
    ? limits.maxLiveBytes
    : limits[fieldOf(representation)]
  if (actualBytes > limit) {
    throw new ArtifactEnvelopeError(
      representation,
      actualBytes,
      limit,
      limits.origins[representation],
    )
  }
}

/** Inflate one tgz representation under the shared fail-closed envelope. */
export function inflateArtifact(
  bytes: Uint8Array,
  limits?: EffectiveArtifactResourceLimits,
): Buffer {
  let inflated: Buffer
  try {
    inflated = gunzipSync(Buffer.from(bytes), limits === undefined
      ? undefined
      : { maxOutputLength: limits.maxInflatedBytes })
  } catch (error) {
    if (limits === undefined) throw error
    throw new ArtifactEnvelopeError(
      'inflated',
      limits.maxInflatedBytes + 1,
      limits.maxInflatedBytes,
      limits.origins.inflated,
    )
  }
  if (limits !== undefined) {
    assertArtifactRepresentation('inflated', inflated.byteLength, limits)
  }
  return inflated
}
