// Regression (yaf pijma real-world break): `completeTransitives` adds berry nodes
// (platform-optional packages: `@napi-rs/nice-*`, `@esbuild/*`, `@rollup/rollup-*`,
// `@swc/*`, lightningcss, … — ubiquitous) that carry STRUCTURED os/cpu/libc from
// their packument but NO parse-captured `conditions` sidecar. The berry emit must
// COMPOSE `conditions:` from those structured fields, else yarn re-ADDS the field on
// `yarn install --immutable` → YN0028. Same question for peerDependencies /
// peerDependenciesMeta on a completion-added package (probed below).

import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/index.ts'
import { canonicalProjectionGraphSnapshot } from '../../main/ts/api/format-api.ts'
import { completeTransitives } from '../../main/ts/complete/tree-complete.ts'
import { yarnBerryConditionsFeatureOf } from '../../main/ts/formats/_yarn-berry-core.ts'
import type { Graph } from '../../main/ts/graph.ts'
import type { Packument, RegistryAdapter } from '../../main/ts/registry/types.ts'
import { addEdge, addPackage, graphOf } from './_modify-test-utils.ts'

const registry: RegistryAdapter = {
  async packument(name): Promise<Packument | undefined> {
    if (name === 'native-host') return {
      name, distTags: { latest: '1.0.0' },
      versions: { '1.0.0': { name, version: '1.0.0',
        dependencies: { 'needs-peer': '^1.0.0' },
        optionalDependencies: {
          '@napi-rs/nice-darwin-arm64': '1.1.1',
          '@napi-rs/nice-linux-x64-musl': '1.1.1',
          'no-windows': '1.0.0',
        },
      } },
    }
    if (name === '@napi-rs/nice-darwin-arm64') return {
      name, distTags: { latest: '1.1.1' },
      versions: { '1.1.1': { name, version: '1.1.1', os: ['darwin'], cpu: ['arm64'] } },
    }
    if (name === '@napi-rs/nice-linux-x64-musl') return {
      name, distTags: { latest: '1.1.1' },
      versions: { '1.1.1': { name, version: '1.1.1', os: ['linux'], cpu: ['x64'], libc: ['musl'] } },
    }
    // eiows-style negated platform constraint.
    if (name === 'no-windows') return {
      name, distTags: { latest: '1.0.0' },
      versions: { '1.0.0': { name, version: '1.0.0', os: ['!win32'] } },
    }
    if (name === 'needs-peer') return {
      name, distTags: { latest: '1.0.0' },
      versions: { '1.0.0': { name, version: '1.0.0',
        peerDependencies: { react: '^18.0.0' },
        peerDependenciesMeta: { react: { optional: true } },
      } },
    }
    return undefined
  },
  async resolve(name, range) {
    const p = await this.packument(name)
    if (p === undefined) return undefined
    return p.versions[range] ?? Object.values(p.versions)[0]
  },
}

const BERRY_HEX = 'a'.repeat(128)
const esbuildRegistry: RegistryAdapter = {
  async packument(name): Promise<Packument | undefined> {
    if (name === 'native-host') return {
      name,
      distTags: { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name,
          version: '1.0.0',
          dependencies: {
            '@esbuild/darwin-arm64': 'npm:0.25.0',
            '@napi-rs/nice-linux-x64-musl': 'npm:1.1.1',
          },
        },
      },
    }
    if (name === '@esbuild/darwin-arm64') return {
      name,
      distTags: { latest: '0.25.0' },
      versions: {
        '0.25.0': {
          name,
          version: '0.25.0',
          integrity: {
            hashes: [{ algorithm: 'sha512', digest: BERRY_HEX, origin: 'berry-zip' }],
          },
          tarball: 'https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.25.0.tgz',
          os: ['darwin'],
          cpu: ['arm64'],
        },
      },
    }
    if (name === '@napi-rs/nice-linux-x64-musl') return {
      name,
      distTags: { latest: '1.1.1' },
      versions: {
        '1.1.1': {
          name,
          version: '1.1.1',
          integrity: {
            hashes: [{ algorithm: 'sha512', digest: 'b'.repeat(128), origin: 'berry-zip' }],
          },
          tarball: 'https://registry.npmjs.org/@napi-rs/nice-linux-x64-musl/-/nice-linux-x64-musl-1.1.1.tgz',
          os: ['linux'],
          cpu: ['x64'],
          libc: ['musl'],
        },
      },
    }
    return undefined
  },
  async resolve(name, range) {
    const p = await this.packument(name)
    if (p === undefined) return undefined
    return p.versions[range] ?? Object.values(p.versions)[0]
  },
}

const seed = () => graphOf(b => {
  const ws = addPackage(b, { name: 'app', version: '0.0.0', workspacePath: '.' })
  const h = addPackage(b, { name: 'native-host', version: '1.0.0' })
  addEdge(b, ws, h, 'dep', '^1.0.0')
})

const BERRY_FORMATS = {
  8: 'yarn-berry-v8',
  9: 'yarn-berry-v9',
  10: 'yarn-berry-v10',
} as const

const berrySeed = (version: keyof typeof BERRY_FORMATS) => parse(
  BERRY_FORMATS[version],
  '__metadata:\n' +
  `  version: ${version}\n` +
  '  cacheKey: 10c0\n\n' +
  '"app@workspace:.":\n' +
  '  version: 0.0.0-use.local\n' +
  '  resolution: "app@workspace:."\n' +
  '  dependencies:\n' +
  '    native-host: "npm:^1.0.0"\n' +
  '  languageName: unknown\n' +
  '  linkType: soft\n\n' +
  '"native-host@npm:^1.0.0":\n' +
  '  version: 1.0.0\n' +
  '  resolution: "native-host@npm:1.0.0"\n' +
  `  checksum: 10c0/${BERRY_HEX}\n` +
  '  languageName: node\n' +
  '  linkType: hard\n',
)

async function completedBerrySeed(version: keyof typeof BERRY_FORMATS): Promise<{
  graph: Graph
  added: readonly string[]
}> {
  const completed = await completeTransitives(berrySeed(version), esbuildRegistry)
  const graph = completed.graph.mutate(m => {
    for (const id of completed.added) {
      const node = completed.graph.getNode(id)
      const payload = completed.graph.tarballOf(id)
      if (node === undefined || payload === undefined) continue
      m.setTarball({ name: node.name, version: node.version }, {
        ...payload,
        berryChecksumCacheKey: '10c0',
      })
    }
  }).graph
  return { graph, added: completed.added }
}

describe('completion → yarn-berry emit derives platform/peer fields from structured data (yaf pijma/napi-rs)', () => {
  it('keeps a graph with no berry sidecar unavailable even when payload conditions are derivable', () => {
    const bare = graphOf(b => {
      addPackage(b, { name: 'platform-only', version: '1.0.0', os: ['darwin'], cpu: ['arm64'] })
    })
    const node = [...bare.nodes()][0]!
    const graph = bare.mutate(m => {
      m.setTarball({ name: node.name, version: node.version }, {
        ...bare.tarballOf(node.id),
        integrity: {
          hashes: [{ algorithm: 'sha512', digest: BERRY_HEX, origin: 'berry-zip' }],
        },
        berryChecksumCacheKey: '10c0',
        resolution: {
          type: 'tarball',
          url: 'https://registry.npmjs.org/platform-only/-/platform-only-1.0.0.tgz',
        },
      })
    }).graph

    expect(yarnBerryConditionsFeatureOf(graph)).toEqual({
      available: false,
      present: false,
    })
    expect(canonicalProjectionGraphSnapshot(graph, 'yarn-berry-v4', 'project'))
      .toContain('"os":["darwin"]')
    expect(canonicalProjectionGraphSnapshot(graph, 'yarn-berry-v8', 'project'))
      .not.toContain('"os":["darwin"]')
    expect(() => stringify('yarn-berry-v8', graph)).toThrow(/conditions/)
  })

  it('uses a nontrivial captured scalar before a conflicting structured payload', () => {
    const raw = '(os=darwin | os=linux) & !cpu=x64'
    const parsed = parse(
      'yarn-berry-v8',
      '__metadata:\n' +
      '  version: 8\n' +
      '  cacheKey: 10c0\n\n' +
      '"platform-native@npm:1.0.0":\n' +
      '  version: 1.0.0\n' +
      '  resolution: "platform-native@npm:1.0.0"\n' +
      `  checksum: 10c0/${BERRY_HEX}\n` +
      `  conditions: ${raw}\n` +
      '  languageName: node\n' +
      '  linkType: hard\n',
    )
    const node = [...parsed.nodes()].find(candidate => candidate.name === 'platform-native')
    if (node === undefined) throw new Error('platform-native seed node missing')
    const payload = parsed.tarballOf(node.id)
    const graph = parsed.mutate(m => {
      m.setTarball({ name: node.name, version: node.version }, {
        ...payload,
        os: ['win32'],
        cpu: ['ia32'],
      })
    }).graph

    const out = stringify('yarn-berry-v8', graph, { strict: false })
    expect(out).toContain(`conditions: ${raw}`)
    expect(out).not.toContain('conditions: os=win32 & cpu=ia32')
    expect(yarnBerryConditionsFeatureOf(graph)).toEqual(
      yarnBerryConditionsFeatureOf(parse('yarn-berry-v8', out)),
    )
  })

  it.each([8, 10] as const)(
    'strict yarn-berry-v%s accepts a freshly minted conditioned @esbuild node',
    async version => {
      const format = BERRY_FORMATS[version]
      const { graph, added } = await completedBerrySeed(version)

      expect(added).toContain('@esbuild/darwin-arm64@0.25.0')
      const out = stringify(format, graph)
      expect(out).toContain('"@esbuild/darwin-arm64@npm:0.25.0":')
      expect(out).toContain('conditions: os=darwin & cpu=arm64')
      expect(yarnBerryConditionsFeatureOf(graph)).toEqual(
        yarnBerryConditionsFeatureOf(parse(format, out)),
      )
    },
  )

  it.each([9, 10] as const)(
    'strict yarn-berry-v%s carries libc through effective conditions',
    async version => {
      const format = BERRY_FORMATS[version]
      const { graph, added } = await completedBerrySeed(version)

      expect(added).toContain('@napi-rs/nice-linux-x64-musl@1.1.1')
      const out = stringify(format, graph)
      expect(out).toContain('conditions: os=linux & cpu=x64 & libc=musl')
      expect(yarnBerryConditionsFeatureOf(graph)).toEqual(
        yarnBerryConditionsFeatureOf(parse(format, out)),
      )
    },
  )

  it('composes conditions for a completion-added platform-optional package (os+cpu)', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v8', graph, { strict: false })
    expect(out).toContain('conditions: os=darwin & cpu=arm64')
  })

  it('composes conditions including libc (os+cpu+libc)', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v8', graph, { strict: false })
    expect(out).toContain('conditions: os=linux & cpu=x64 & libc=musl')
  })

  it('composes a NEGATED os value with the ! BEFORE the axis (yarn toConditionToken)', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v8', graph, { strict: false })
    expect(out).toContain('conditions: !os=win32') // NOT `os=!win32` (would be YN0028)
    expect(out).not.toContain('os=!win32')
  })

  // The composer lives in the SHARED berry core — so it is NOT v8-specific. Prove it
  // on v10 (newest) and confirm the per-version `conditionsAllowed` gate on v4.
  it('is version-general: yarn-berry-v10 composes conditions too (shared core, not v8-only)', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v10', graph, { strict: false })
    expect(out).toContain('conditions: os=darwin & cpu=arm64')
    expect(out).toContain('conditions: os=linux & cpu=x64 & libc=musl')
  })

  it('respects conditionsAllowed=false: yarn-berry-v4 drops conditions (unsupported), no stray field', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v4', graph, { strict: false })
    expect(out).not.toContain('conditions:')
  })

  it('emits peerDependencies for a completion-added package (byte-exact block)', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v8', graph, { strict: false })
    // Bare range, matching yarn's own `ajv: ^8.0.0` form (corpus-verified).
    expect(out).toContain('  peerDependencies:\n    react: ^18.0.0\n')
  })

  it('emits peerDependenciesMeta.optional for a completion-added package (byte-exact block)', async () => {
    const { graph } = await completeTransitives(seed(), registry)
    const out = stringify('yarn-berry-v8', graph, { strict: false })
    expect(out).toContain('  peerDependenciesMeta:\n    react:\n      optional: true\n')
  })
})
