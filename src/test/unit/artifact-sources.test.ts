import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  artifactStore,
  DEFAULT_ARTIFACT_STORE_MAX_BYTES,
} from '../../main/ts/enrich/artifact-store.ts'
import {
  normalizeArtifactSources,
  type ArtifactSourceList,
} from '../../main/ts/enrich/artifact-sources.ts'
import type { RefurbishSources, TarballSource } from '../../main/ts/enrich/refurbish.ts'
import type { RegistryAdapter, RemoteArtifactRegistry } from '../../main/ts/registry/types.ts'

const dirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function freshDir(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function npmCacheWith(
  name: string,
  version: string,
  bytes: Uint8Array,
  suffix = '',
): string {
  const cacheDir = freshDir(`lockgraph-artifact-npm${suffix}-`)
  const digest = createHash('sha512').update(bytes).digest()
  const integrity = `sha512-${digest.toString('base64')}`
  const key = `make-fetch-happen:request-cache:https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`
  const bucketHash = createHash('sha256').update(key).digest('hex')
  const bucketDir = resolve(
    cacheDir,
    'index-v5',
    bucketHash.slice(0, 2),
    bucketHash.slice(2, 4),
  )
  mkdirSync(bucketDir, { recursive: true })
  const record = JSON.stringify({ key, integrity, time: 1, size: bytes.byteLength })
  writeFileSync(
    resolve(bucketDir, bucketHash.slice(4)),
    `\n${createHash('sha1').update(record).digest('hex')}\t${record}`,
  )
  const hex = digest.toString('hex')
  const contentDir = resolve(
    cacheDir,
    'content-v2',
    'sha512',
    hex.slice(0, 2),
    hex.slice(2, 4),
  )
  mkdirSync(contentDir, { recursive: true })
  writeFileSync(resolve(contentDir, hex.slice(4)), bytes)
  return cacheDir
}

function yarnCacheWith(
  name: string,
  version: string,
  cacheKey: string,
  bytes: Uint8Array,
): string {
  const cacheDir = freshDir('lockgraph-artifact-yarn-')
  writeFileSync(
    resolve(cacheDir, `${name}-npm-${version}-aaaaaaaaaa-${cacheKey}.zip`),
    bytes,
  )
  return cacheDir
}

describe('enrich/artifact-sources — three accepted shapes', () => {
  it('resolves the explicit and XDG-aware artifact-store paths eagerly', () => {
    const xdg = freshDir('lockgraph-artifact-xdg-')
    vi.stubEnv('XDG_CACHE_HOME', xdg)
    expect(artifactStore()).toEqual({
      kind: 'lockgraph-artifact-store',
      path: resolve(xdg, 'lockgraph'),
      maxBytes: DEFAULT_ARTIFACT_STORE_MAX_BYTES,
    })

    const explicit = resolve(freshDir('lockgraph-artifact-explicit-'), 'project-store')
    expect(artifactStore({ path: explicit, maxBytes: 123 })).toEqual({
      kind: 'lockgraph-artifact-store',
      path: explicit,
      maxBytes: 123,
    })
  })

  it('ignores a relative XDG cache root and falls back to the user cache', () => {
    vi.stubEnv('XDG_CACHE_HOME', 'relative-cache')
    expect(artifactStore().path).toBe(resolve(homedir(), '.cache', 'lockgraph'))
  })

  it('fails eagerly on invalid artifact-store options', () => {
    expect(() => artifactStore({ path: '' })).toThrow(/path/)
    expect(() => artifactStore({ maxBytes: 0 })).toThrow(/maxBytes/)
    expect(() => artifactStore({ maxBytes: Number.POSITIVE_INFINITY }))
      .toThrow(/maxBytes/)
    expect(() => artifactStore({ path: resolve('/') })).toThrow(/filesystem root/)
  })

  it('preserves both capabilities of a bare legacy TarballSource', async () => {
    const tarball = vi.fn(async () => new Uint8Array([1]))
    const berryChecksum = vi.fn(async () => 'a'.repeat(128))
    const legacy: TarballSource = { tarball, berryChecksum }

    const normalized = normalizeArtifactSources(legacy)

    expect(await normalized.refurbish.npmTarballs.tarball('pkg', '1.0.0'))
      .toEqual(new Uint8Array([1]))
    expect(await normalized.refurbish.yarnBerryChecksums!
      .berryChecksum('pkg', '1.0.0', '10c0')).toBe('a'.repeat(128))
    expect(normalized.caches).toEqual([])
    expect(normalized.remotes).toEqual([])
    expect(normalized.entries).toEqual([])
  })

  it('preserves both lanes of split RefurbishSources', () => {
    const split: RefurbishSources = {
      npmTarballs: { async tarball() { return undefined } },
      yarnBerryChecksums: { async berryChecksum() { return undefined } },
    }
    const normalized = normalizeArtifactSources(split)

    expect(normalized.refurbish.npmTarballs).toBe(split.npmTarballs)
    expect(normalized.refurbish.yarnBerryChecksums).toBe(split.yarnBerryChecksums)
  })

  it('routes npm:path tgz bytes and preserves a second colon in the path', async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0xaa])
    const cacheDir = npmCacheWith('pkg', '1.0.0', bytes, ':colon')
    const normalized = normalizeArtifactSources([`npm:${cacheDir}`])

    expect(await normalized.refurbish.npmTarballs.tarball('pkg', '1.0.0'))
      .toEqual(bytes)
    expect(normalized.caches).toHaveLength(1)
  })

  it('accepts every byte-capable default family without probing during normalization', () => {
    const normalized = normalizeArtifactSources(['npm', 'yarn-berry'])

    expect(normalized.entries.map(entry =>
      entry.kind === 'cache' ? entry.family : entry.kind))
      .toEqual(['npm', 'yarn-berry'])
    expect(normalized.caches).toHaveLength(2)
  })

  it('routes yarn-berry:path checksum evidence without inventing npm bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const cacheDir = yarnCacheWith('pkg', '1.0.0', '10c0', bytes)
    const normalized = normalizeArtifactSources([`yarn-berry:${cacheDir}`])

    expect(await normalized.refurbish.yarnBerryChecksums!
      .berryChecksum('pkg', '1.0.0', '10c0'))
      .toBe(createHash('sha512').update(bytes).digest('hex'))
    expect(await normalized.refurbish.npmTarballs.tarball('pkg', '1.0.0'))
      .toBeUndefined()
  })

  it('rejects pnpm because it supplies neither retained tgz nor lock-carried checksum', () => {
    const storeDir = freshDir('lockgraph-artifact-pnpm-')
    expect(() => normalizeArtifactSources([`pnpm:${storeDir}`]))
      .toThrow(/retained registry tarball.*lock-carried archive checksum/i)
  })

  it('queries same-capability caches in declared order and stops on the first hit', async () => {
    const miss = freshDir('lockgraph-artifact-npm-miss-')
    const wanted = new Uint8Array([9, 8, 7])
    const hit = npmCacheWith('pkg', '1.0.0', wanted)
    const after = npmCacheWith('pkg', '1.0.0', new Uint8Array([6, 5, 4]))
    const normalized = normalizeArtifactSources([
      `npm:${miss}`,
      `npm:${hit}`,
      `npm:${after}`,
    ])

    expect(await normalized.refurbish.npmTarballs.tarball('pkg', '1.0.0'))
      .toEqual(wanted)
  })

  it('retains ordered remote registry adapters without calling them', () => {
    const first: RemoteArtifactRegistry = {
      packument: vi.fn(async () => undefined),
      resolve: vi.fn(async () => undefined),
      artifactRoute: vi.fn(() => undefined),
    }
    const second: RemoteArtifactRegistry = {
      packument: vi.fn(async () => undefined),
      resolve: vi.fn(async () => undefined),
      artifactRoute: vi.fn(() => undefined),
    }
    const cacheDir = freshDir('lockgraph-artifact-remote-order-')
    const list: ArtifactSourceList = [
      `npm:${cacheDir}`,
      first,
      `yarn-berry:${cacheDir}`,
      second,
    ] as never

    const normalized = normalizeArtifactSources(list)

    expect(normalized.remotes).toEqual([first, second])
    expect(normalized.entries.map(entry => entry.kind))
      .toEqual(['cache', 'remote', 'cache', 'remote'])
    expect(first.packument).not.toHaveBeenCalled()
    expect(first.resolve).not.toHaveBeenCalled()
    expect(second.packument).not.toHaveBeenCalled()
    expect(second.resolve).not.toHaveBeenCalled()
  })

  it.each([
    [['nmp']],
    [['npm:']],
    [[{ registry: {} }]],
    [[{
      packument: async () => undefined,
      resolve: async () => undefined,
    }]],
    [[42]],
  ])('fails closed on malformed list %j', (value) => {
    expect(() => normalizeArtifactSources(value as never))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })
})
