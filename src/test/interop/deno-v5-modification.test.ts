import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  complete,
  modify,
  parse,
  stringify,
  type Diagnostic,
  type PackumentVersion,
  type RegistryAdapter,
} from '../../main/ts/index.ts'
import { parseSri } from '../../main/ts/recipe/integrity.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (filename: string): string => readFileSync(
  resolve(here, `../resources/fixtures/lockfiles/simple/${filename}`),
  'utf8',
)

const versions: Readonly<Record<string, PackumentVersion>> = {
  'react-dom': {
    name: 'react-dom',
    version: '19.2.8',
    dependencies: { scheduler: '^0.27.0' },
    peerDependencies: { react: '^19.2.0' },
    integrity: parseSri('sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ=='),
    tarball: 'https://registry.npmjs.org/react-dom/-/react-dom-19.2.8.tgz',
  },
  react: {
    name: 'react',
    version: '19.2.8',
    integrity: parseSri('sha512-PWaYA1L/q9u2u7xYQi+Y3L3Yfnie7XyLeaJICV1MGD6LprsBxcAqGjYyr0eY3p+QdsA+x/Irkt4Qif8D63+Sbw=='),
    tarball: 'https://registry.npmjs.org/react/-/react-19.2.8.tgz',
  },
  scheduler: {
    name: 'scheduler',
    version: '0.27.0',
    integrity: parseSri('sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q=='),
    tarball: 'https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz',
  },
}

const registry: RegistryAdapter = {
  async packument(name) {
    const version = versions[name]
    return version === undefined
      ? undefined
      : { name, distTags: { latest: version.version }, versions: { [version.version]: version } }
  },
  async resolve(name) { return versions[name] },
}

describe('deno-v5 modification oracle', () => {
  it('matches Deno v5-old to v5-mutation bytes through public modify and complete', async () => {
    const source = parse(fixture('deno.lock'), 'deno-v5')
    const modified = await modify(source, {
      kind: 'replaceVersion',
      selector: { name: 'react-dom', fromRange: '19.1.1' },
      to: '19.2.8',
    }, {
      target: 'deno-v5',
      sources: { packuments: [registry] },
    })
    const completed = await complete(modified.graph, {
      target: 'deno-v5',
      sources: { packuments: [registry] },
      seed: modified.frontier,
      pruneOrphans: true,
    })

    const diagnostics: Diagnostic[] = []
    const output = stringify(completed.graph, 'deno-v5', {
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(output).toBe(fixture('deno-v5-mutated.lock'))
    expect(completed.graph.tarballOf('react-dom@19.2.8(react@19.2.8)')
      ?.peerDependencies?.react).toBe('^19.2.0')
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PROJECTION_LOSS',
      subject: 'react-dom@19.2.8(react@19.2.8)',
      data: expect.objectContaining({
        class: 'structural-expected',
        feature: 'metadata:peer-declaration-range',
        target: 'deno-v5',
      }),
    }))
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PROJECTION_LOSS',
      subject: 'react-dom@19.2.8(react@19.2.8)',
      data: expect.objectContaining({
        class: 'structural-expected',
        feature: 'metadata:dependency-declaration-range',
        target: 'deno-v5',
      }),
    }))

    const reactDomId = completed.graph.byName('react-dom')[0]!
    const reactId = completed.graph.byName('react')[0]!
    expect(() => stringify(completed.graph, 'npm-3')).toThrowError(expect.objectContaining({
      code: 'IRREDUCIBLE_LOSS',
    }))
    expect(completed.graph.tarballOf('react-dom@19.2.8(react@19.2.8)')
      ?.peerDependencies?.react).toBe('^19.2.0')

    const unresolved = completed.graph.mutate(mutator => {
      mutator.removeEdge(reactDomId, reactId, 'peer')
      mutator.replacePeerContext(reactDomId, [])
    }).graph
    expect(() => stringify(unresolved, 'deno-v5')).toThrowError(expect.objectContaining({
      code: 'IRREDUCIBLE_LOSS',
    }))
  })
})
