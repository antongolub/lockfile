import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { serializeNodeId, type Diagnostic, type Graph } from '../../main/ts/graph.ts'
import {
  check as checkPublic,
  parse as parsePublic,
  stringify as stringifyPublic,
  type FormatId,
} from '../../main/ts/index.ts'
import { sourceVersionOf, type DenoVersion } from '../../main/ts/formats/_deno-core.ts'
import * as denoV2 from '../../main/ts/formats/deno-v2.ts'
import * as denoV3 from '../../main/ts/formats/deno-v3.ts'
import * as denoV4 from '../../main/ts/formats/deno-v4.ts'
import * as denoV5 from '../../main/ts/formats/deno-v5.ts'
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

const ADAPTERS = {
  '2': denoV2,
  '3': denoV3,
  '4': denoV4,
  '5': denoV5,
} as const

function check(input: string): boolean {
  return Object.values(ADAPTERS).some(adapter => adapter.check(input))
}

function parse(input: string): Graph {
  let version: DenoVersion
  try {
    version = JSON.parse(input).version as DenoVersion
  } catch {
    const match = input.match(/"version"\s*:\s*"([2345])"/)
    if (match === null) throw new Error('missing Deno version')
    version = match[1] as DenoVersion
  }
  return ADAPTERS[version].parse(input)
}

function stringify(graph: Graph): string {
  const version = sourceVersionOf(graph)
  if (version === undefined) throw new Error('missing Deno adapter state')
  return ADAPTERS[version].stringify(graph)
}

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
    'isolates the public deno-v%s identity from all sibling versions',
    (version, filename) => {
      const input = fixture(filename)
      const format = `deno-v${version}` as FormatId
      expect(checkPublic(format, input)).toBe(true)
      for (const sibling of ['deno-v2', 'deno-v3', 'deno-v4', 'deno-v5'] as const) {
        if (sibling === format) continue
        expect(checkPublic(sibling, input)).toBe(false)
        expect(() => parsePublic(sibling, input)).toThrowError(
          expect.objectContaining({ code: 'FORMAT_MISMATCH' }),
        )
      }
    },
  )

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

  it.each(LAYOUT_FIXTURES)(
    'preserves unknown top-level state after a concrete-id mutation for v%s',
    (version, filename) => {
      const document = JSON.parse(fixture(filename))
      document['x-lockgraph-sentinel'] = { nested: [1, true, 'value'] }
      const graph = bumpScheduler(parse(`${JSON.stringify(document, null, 2)}\n`))
      expect(JSON.parse(stringify(graph))['x-lockgraph-sentinel']).toEqual(
        document['x-lockgraph-sentinel'],
      )
      expect(sourceVersionOf(graph)).toBe(version)
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
    const document = JSON.parse(fixture('deno.lock'))
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

  it.each([
    ['deno-v2', 'deno-v3'],
    ['deno-v2', 'deno-v4'],
    ['deno-v3', 'deno-v2'],
    ['deno-v3', 'deno-v4'],
    ['deno-v4', 'deno-v2'],
    ['deno-v4', 'deno-v3'],
    ['deno-v5', 'deno-v2'],
    ['deno-v5', 'deno-v3'],
    ['deno-v5', 'deno-v4'],
  ] as const)(
    'emits a concrete target layout for supported %s -> %s',
    (from, to) => {
      const sourceVersion = from.slice(-1)
      const input = fixture(sourceVersion === '5' ? 'deno.lock' : `deno-v${sourceVersion}.lock`)
      const graph = parsePublic(from, input)
      const diagnostics: Diagnostic[] = []
      const output = stringifyPublic(to, graph, {
        strict: false,
        onDiagnostic: diagnostic => diagnostics.push(diagnostic),
      })
      expect(JSON.parse(output).version).toBe(to.slice(-1))
      expect(checkPublic(to, output)).toBe(true)
      expect(() => parsePublic(to, output)).not.toThrow()
      expect(diagnostics.map(diagnostic => diagnostic.code))
        .not.toContain('COMPLETENESS_ADAPTER_STATE_LOST')
    },
  )

  it.each(['deno-v2', 'deno-v3', 'deno-v4'] as const)(
    'fails closed for %s -> deno-v5 before emitting a partial lock',
    from => {
      const input = fixture(`deno-v${from.slice(-1)}.lock`)
      expect(() => stringifyPublic('deno-v5', parsePublic(from, input), {
        strict: false,
      })).toThrowError(expect.objectContaining({
        code: 'CAPABILITY_LACK',
        message: expect.stringContaining('reclassified'),
      }))
    },
  )

  it('keeps adapter-state loss for Deno -> Node while replacing it with precise intra-Deno losses', () => {
    const document = JSON.parse(fixture('deno.lock'))
    document['x-lockgraph-sentinel'] = { preserved: true }
    document.npm['scheduler@0.26.0'].tarball =
      'https://registry.npmjs.org/scheduler/-/scheduler-0.26.0.tgz'
    const graph = parsePublic('deno-v5', `${JSON.stringify(document, null, 2)}\n`)

    const siblingDiagnostics: Diagnostic[] = []
    stringifyPublic('deno-v2', graph, {
      strict: false,
      onDiagnostic: diagnostic => siblingDiagnostics.push(diagnostic),
    })
    expect(siblingDiagnostics).toContainEqual(expect.objectContaining({
      code: 'DENO_V2_V5_ENTRY_FIELDS_DROPPED',
      subject: 'scheduler@0.26.0',
    }))
    expect(siblingDiagnostics.map(diagnostic => diagnostic.code))
      .not.toContain('COMPLETENESS_ADAPTER_STATE_LOST')

    const nodeDiagnostics: Diagnostic[] = []
    stringifyPublic('npm-3', graph, {
      strict: false,
      onDiagnostic: diagnostic => nodeDiagnostics.push(diagnostic),
    })
    expect(nodeDiagnostics).toContainEqual(expect.objectContaining({
      code: 'COMPLETENESS_ADAPTER_STATE_LOST',
      data: expect.objectContaining({ feature: 'top-level:x-lockgraph-sentinel' }),
    }))
  })
})
