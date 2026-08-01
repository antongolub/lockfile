import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { serializeNodeId, type Diagnostic, type Graph } from '../../main/ts/graph.ts'
import {
  check as checkPublic,
  detect as detectPublic,
  parse as parsePublic,
  stringify as stringifyPublic,
  type FormatId,
} from '../../main/ts/index.ts'
import { stringify as stringifyGraph } from '../../main/ts/api/format-api.ts'
import {
  denoDeclarationRangeProjections,
  rebindAdapterState,
  sourceVersionOf,
  type DenoVersion,
} from '../../main/ts/formats/_deno-core.ts'
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

describe('buildNpmEntry', () => {
  it('selects the SHA-512 member from multi-member tarball SRI', () => {
    const graph = bumpScheduler(parse(fixture('deno.lock')))
    const payload = graph.tarballOf('scheduler@0.27.0')!
    const withMultipleSriMembers = graph.mutate(mutator => {
      mutator.setTarball(
        { name: 'scheduler', version: '0.27.0' },
        {
          ...payload,
          integrity: parseSri(
            `sha1-AAAAAAAAAAAAAAAAAAAAAAAAAAA= ${SCHEDULER_027_SRI}`,
          ),
        },
      )
    }).graph

    expect(JSON.parse(stringify(withMultipleSriMembers)).npm['scheduler@0.27.0'].integrity)
      .toBe(SCHEDULER_027_SRI)
  })

  it('emits resolved non-optional peers in dependencies', () => {
    const graph = parse(fixture('deno.lock'))
    const reactDomId = graph.byName('react-dom')[0]!
    const peer = graph.out(reactDomId, 'peer').find(edge =>
      graph.getNode(edge.dst)?.name === 'react')!
    const duplicateDependency = graph.out(reactDomId, 'dep').find(edge =>
      edge.dst === peer.dst)!
    expect(peer.attrs?.optional).not.toBe(true)

    const peerOnly = duplicateDependency === undefined
      ? graph.mutate(mutator => {
          const payload = graph.tarballOf(reactDomId)!
          mutator.setTarball(
            { name: 'react-dom', version: '19.1.1' },
            { ...payload, deprecated: 'force rebuilt entry' },
          )
        }).graph
      : graph.mutate(mutator => {
          mutator.removeEdge(reactDomId, duplicateDependency.dst, 'dep')
        }).graph
    expect(JSON.parse(stringify(peerOnly)).npm['react-dom@19.1.1_react@19.2.8'].dependencies)
      .toEqual(['react', 'scheduler'])
  })

  it('keeps optional peers distinct and re-emits resolved and unresolved shapes', () => {
    const input = `${JSON.stringify({
      version: '5',
      npm: {
        'host@1.0.0': {
          integrity: SCHEDULER_027_SRI,
          optionalPeers: ['encoding@^0.1.0', 'resolved'],
        },
        'resolved@1.0.0': { integrity: SCHEDULER_027_SRI },
      },
    }, null, 2)}\n`
    const graph = parse(input)
    const hostId = graph.byName('host')[0]!
    const resolvedId = graph.byName('resolved')[0]!
    expect(graph.out(hostId, 'peer')).toContainEqual(expect.objectContaining({
      dst: resolvedId,
      attrs: expect.objectContaining({ optional: true }),
    }))
    expect(graph.out(hostId, 'optional')).toEqual([])
    expect(graph.tarballOf(hostId)?.peerDependencies).toMatchObject({
      encoding: '^0.1.0',
    })
    expect(graph.tarballOf(hostId)?.peerDependenciesMeta).toMatchObject({
      encoding: { optional: true },
      resolved: { optional: true },
    })

    const hostPayload = graph.tarballOf(hostId)!
    const rebuilt = graph.mutate(mutator => {
      mutator.setTarball(
        { name: 'host', version: '1.0.0' },
        { ...hostPayload, deprecated: 'force rebuilt entry' },
      )
    }).graph
    const entry = JSON.parse(stringify(rebuilt)).npm['host@1.0.0']
    expect(entry.optionalPeers).toEqual(['encoding@^0.1.0', 'resolved'])
    expect(entry.optionalDependencies).toBeUndefined()
  })
})

describe('emitConvertedDocument', () => {
  it('omits empty top-level sections', () => {
    const source = denoV3.parse('{\n  "version": "3",\n  "remote": {}\n}\n')
    expect(JSON.parse(denoV4.stringify(source))).toEqual({ version: '4' })
  })
})

describe('dependencyBlockForEmit', () => {
  it('sorts dependency entries uniformly by alias or package name', () => {
    const input = `${JSON.stringify({
      version: '5',
      npm: {
        'host@1.0.0': {
          integrity: SCHEDULER_027_SRI,
          dependencies: ['zulu', 'aardvark@npm:target@1.0.0', 'alpha'],
        },
        'alpha@1.0.0': { integrity: SCHEDULER_027_SRI },
        'target@1.0.0': { integrity: SCHEDULER_027_SRI },
        'zulu@1.0.0': { integrity: SCHEDULER_027_SRI },
      },
    }, null, 2)}\n`
    const graph = parse(input)
    const hostId = graph.byName('host')[0]!
    const hostPayload = graph.tarballOf(hostId)!
    const rebuilt = graph.mutate(mutator => {
      mutator.setTarball(
        { name: 'host', version: '1.0.0' },
        { ...hostPayload, deprecated: 'force rebuilt entry' },
      )
    }).graph
    expect(JSON.parse(stringify(rebuilt)).npm['host@1.0.0'].dependencies).toEqual([
      'aardvark@npm:target@1.0.0',
      'alpha',
      'zulu',
    ])
  })

  it('projects only a resolved optional-dependency range carried as an exact native id', () => {
    const input = `${JSON.stringify({
      version: '5',
      npm: {
        'host@1.0.0': {
          integrity: SCHEDULER_027_SRI,
          optionalDependencies: ['optional'],
        },
        'optional@1.0.0': { integrity: SCHEDULER_027_SRI },
      },
    }, null, 2)}\n`
    const source = parse(input)
    const host = source.byName('host')[0]!
    const optional = source.byName('optional')[0]!
    const removed = source.mutate(mutator => {
      mutator.removeEdge(host, optional, 'optional')
    }).graph
    const withoutOptional = rebindAdapterState(source, removed).graph
    const mutated = withoutOptional.mutate(mutator => {
      mutator.addEdge(host, optional, 'optional', {
        optional: true,
        range: '^1.0.0',
      })
    }).graph
    const graph = rebindAdapterState(withoutOptional, mutated).graph
    expect(graph.out(host, 'optional')).toEqual([expect.objectContaining({
      dst: optional,
      attrs: expect.objectContaining({ range: '^1.0.0' }),
    })])
    expect(denoDeclarationRangeProjections(graph, 'deno-v5')).toContainEqual(
      expect.objectContaining({
        carrier: 'optionalDependencies',
        subject: host,
        destination: optional,
        from: '^1.0.0',
        to: '1.0.0',
      }),
    )
    expect(denoDeclarationRangeProjections(graph, 'npm-3')).toEqual([])

    const diagnostics: Diagnostic[] = []
    const output = stringifyGraph(graph, 'deno-v5', {
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(JSON.parse(output).npm['host@1.0.0'].optionalDependencies).toEqual(['optional'])
    expect(graph.out(host, 'optional')[0]?.attrs?.range).toBe('^1.0.0')
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'PROJECTION_LOSS',
      subject: host,
      data: expect.objectContaining({
        class: 'structural-expected',
        feature: 'metadata:optional-dependency-declaration-range',
        target: 'deno-v5',
      }),
    }))
  })
})

describe('checkVersion', () => {
  it.each(['4', '5'] as const)(
    'recognizes a valid section-less v%s lock',
    version => {
      const input = `{\n  "version": "${version}"\n}\n`
      const format = `deno-v${version}` as const
      expect(checkPublic(format, input)).toBe(true)
      expect(detectPublic(input)).toBe(format)
    },
  )
})
