import { createHash } from 'node:crypto'
import {
  existsSync,
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
} from '../../main/ts/index.ts'
import type { Diagnostic } from '../../main/ts/graph.ts'
import type {
  Packument,
  PackumentVersion,
  RegistryAdapter,
  RemoteArtifactRegistry,
} from '../../main/ts/registry/types.ts'
import type { ArtifactSourceList } from '../../main/ts/enrich/artifact-sources.ts'
import { lockgraphStore } from '../../main/ts/enrich/artifact-store.ts'

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

function freshRoot(prefix: string): string {
  const root = mkdtempSync(resolve(tmpdir(), prefix))
  roots.push(root)
  return root
}

function remote(bytes: Uint8Array): Readonly<{
  registry: RemoteArtifactRegistry
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
  const registry: RemoteArtifactRegistry = {
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
    store: false,
    sources: { artifacts },
    target: 'yarn-berry-v8',
    contract: 'snapshot',
    cacheKey: '10c0',
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
  })
}

describe('operation option forwarding', () => {
  it('convert forwards a custom store and reproduces source-absent bytes', async () => {
    const root = resolve(freshRoot('lockgraph-operation-store-'), 'store')
    const store = lockgraphStore(root)
    const bytes = tarballOf()
    const route = remote(bytes)
    const freshDiagnostics: Diagnostic[] = []
    const hitDiagnostics: Diagnostic[] = []
    const fresh = await convert(npmLock(bytes), {
      store,
      target: 'yarn-berry-v8',
      strict: false,
      cacheKey: '10c0',
      sources: { artifacts: [route.registry] },
      onDiagnostic: (diagnostic: Diagnostic) => freshDiagnostics.push(diagnostic),
    })
    const hit = await convert(npmLock(bytes), {
      store,
      target: 'yarn-berry-v8',
      strict: false,
      cacheKey: '10c0',
      onDiagnostic: (diagnostic: Diagnostic) => hitDiagnostics.push(diagnostic),
    })
    expect(hit).toBe(fresh)
    expect(hitDiagnostics).toEqual(freshDiagnostics)
  })

  it('convert forwards store:false without persistence or path notification', async () => {
    const xdg = freshRoot('lockgraph-operation-store-disabled-')
    vi.stubEnv('XDG_CACHE_HOME', xdg)
    const bytes = tarballOf()
    const diagnostics: Diagnostic[] = []
    await convert(npmLock(bytes), {
      store: false,
      target: 'yarn-berry-v8',
      strict: false,
      cacheKey: '10c0',
      sources: { artifacts: [remote(bytes).registry] },
      onDiagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic),
    })
    expect(diagnostics.map(diagnostic => diagnostic.code))
      .not.toContain('STORE_PATH_RESOLVED')
    expect(existsSync(resolve(xdg, 'lockgraph'))).toBe(false)
  })

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
      ['yarn-berry', cold.registry],
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
      store: false,
      target: 'yarn-berry-v8',
      strict: false,
      workspaceRoot: workspace.root,
      cacheKey: '10c0',
      sources: {
        artifacts: ['yarn-berry', cold.registry],
      },
    })
    const explicit = await convert(lockfile, {
      store: false,
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
    const route = remote(bytes)

    await convert(npmLock(bytes), {
      store: false,
      target: { format: 'yarn-berry-v8', cacheKey: '10c0' },
      strict: false,
      contract: 'project',
      sources: { artifacts: [route.registry] },
      guards: [{ artifactCompressed: '1 B' }],
      onDiagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic),
    })

    expect(diagnostics.map(diagnostic => diagnostic.code))
      .toContain('ENRICH_ARTIFACT_COMPRESSED_LIMIT')
  })

  it('convert forwards an exact-artifact resource override', async () => {
    const bytes = tarballOf()
    const diagnostics: Diagnostic[] = []
    const lockfile = npmLock(bytes)
    const keys = [...parse('npm-3', lockfile).tarballs()].map(([key]) => key)
    // non-default registry, so the key carries its `+src=` source discriminator
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^pkg@1\.0\.0(\+src=[0-9a-f]{16})?$/)
    const key = keys[0]!

    await convert(lockfile, {
      store: false,
      target: { format: 'yarn-berry-v8', cacheKey: '10c0' },
      strict: false,
      contract: 'project',
      sources: { artifacts: [remote(bytes).registry] },
      guards: [
        { patterns: [key], artifactCompressed: '1 B' },
        { artifactCompressed: `${bytes.byteLength + 1} B` },
      ],
      onDiagnostic: (diagnostic: Diagnostic) => diagnostics.push(diagnostic),
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'ENRICH_ARTIFACT_COMPRESSED_LIMIT',
      subject: key,
    }))
  })
})
