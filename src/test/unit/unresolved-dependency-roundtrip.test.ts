import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  detect,
  parse,
  stringify,
  type FormatId,
} from '../../main/ts/index.ts'
import { LockfileError } from '../../main/ts/api/errors.ts'
import { stringifyProjected } from '../../main/ts/api/format-api.ts'
import { projectionPreflightLosses } from '../../main/ts/completeness/projection.ts'
import { newBuilder, type EdgeKind, type Graph } from '../../main/ts/graph.ts'

const here = dirname(fileURLToPath(import.meta.url))
const realWorldFixture = (directory: string, file: string): string =>
  readFileSync(resolve(here, '../resources/fixtures/real-world', directory, file), 'utf8')

const vscodeNpm3 = (): string =>
  realWorldFixture('microsoft-vscode-main-ddd12d5', 'package-lock.json')

const realWorldPnpmFiles = [
  'angular-angular-main-45e8fb5',
  'directus-directus-main-4290f6e',
  'nrwl-nx-master-0939540',
  'supabase-supabase-master-a4334a2',
  'vitejs-vite-main-646dbed',
  'vuejs-core-main-86ad076',
] as const

interface RetainedDeclaration {
  readonly src: string
  readonly kind: EdgeKind
  readonly name: string
  readonly descriptor: string
  readonly resolution?: string
  readonly channel?: string
}

function retainedDeclarations(graph: Graph): readonly RetainedDeclaration[] {
  return graph.diagnostics().flatMap(diagnostic => {
    if (diagnostic.data?.feature !== 'unresolved-dependency-declaration') return []
    const declaration = diagnostic.data.unresolvedDependency
    if (declaration === null || typeof declaration !== 'object') return []
    return [declaration as unknown as RetainedDeclaration]
  })
}

function declarationNames(graph: Graph): string[] {
  return retainedDeclarations(graph)
    .map(item => `${item.src}|${item.kind}|${item.name}|${item.descriptor}|${item.channel ?? ''}`)
    .sort()
}

function roundTripDeclarations(
  format: FormatId,
  input: string,
): {
    readonly before: readonly RetainedDeclaration[]
    readonly after: readonly RetainedDeclaration[]
    readonly output: string
  } {
  const graph = parse(format, input)
  const before = retainedDeclarations(graph)
  // Some deliberately tiny synthetic locks omit unrelated native carriers and
  // therefore have independent strict graph-mismatch losses. `strict:false`
  // isolates the adapter's retained-declaration projection; the separate
  // fail-closed test below exercises the public strict output guard.
  const output = stringify(format, graph, { strict: false })
  const reparsed = parse(format, output)
  const after = retainedDeclarations(reparsed)
  expect(declarationNames(reparsed)).toEqual(declarationNames(graph))
  return { before, after, output }
}

function npm1Unresolved(): string {
  return JSON.stringify({
    name: 'root',
    version: '1.0.0',
    lockfileVersion: 1,
    requires: true,
    dependencies: {
      host: {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/host/-/host-1.0.0.tgz',
        requires: { ghost: '^1.0.0' },
      },
    },
  })
}

function pnpm5Unresolved(): string {
  return [
    'lockfileVersion: 5.4',
    '',
    'specifiers:',
    '  host: 1.0.0',
    '',
    'dependencies:',
    '  host: 1.0.0',
    '',
    'packages:',
    '',
    '  /host/1.0.0:',
    '    resolution: {integrity: sha512-h}',
    '    dependencies:',
    '      ghost: 9.9.9',
    '    dev: false',
    '',
  ].join('\n')
}

function pnpm6Unresolved(): string {
  return [
    "lockfileVersion: '6.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'dependencies:',
    '  host: 1.0.0',
    '',
    'packages:',
    '',
    '  /host@1.0.0:',
    '    resolution: {integrity: sha512-h}',
    '    dependencies:',
    '      ghost: 9.9.9',
    '    dev: false',
    '',
  ].join('\n')
}

function pnpm9Unresolved(): string {
  return [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      host:',
    '        specifier: 1.0.0',
    '        version: 1.0.0',
    '',
    'packages:',
    '',
    '  host@1.0.0:',
    '    resolution: {integrity: sha512-h}',
    '',
    'snapshots:',
    '',
    '  host@1.0.0:',
    '    dependencies:',
    '      ghost: 9.9.9',
    '',
  ].join('\n')
}

function pnpm5UnresolvedImporter(): string {
  return [
    'lockfileVersion: 5.4',
    '',
    'specifiers:',
    '  ghost: workspace:*',
    '',
    'dependencies:',
    '  ghost: link:../nowhere',
    '',
    'packages: {}',
    '',
  ].join('\n')
}

function pnpm9UnresolvedImporter(): string {
  return [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '  excludeLinksFromLockfile: false',
    '',
    'importers:',
    '',
    '  .:',
    '    dependencies:',
    '      ghost:',
    '        specifier: workspace:*',
    '        version: link:../nowhere',
    '',
    'packages: {}',
    '',
    'snapshots: {}',
    '',
  ].join('\n')
}

function bunUnresolved(): string {
  return JSON.stringify({
    lockfileVersion: 1,
    workspaces: {
      '': {
        name: 'root',
        dependencies: {
          host: '1.0.0',
          'root-ghost': '^1.0.0',
        },
      },
    },
    packages: {
      host: [
        'host@1.0.0',
        '',
        { dependencies: { 'package-ghost': '^2.0.0' } },
        '',
      ],
    },
  })
}

function workspaceGraph(specifier: string): Graph {
  const builder = newBuilder()
  builder.addNode({
    id: 'root@1.0.0',
    name: 'root',
    version: '1.0.0',
    peerContext: [],
    workspacePath: '',
  })
  builder.addNode({
    id: 'member@2.0.0',
    name: 'member',
    version: '2.0.0',
    peerContext: [],
    workspacePath: 'packages/member',
  })
  builder.addEdge('root@1.0.0', 'member@2.0.0', 'dep', {
    range: specifier,
    workspace: true,
    workspaceRange: {
      specifier,
      resolvedVersion: '2.0.0',
    },
  })
  return builder.seal()
}

describe('retained unresolved dependency declarations', () => {
  // 44, down from 75: the 31 `link:` slots nx's local `file:` packages declare
  // now bind as real dependency edges instead of being retained as declarations
  // (see docs/spec/formats/pnpm-v9.md, `link:` inside a snapshots dependency
  // block). The remaining pnpm `link:` slots stay declarations — the seal admits
  // no dependency edge from a published package into a workspace member.
  it('preserves all 44 unresolved declarations in the real pnpm corpus', () => {
    let total = 0
    for (const directory of realWorldPnpmFiles) {
      const input = realWorldFixture(directory, 'pnpm-lock.yaml')
      const format = detect(input)
      expect(format).toMatch(/^pnpm-v(?:5|6|9)$/)
      const source = parse(format!, input)
      const before = retainedDeclarations(source)
      const output = stringify(format!, source, { strict: false })
      const reparsed = parse(format!, output)
      expect(declarationNames(reparsed), directory).toEqual(declarationNames(source))
      total += before.length
    }
    expect(total).toBe(44)
  })

  it('preserves the VSCode cpu-features parse gap through npm-3 and npm-2 output', () => {
    const source = parse('npm-3', vscodeNpm3())
    expect(declarationNames(source)).toContain(
      'ssh2@1.17.0|optional|cpu-features|~0.0.10|',
    )

    for (const target of ['npm-3', 'npm-2'] as const) {
      const output = stringify(target, source)
      const ssh2 = (JSON.parse(output) as {
        packages: Record<string, { optionalDependencies?: Record<string, string> }>
      }).packages['node_modules/ssh2']
      expect(ssh2?.optionalDependencies).toEqual({
        'cpu-features': '~0.0.10',
        nan: '^2.23.0',
      })
      expect(declarationNames(parse(target, output))).toContain(
        'ssh2@1.17.0|optional|cpu-features|~0.0.10|',
      )
    }
  })

  it('preserves npm-1 unresolved requires entries through parse-stringify-parse', () => {
    const result = roundTripDeclarations('npm-1', npm1Unresolved())
    expect(result.before).toHaveLength(1)
    expect(result.after).toHaveLength(1)
    expect(JSON.parse(result.output).dependencies.host.requires).toEqual({
      ghost: '^1.0.0',
    })

    const source = parse('npm-1', npm1Unresolved())
    const resolved = source.mutate(mutator => {
      mutator.addNode({
        id: 'ghost@1.2.3',
        name: 'ghost',
        version: '1.2.3',
        peerContext: [],
      })
      mutator.addEdge('host@1.0.0', 'ghost@1.2.3', 'dep', { range: '^1.0.0' })
    }).graph
    expect(stringifyProjected('npm-1', resolved).losses.some(loss =>
      loss.diagnostic.code === 'COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED')).toBe(false)
    const ownerRemoved = source.mutate(mutator => {
      for (const edge of source.in('host@1.0.0')) {
        mutator.removeEdge(edge.src, edge.dst, edge.kind)
      }
      mutator.removeNode('host@1.0.0')
    }).graph
    expect(stringifyProjected('npm-1', ownerRemoved).losses.some(loss =>
      loss.diagnostic.code === 'COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED')).toBe(false)
  })

  it.each([
    ['pnpm-v5', pnpm5Unresolved],
    ['pnpm-v6', pnpm6Unresolved],
    ['pnpm-v9', pnpm9Unresolved],
  ] as const)('preserves %s unresolved package adjacency through parse-stringify-parse', (
    format,
    input,
  ) => {
    const result = roundTripDeclarations(format, input())
    expect(result.before).toHaveLength(1)
    expect(result.after).toHaveLength(1)
    expect(result.output).toContain('ghost: 9.9.9')
  })

  it.each([
    ['pnpm-v5', pnpm5UnresolvedImporter],
    ['pnpm-v9', pnpm9UnresolvedImporter],
  ] as const)('preserves %s unresolved importer specifier and resolution', (format, input) => {
    const result = roundTripDeclarations(format, input())
    expect(result.before).toEqual([
      expect.objectContaining({
        name: 'ghost',
        descriptor: 'workspace:*',
        resolution: 'link:../nowhere',
        channel: 'importer',
      }),
    ])
    expect(result.after).toEqual([
      expect.objectContaining({
        name: 'ghost',
        descriptor: 'workspace:*',
        resolution: 'link:../nowhere',
        channel: 'importer',
      }),
    ])
    expect(result.output).toContain(format === 'pnpm-v5'
      ? 'ghost: workspace:*'
      : 'specifier: workspace:*')
    expect(result.output).toContain('link:../nowhere')
  })

  it('preserves bun-text workspace and package unresolved declarations', () => {
    const result = roundTripDeclarations('bun-text', bunUnresolved())
    expect(result.before.map(item => [item.name, item.channel]).sort()).toEqual([
      ['package-ghost', 'package'],
      ['root-ghost', 'workspace'],
    ])
    expect(result.after.map(item => [item.name, item.channel]).sort()).toEqual([
      ['package-ghost', 'package'],
      ['root-ghost', 'workspace'],
    ])
  })

  it('strictly refuses a target that cannot carry a retained declaration without a registry remedy', () => {
    const graph = parse('npm-1', npm1Unresolved())
    let caught: unknown
    try {
      stringify('yarn-classic', graph)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LockfileError)
    const lockfileError = caught as LockfileError
    expect(lockfileError.code).toBe('IRREDUCIBLE_LOSS')
    expect(lockfileError.losses).toContainEqual(expect.objectContaining({
      class: 'inherent-meaningful',
      feature: 'unresolved-dependency-declaration',
      remedy: expect.objectContaining({ kind: 'allow-loss' }),
      diagnostic: expect.objectContaining({
        code: 'COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED',
      }),
    }))
    expect(lockfileError.losses?.some(loss => loss.remedy.kind === 'supply'
      && loss.remedy.source === 'registry')).toBe(false)
  })
})

describe('workspace capability boundary', () => {
  it('allows inferred empty workspace bindings but still refuses authored workspace protocol', () => {
    expect(projectionPreflightLosses(workspaceGraph(''), { format: 'npm-2' })
      .some(loss => loss.feature === 'workspace')).toBe(false)

    expect(projectionPreflightLosses(workspaceGraph('workspace:*'), { format: 'npm-2' }))
      .toContainEqual(expect.objectContaining({
      class: 'inherent-meaningful',
      feature: 'workspace',
      target: 'npm-2',
    }))
  })

})
