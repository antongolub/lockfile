import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  parse,
  stringify,
  type FormatId,
} from '../../main/ts/index.ts'
import { newBuilder } from '../../main/ts/graph.ts'

const here = dirname(fileURLToPath(import.meta.url))
const webpackYarnLock = readFileSync(
  resolve(here, '../resources/fixtures/real-world/webpack-webpack-main-66f71f8/yarn.lock'),
  'utf8',
)

const NPM_FLAT_TARGETS = ['npm-2', 'npm-3', 'npm-4'] as const satisfies readonly FormatId[]
const ALIAS_TARGETS = {
  'react-is-18': 'react-is',
  'react-is-19': 'react-is',
  'string-width-cjs': 'string-width',
  'strip-ansi-cjs': 'strip-ansi',
  'wrap-ansi-cjs': 'wrap-ansi',
} as const

const EXPECTED_ALIAS_EDGES = [
  '@isaacs/cliui@8.0.2 -> string-width@4.2.3 [string-width-cjs npm:string-width@^4.2.0]',
  '@isaacs/cliui@8.0.2 -> strip-ansi@6.0.1 [strip-ansi-cjs npm:strip-ansi@^6.0.1]',
  '@isaacs/cliui@8.0.2 -> wrap-ansi@7.0.0 [wrap-ansi-cjs npm:wrap-ansi@^7.0.0]',
  'pretty-format@30.4.1 -> react-is@18.3.1 [react-is-18 npm:react-is@^18.3.1]',
  'pretty-format@30.4.1 -> react-is@19.2.6 [react-is-19 npm:react-is@^19.2.5]',
] as const

type PackageEntry = Record<string, unknown>

function installPathTail(path: string): string {
  const chain = (`/${path}`).split('/node_modules/').filter(Boolean)
  return chain[chain.length - 1] ?? path
}

function emitWebpack(target: FormatId): string {
  return stringify(target, parse('yarn-classic', webpackYarnLock), { strict: false })
}

function packageEntries(output: string): Array<[string, PackageEntry]> {
  const parsed = JSON.parse(output) as {
    packages?: Record<string, PackageEntry>
  }
  return Object.entries(parsed.packages ?? {})
}

describe('npm flat alias name carrier — red-first semantic regressions', () => {
  it.each(NPM_FLAT_TARGETS)('webpack → %s emits the real name at every alias install path', target => {
    const entries = packageEntries(emitWebpack(target))
      .filter(([path]) => installPathTail(path) in ALIAS_TARGETS)

    // Three cliui cjs aliases plus five repeated install occurrences for each
    // of react-is-18 and react-is-19.
    expect(entries).toHaveLength(13)
    for (const [path, entry] of entries) {
      const alias = installPathTail(path) as keyof typeof ALIAS_TARGETS
      expect(entry.name, path).toBe(ALIAS_TARGETS[alias])
    }
  })

  it.each(NPM_FLAT_TARGETS)('webpack → %s reparse restores canonical alias identity', target => {
    const reparsed = parse(target, emitWebpack(target))
    const aliases = [...reparsed.nodes()]
      .flatMap(node => [...reparsed.out(node.id)])
      .filter(edge => edge.attrs?.alias !== undefined)
      .map(edge =>
        `${edge.src} -> ${edge.dst} [${edge.attrs?.alias} ${edge.attrs?.range}]`)
      .sort()

    expect(aliases).toEqual([...EXPECTED_ALIAS_EDGES].sort())
    for (const alias of Object.keys(ALIAS_TARGETS)) {
      expect(reparsed.byName(alias), alias).toEqual([])
    }
  })
})

describe('npm flat alias name carrier — ordinary-package guards', () => {
  it.each(NPM_FLAT_TARGETS)('%s does not add name when every planned path uses the package name', target => {
    const builder = newBuilder()
    builder.addNode({
      id: 'root@1.0.0',
      name: 'root',
      version: '1.0.0',
      peerContext: [],
      workspacePath: '',
    })
    builder.addNode({
      id: 'ms@2.1.3',
      name: 'ms',
      version: '2.1.3',
      peerContext: [],
    })
    builder.addEdge('root@1.0.0', 'ms@2.1.3', 'dep', { range: '2.1.3' })

    const entries = Object.fromEntries(packageEntries(stringify(target, builder.seal())))
    expect(entries['node_modules/ms']).not.toHaveProperty('name')
  })
})
