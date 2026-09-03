import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect, parse, stringify } from '../../main/ts/index.ts'

const fixturesRoot = resolve('src/test/resources/fixtures')

interface FixtureCorpus {
  directory: string
  expected: number
  include: (path: string) => boolean
  contract: string
}

const corpora: FixtureCorpus[] = [
  {
    directory: 'real-world',
    expected: 43,
    include: path => ['bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
      .includes(basename(path)),
    contract: 'production lockfiles',
  },
  {
    directory: 'lockfiles',
    expected: 122,   // +7: bun-text-v2.lock per scenario, bun 1.4.0 producer output
    include: path => path.endsWith('.lock'),
    contract: 'generated adapter matrix',
  },
  {
    directory: 'alias',
    expected: 2,
    include: path => basename(path) === 'yarn.lock',
    contract: 'alias identity regressions',
  },
  {
    directory: 'npm-v4',
    expected: 2,
    include: path => basename(path) === 'package-lock.json',
    contract: 'native extension and patch carriers',
  },
  {
    directory: 'detect',
    expected: 1,
    include: path => basename(path) === 'yarn.lock',
    contract: 'valid headerless detection recovery',
  },
  {
    directory: 'integrity',
    expected: 1,
    include: path => basename(path) === 'yarn.lock',
    contract: 'multi-hash integrity preservation',
  },
  {
    directory: 'seal',
    expected: 1,
    include: path => basename(path) === 'yarn.lock',
    contract: 'valid workspace-seal regression',
  },
  {
    directory: 'npm-serialize',
    expected: 2,
    include: path => basename(path).endsWith('package-lock.json'),
    contract: 'native npm serializer fixtures',
  },
  {
    directory: 'pnpm-explicit-key',
    expected: 1,
    include: path => basename(path) === 'pnpm-lock.yaml',
    contract: 'YAML explicit keys past the 1024-character implicit limit',
  },
  {
    directory: 'lockgraph',
    expected: 5,
    include: path => path.endsWith('.lockgraph'),
    contract: 'canonical lockgraph format fixtures',
  },
]

function filesUnder(path: string): string[] {
  return readdirSync(path)
    .flatMap(name => {
      const child = resolve(path, name)
      return statSync(child).isDirectory() ? filesUnder(child) : [child]
    })
    .sort()
}

describe('same-format fidelity contract — every fixture lockfile', () => {
  it.each(corpora)(
    '$directory: $contract',
    ({ directory, expected, include }) => {
      const paths = filesUnder(resolve(fixturesRoot, directory)).filter(include)
      expect(paths, `${directory}: fixture census`).toHaveLength(expected)

      for (const path of paths) {
        const id = relative(fixturesRoot, path)
        const source = readFileSync(path, 'utf8')
        const format = detect(source)
        expect(format, `${id}: detection`).toBeDefined()
        const graph = parse(format!, source)

        // The common format contract is Graph-level, not byte identity.
        // `strict:false` allows same-PM sidecar carriers (notably Berry
        // checksums); reparse/diff/tarball equality below is the independent
        // same-format oracle.
        const output = stringify(format!, graph, { strict: false })
        const reparsed = parse(format!, output)
        for (const [kind, changes] of Object.entries(graph.diff(reparsed))) {
          expect(changes, `${id}: ${kind}`).toEqual([])
        }
        expect(Array.from(reparsed.tarballs()), `${id}: tarballs`)
          .toEqual(Array.from(graph.tarballs()))
      }
    },
    120_000,
  )

  it('keeps the explicit fixture census at 180 lockfiles', () => {
    expect(corpora.reduce((total, corpus) => total + corpus.expected, 0)).toBe(180)
  })
})
