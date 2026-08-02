import { describe, expect, it } from 'vitest'

import {
  LockfileError,
  parse as publicParse,
  stringify as publicStringify,
} from '../../main/ts/index.ts'
import {
  formatAdapterStateSubjects,
  rebindFormatAdapterState,
} from '../../main/ts/api/format-registry.ts'
import * as npm2 from '../../main/ts/formats/npm-2.ts'
import * as npm3 from '../../main/ts/formats/npm-3.ts'

const sourceRoot = {
  name: 'root-native-fields',
  version: '1.0.0',
  license: 'MIT',
  engines: { node: '>=18' },
  bin: { root: 'cli.js' },
  funding: { type: 'individual', url: 'https://example.test/fund' },
  hasInstallScript: true,
  peerDependenciesMeta: { react: { optional: true } },
  devDependencies: {},
  os: ['darwin', 'linux'],
  cpu: ['x64', 'arm64'],
  libc: ['glibc'],
  deprecated: 'producer-authored root metadata',
  futureRootField: { nested: ['verbatim', 1] },
}

function source(version: 2 | 3): string {
  return JSON.stringify({
    name: sourceRoot.name,
    version: sourceRoot.version,
    lockfileVersion: version,
    requires: true,
    packages: { '': sourceRoot },
    ...(version === 2 ? { dependencies: {} } : {}),
  }, null, 2) + '\n'
}

describe('npm flat native root-entry replay', () => {
  it.each([
    ['npm-2', npm2] as const,
    ['npm-3', npm3] as const,
  ])('replays the whole source packages[""] object for %s', (_label, adapter) => {
    const output = JSON.parse(adapter.stringify(adapter.parse(source(adapter === npm2 ? 2 : 3))))
    expect(output.packages['']).toEqual(sourceRoot)
  })

  it('retains native root-entry state across same-format graph rebind', () => {
    const graph = npm3.parse(source(3))
    const root = [...graph.nodes()][0]!
    const mutated = graph.mutate(mutator => {
      mutator.replaceNode(root.id, { ...root })
    }).graph
    const rebound = rebindFormatAdapterState('npm-3', graph, mutated).graph

    expect(JSON.parse(npm3.stringify(rebound)).packages['']).toEqual(sourceRoot)
  })

  it('names every native root-entry replay subject', () => {
    const subjects = formatAdapterStateSubjects('npm-3', npm3.parse(source(3)))
    expect(subjects).toEqual([
      'root-entry:bin',
      'root-entry:cpu',
      'root-entry:deprecated',
      'root-entry:devDependencies',
      'root-entry:engines',
      'root-entry:funding',
      'root-entry:futureRootField',
      'root-entry:hasInstallScript',
      'root-entry:libc',
      'root-entry:license',
      'root-entry:os',
      'root-entry:peerDependenciesMeta',
    ])
  })

  it('fails closed with named subjects when a mutation detaches native-only root data', () => {
    const parsed = publicParse('npm-3', source(3))
    const detached = parsed.mutate(mutator => {
      mutator.diagnostic({ code: 'TEST_MUTATION', severity: 'info', message: 'detach native root state' })
    }).graph

    expect(() => publicStringify('npm-3', detached)).toThrowError(expect.objectContaining({
      code: 'IRREDUCIBLE_LOSS',
      losses: expect.arrayContaining([
        expect.objectContaining({ feature: 'root-entry:futureRootField' }),
      ]),
    } satisfies Partial<LockfileError>))
  })

  it('fails closed through the generic fallback after canonical-only root state detaches', () => {
    const canonicalOnly = JSON.stringify({
      name: 'canonical-only',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: 'canonical-only', version: '1.0.0' } },
    })
    const parsed = publicParse('npm-3', canonicalOnly)
    expect(formatAdapterStateSubjects('npm-3', parsed)).toEqual([])
    const detached = parsed.mutate(mutator => {
      mutator.diagnostic({ code: 'TEST_MUTATION', severity: 'info', message: 'detach canonical-only state' })
    }).graph

    expect(() => publicStringify('npm-3', detached)).toThrowError(expect.objectContaining({
      code: 'IRREDUCIBLE_LOSS',
      losses: expect.arrayContaining([
        expect.objectContaining({ feature: 'adapter-state' }),
      ]),
    } satisfies Partial<LockfileError>))
  })

  it('ports the whole native root entry across the npm-2/npm-3 family boundary', () => {
    const output = JSON.parse(npm2.stringify(npm3.parse(source(3))))
    expect(output.packages['']).toEqual(sourceRoot)

    const reverse = JSON.parse(npm3.stringify(npm2.parse(source(2))))
    expect(reverse.packages['']).toEqual(sourceRoot)
  })

  it('lets canonical graph dependencies override a cloned native root block', () => {
    const input = JSON.stringify({
      name: 'root-native-fields',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': {
          name: 'root-native-fields',
          version: '1.0.0',
          dependencies: { ms: '^2.1.0' },
          futureRootField: 'preserved',
        },
        'node_modules/ms': {
          version: '2.1.3',
          resolved: 'https://registry.npmjs.org/ms/-/ms-2.1.3.tgz',
          integrity: 'sha512-YA==',
        },
      },
    })
    const graph = npm3.parse(input)
    const root = [...graph.nodes()].find(node => node.workspacePath === '')!
    const edge = [...graph.out(root.id)].find(candidate => candidate.kind === 'dep')!
    const mutated = graph.mutate(mutator => {
      mutator.removeEdge(edge.src, edge.dst, edge.kind)
      mutator.addEdge(edge.src, edge.dst, edge.kind, { ...edge.attrs, range: '^2.1.3' })
    }).graph
    const rebound = rebindFormatAdapterState('npm-3', graph, mutated).graph
    const output = JSON.parse(npm3.stringify(rebound))

    expect(output.packages[''].dependencies).toEqual({ ms: '^2.1.3' })
    expect(output.packages[''].futureRootField).toBe('preserved')
  })

  it('preserves source dependency key order while overlaying canonical values', () => {
    const input = JSON.stringify({
      name: 'root-order',
      version: '1.0.0',
      lockfileVersion: 2,
      requires: true,
      packages: {
        '': {
          name: 'root-order',
          version: '1.0.0',
          dependencies: {
            'tiny-tarball': '^1.0.0',
            'package-2': '^1.0.0',
          },
        },
        'node_modules/tiny-tarball': { version: '1.0.0' },
        'node_modules/package-2': { version: '1.0.0' },
      },
      dependencies: {
        'tiny-tarball': { version: '1.0.0' },
        'package-2': { version: '1.0.0' },
      },
    })
    const output = JSON.parse(npm2.stringify(npm2.parse(input)))

    expect(Object.keys(output.packages[''].dependencies)).toEqual([
      'tiny-tarball',
      'package-2',
    ])
  })
})
