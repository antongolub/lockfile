import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { serializeNodeId, type Graph } from '../../main/ts/graph.ts'
import { check, parse, stringify } from '../../main/ts/formats/deno.ts'
import { parseSri } from '../../main/ts/recipe/integrity.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (filename: string): string => readFileSync(
  resolve(here, `../resources/fixtures/lockfiles/simple/${filename}`),
  'utf8',
)

const LAYOUT_FIXTURES = [
  ['2', 'deno-v2.lock'],
  ['3', 'deno-v3.lock'],
  ['4', 'deno-v4.lock'],
  ['5', 'deno.lock'],
] as const

const SCHEDULER_027_SRI =
  'sha512-eNv+WrVbKu1f3vbYJT/xtiF5syA5HPIMtf9IgY/nKg0sWqzAUEvqY/xm7OcZc/qafLx/iO9FgOmeSAp4v5ti/Q=='

function bumpScheduler(graph: Graph): Graph {
  const schedulerId = graph.byName('scheduler')[0]!
  const scheduler = graph.getNode(schedulerId)!
  const nextSchedulerId = serializeNodeId('scheduler', '0.27.0', scheduler.peerContext)
  return graph.mutate(mutator => {
    mutator.replaceNode(schedulerId, {
      ...scheduler,
      id: nextSchedulerId,
      version: '0.27.0',
    })
    mutator.setTarball(
      { name: 'scheduler', version: '0.27.0' },
      {
        integrity: parseSri(SCHEDULER_027_SRI),
        resolution: {
          type: 'tarball',
          url: 'https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz',
        },
      },
    )
  }).graph
}

describe('deno adapter', () => {
  it.each(LAYOUT_FIXTURES)(
    'parses and byte-replays committed v%s input',
    (_version, filename) => {
      const input = fixture(filename)
      expect(check(input)).toBe(true)
      const graph = parse(input)
      expect([...graph.nodes()].length).toBeGreaterThan(0)
      expect([...graph.tarballs()].length).toBeGreaterThan(0)
      expect(stringify(graph)).toBe(input)
    },
  )

  it('detects and rejects all four diff3 marker kinds before JSON parsing', () => {
    const input = [
      '{',
      '  "version": "5",',
      '<<<<<<< HEAD',
      '||||||| parent',
      '=======',
      '>>>>>>> branch',
      '  "npm": {}',
      '}',
    ].join('\n')
    expect(check(input)).toBe(true)
    expect(() => parse(input)).toThrow(/DENO_MERGE_CONFLICT/)
  })

  it('recognizes and replays a valid v3 lock with no packages section', () => {
    const input = '{\n  "version": "3",\n  "remote": {}\n}\n'
    expect(check(input)).toBe(true)
    expect(stringify(parse(input))).toBe(input)
  })

  it.each(['remote', 'redirects', 'workspace'])(
    'recognizes and replays a sparse v5 lock carrying only %s state',
    section => {
      const input = `{\n  "version": "5",\n  "${section}": {}\n}\n`
      expect(check(input)).toBe(true)
      expect(stringify(parse(input))).toBe(input)
    },
  )

  it.each(LAYOUT_FIXTURES)(
    'preserves v%s layout and rewrites full dependency references on mutation',
    (version, filename) => {
      const output = stringify(bumpScheduler(parse(fixture(filename))))
      expect(JSON.parse(output).version).toBe(version)
      expect(output).toContain('"scheduler@0.27.0"')
      expect(output).not.toContain('"scheduler@0.26.0"')
      expect(stringify(parse(output))).toBe(output)
    },
  )

  it('allows exact replay but refuses mutation after an incomplete mandatory reference', () => {
    const input = `{
  "version": "5",
  "npm": {
    "host@1.0.0": {
      "integrity": "${SCHEDULER_027_SRI}",
      "dependencies": [
        "missing@1.0.0"
      ]
    }
  }
}
`
    const graph = parse(input)
    expect(stringify(graph)).toBe(input)
    const host = graph.getNode('host@1.0.0')!
    const changed = graph.mutate(mutator => {
      mutator.replaceNode(host.id, { ...host })
    }).graph
    expect(() => stringify(changed)).toThrow(
      /cannot safely represent mutation.*references missing native npm package/,
    )
  })

  it('preserves explicit tarball-field presence when the package version changes', () => {
    const document = JSON.parse(fixture('deno-v4.lock'))
    document.npm['scheduler@0.26.0'].tarball = 'https://mirror.invalid/scheduler-0.26.0.tgz'
    const output = JSON.parse(stringify(bumpScheduler(parse(`${JSON.stringify(document, null, 2)}\n`))))
    expect(output.npm['scheduler@0.27.0'].tarball).toBe(
      'https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz',
    )
  })

  it('emits the producer-certified v5 graph mutation without changing native-only sections', () => {
    const graph = parse(fixture('deno.lock'))
    const reactDomId = graph.byName('react-dom')[0]!
    const schedulerId = graph.byName('scheduler')[0]!
    const reactDom = graph.getNode(reactDomId)!
    const scheduler = graph.getNode(schedulerId)!
    const nextReactDomId = serializeNodeId('react-dom', '19.2.8', reactDom.peerContext)
    const nextSchedulerId = serializeNodeId('scheduler', '0.27.0', scheduler.peerContext)

    const result = graph.mutate(mutator => {
      mutator.replaceNode(reactDomId, {
        ...reactDom,
        id: nextReactDomId,
        version: '19.2.8',
      })
      mutator.setTarball(
        { name: 'react-dom', version: '19.2.8' },
        {
          integrity: parseSri('sha512-rVprimfGBG3DR+Tq0IQG2DT5PxKth1WIGDmj5yPmlzr4YBe7uyE+Du4oVqTDXZSHGGGXRtTJEGSSePyQCMBglQ=='),
          resolution: {
            type: 'tarball',
            url: 'https://registry.npmjs.org/react-dom/-/react-dom-19.2.8.tgz',
          },
        },
      )
      mutator.replaceNode(schedulerId, {
        ...scheduler,
        id: nextSchedulerId,
        version: '0.27.0',
      })
      mutator.setTarball(
        { name: 'scheduler', version: '0.27.0' },
        {
          integrity: parseSri(SCHEDULER_027_SRI),
          resolution: {
            type: 'tarball',
            url: 'https://registry.npmjs.org/scheduler/-/scheduler-0.27.0.tgz',
          },
        },
      )
    })

    const output = stringify(result.graph)
    expect(output).toBe(fixture('deno-v5-mutated.lock'))
    expect(JSON.parse(output)).toMatchObject({
      version: '5',
      jsr: JSON.parse(fixture('deno.lock')).jsr,
      workspace: JSON.parse(fixture('deno.lock')).workspace,
    })
  })
})
