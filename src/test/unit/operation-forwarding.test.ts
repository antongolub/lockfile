import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  convert,
  enrich,
  parse,
  stringify,
  type Diagnostic,
} from '../../main/ts/index.ts'
import type {
  Packument,
  PackumentVersion,
  RegistryAdapter,
} from '../../main/ts/registry/types.ts'
import type { ArtifactSourceList } from '../../main/ts/enrich/artifact-sources.ts'

const roots: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function tarballOf(text = 'module.exports = 1\n'): Uint8Array {
  const body = Buffer.from(text)
  const header = Buffer.alloc(512)
  header.write('package/index.js', 0, 'utf8')
  header.write('0000644\0', 100, 'ascii')
  header.write('0000000\0', 108, 'ascii')
  header.write('0000000\0', 116, 'ascii')
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  header.write('00000000000\0', 136, 'ascii')
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512)
  return new Uint8Array(gzipSync(Buffer.concat([
    header,
    body,
    padding,
    Buffer.alloc(1024),
  ])))
}

function sri(bytes: Uint8Array): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

function npmLock(
  bytes: Uint8Array,
  resolved = 'https://registry.test/npm/pkg/-/pkg-1.0.0.tgz',
): string {
  return `${JSON.stringify({
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'fixture',
        version: '1.0.0',
        dependencies: { pkg: '1.0.0' },
      },
      'node_modules/pkg': {
        version: '1.0.0',
        resolved,
        integrity: sri(bytes),
      },
    },
  }, null, 2)}\n`
}

function yarnWorkspace(zip: Uint8Array): Readonly<{
  root: string
  cache: string
}> {
  const root = mkdtempSync(resolve(tmpdir(), 'lockgraph-operation-forwarding-'))
  roots.push(root)
  const cache = resolve(root, '.yarn', 'cache')
  mkdirSync(cache, { recursive: true })
  writeFileSync(resolve(cache, 'pkg-npm-1.0.0-aaaaaaaaaa-10c0.zip'), zip)
  return { root, cache }
}

function remote(bytes: Uint8Array): Readonly<{
  registry: RegistryAdapter
  fetch: ReturnType<typeof vi.fn>
}> {
  const tarball = 'https://registry.test/npm/pkg/-/pkg-1.0.0.tgz'
  const version: PackumentVersion = {
    name: 'pkg',
    version: '1.0.0',
    tarball,
  }
  const packument: Packument = {
    name: 'pkg',
    distTags: {},
    versions: { '1.0.0': version },
  }
  const fetchSpy = vi.fn(async () => new Response(bytes))
  const registry: RegistryAdapter & Record<string, unknown> = {
    async packument() { return packument },
    async resolve() { return version },
    artifactRoute(name: string) {
      return {
        registryUrl: 'https://registry.test/npm',
        fetch: fetchSpy as unknown as typeof fetch,
        authHeaderFor: () => undefined,
        limit: <T,>(task: () => Promise<T>) => task(),
        name,
      }
    },
  }
  return { registry, fetch: fetchSpy }
}

function graphOutput(result: Awaited<ReturnType<typeof enrich>>): string {
  return stringify('yarn-berry-v8', result.graph, { strict: false })
}

async function direct(
  lockfile: string,
  artifacts: ArtifactSourceList,
  workspaceRoot?: string,
) {
  return enrich(parse('npm-3', lockfile), {
    sources: { artifacts },
    target: 'yarn-berry-v8',
    contract: 'snapshot',
    cacheKey: '10c0',
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  })
}

describe('operation option forwarding', () => {
  it('direct enrich resolves bare yarn-berry from workspaceRoot', async () => {
    vi.stubEnv('YARN_CACHE_FOLDER', '')
    const bytes = tarballOf()
    const workspace = yarnWorkspace(new Uint8Array([1, 2, 3, 4, 5]))
    const lockfile = npmLock(bytes)

    const bare = await direct(lockfile, ['yarn-berry'], workspace.root)
    const explicit = await direct(lockfile, [`yarn-berry:${workspace.cache}`])

    expect(graphOutput(bare)).toBe(graphOutput(explicit))
  })

  it('direct bare and explicit yarn-berry sources have identical diagnostics', async () => {
    vi.stubEnv('YARN_CACHE_FOLDER', '')
    const bytes = tarballOf()
    const workspace = yarnWorkspace(new Uint8Array([5, 4, 3, 2, 1]))
    const lockfile = npmLock(bytes)

    const bare = await direct(lockfile, ['yarn-berry'], workspace.root)
    const explicit = await direct(lockfile, [`yarn-berry:${workspace.cache}`])

    expect(bare.diagnostics).toEqual(explicit.diagnostics)
  })

  it('direct project-cache evidence prevents a cold remote fetch', async () => {
    vi.stubEnv('YARN_CACHE_FOLDER', '')
    const bytes = tarballOf()
    const workspace = yarnWorkspace(new Uint8Array([9, 8, 7, 6]))
    const cold = remote(bytes)

    await direct(
      npmLock(bytes),
      ['yarn-berry', { registry: cold.registry }],
      workspace.root,
    )

    expect(cold.fetch).not.toHaveBeenCalled()
  })

  it('convert forwards workspaceRoot to bare yarn-berry without a cold fetch', async () => {
    vi.stubEnv('YARN_CACHE_FOLDER', '')
    const bytes = tarballOf()
    const workspace = yarnWorkspace(new Uint8Array([6, 7, 8, 9]))
    const cold = remote(bytes)
    const lockfile = npmLock(bytes)
    const bare = await convert(lockfile, {
      target: 'yarn-berry-v8',
      strict: false,
      workspaceRoot: workspace.root,
      cacheKey: '10c0',
      sources: {
        artifacts: ['yarn-berry', { registry: cold.registry }],
      },
    })
    const explicit = await convert(lockfile, {
      target: 'yarn-berry-v8',
      strict: false,
      cacheKey: '10c0',
      sources: { artifacts: [`yarn-berry:${workspace.cache}`] },
    })

    expect(bare).toBe(explicit)
    expect(cold.fetch).not.toHaveBeenCalled()
  })

  it('convert forwards the global artifact resource ceiling', async () => {
    const bytes = tarballOf()
    const diagnostics: Diagnostic[] = []

    await convert(npmLock(bytes), {
      target: 'yarn-berry-v8',
      strict: false,
      cacheKey: '10c0',
      sources: {
        artifacts: {
          npmTarballs: { async tarball() { return bytes } },
        },
      },
      artifactResources: { defaults: { maxCompressedBytes: 1 } },
      onDiagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic),
    })

    expect(diagnostics.map(diagnostic => diagnostic.code))
      .toContain('ENRICH_ARTIFACT_COMPRESSED_LIMIT')
  })

  it('convert forwards an exact-artifact resource override', async () => {
    const bytes = tarballOf()
    const diagnostics: Diagnostic[] = []
    const lockfile = npmLock(
      bytes,
      'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',
    )
    const keys = [...parse('npm-3', lockfile).tarballs()].map(([key]) => key)
    expect(keys).toEqual(['pkg@1.0.0'])
    const key = keys[0]!

    await convert(lockfile, {
      target: 'yarn-berry-v8',
      strict: false,
      cacheKey: '10c0',
      sources: {
        artifacts: {
          npmTarballs: { async tarball() { return bytes } },
        },
      },
      artifactResources: {
        defaults: { maxCompressedBytes: bytes.byteLength + 1 },
        overrides: { [key]: { maxCompressedBytes: 1 } },
      },
      onDiagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic),
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'ENRICH_ARTIFACT_COMPRESSED_LIMIT',
      subject: key,
    }))
  })
})
