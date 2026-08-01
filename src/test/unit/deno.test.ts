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

  describe('Deno v5 source-authoritative patch integrity absence', () => {
    const linkedPatchLock = `{
  "version": "5",
  "npm": {
    "patched@1.0.0": {}
  },
  "workspace": {
    "links": {
      "npm:patched@1.0.0": {}
    }
  }
}
`

    it('accepts and byte-replays an integrity-less npm entry named by workspace.links', () => {
      const graph = denoV5.parse(linkedPatchLock)
      expect(graph.tarballOf('patched@1.0.0')?.integrity).toBeUndefined()
      expect(denoV5.stringify(graph)).toBe(linkedPatchLock)
    })

    it('matches a peer-specialized native entry through its base workspace link', () => {
      const input = `{
  "version": "5",
  "npm": {
    "patched@1.0.0_peer@2.0.0": {},
    "peer@2.0.0": {
      "integrity": "${SCHEDULER_027_SRI}"
    }
  },
  "workspace": {
    "links": {
      "npm:patched@1.0.0": {}
    }
  }
}
`
      const graph = denoV5.parse(input)
      expect(graph.byName('patched')).toEqual(['patched@1.0.0(peer@2.0.0)'])
      expect(denoV5.stringify(graph)).toBe(input)
    })

    it('still refuses to synthesize integrity after the linked entry is mutated', () => {
      const graph = denoV5.parse(linkedPatchLock)
      const node = graph.getNode('patched@1.0.0')!
      const changed = graph.mutate(mutator => {
        mutator.replaceNode(node.id, {
          ...node,
          id: 'patched@1.0.1',
          version: '1.0.1',
        })
      }).graph

      expect(() => denoV5.stringify(changed)).toThrow(/lacks registry integrity evidence/)
    })

    it('rejects an ordinary integrity-less registry entry with no workspace link', () => {
      const input = '{\n  "version": "5",\n  "npm": {\n    "ordinary@1.0.0": {}\n  }\n}\n'
      expect(() => denoV5.parse(input)).toThrow(
        /ordinary@1\.0\.0 is missing both integrity and explicit tarball/,
      )
    })

    it('rejects an integrity-less entry when the workspace link names another version', () => {
      const input = `{
  "version": "5",
  "npm": {
    "ordinary@1.0.0": {}
  },
  "workspace": {
    "links": {
      "npm:ordinary@2.0.0": {}
    }
  }
}
`
      expect(() => denoV5.parse(input)).toThrow(
        /ordinary@1\.0\.0 is missing both integrity and explicit tarball/,
      )
    })

    it('continues accepting an explicit tarball as independent byte-source authority', () => {
      const input = `{
  "version": "5",
  "npm": {
    "mirror@1.0.0": {
      "tarball": "https://mirror.invalid/mirror-1.0.0.tgz"
    }
  }
}
`
      expect(denoV5.stringify(denoV5.parse(input))).toBe(input)
    })
  })

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

describe('registerNpmNodes', () => {
  const CYCLE_A_SRI =
    'sha512-t9JrAHWAnr9QTfmIjBLLnWMqprUKzl4ddsr2zQSmTF1WSB0Fa+D7nRaFWp6uHnailiuqTlHS1aknqA1XHID4gw=='
  const CYCLE_B_SRI =
    'sha512-ISaHpvhbgZki39Ymy88nPYP8j/yo6VKEtxtYqiC81GqV1z4uz2DIqKoyPtGRnIbnCLfncoJZV683WQGyY9P9hA=='
  const FOREIGN_SRI =
    'sha512-wjlmnd83p6jJ/3ySrH2bU8hTv8iH1dXZEWWzDwohC1kZxdTxc9E9ckoM916jAPfW9QwqaF9jjVlHH6VUiWLiCg=='
  const PEER_C_SRI =
    'sha512-9FrWSG41MjsYAbcSNqBvYe/Gy4k9EaikOM81U3m6X4BSl/+9yM/xS8tx8Kqb/QX245DQaCNLjV07nsGVSuRMxg=='
  const PEER_D1_SRI =
    'sha512-7urpd+1JqA+nK+SesmfoGg8L6fC19ccKQZLw7h9N47m4y+lb9djfGKomv1lM7e/hBT6+JxNRUTkvh+nYhFL+DQ=='
  const PEER_D2_SRI =
    'sha512-aMJl1h9xe92uhL2yVeUH4LpwNfVVrHlWm7BVKakWyEDA5XpqLgj3qXZN4+hkMJsA/c0x3pwNMxdYC2ynAEOPGw=='

  // `a` and `b` peer-depend on each other, so Deno unrolls the pair — `a`
  // appears both as `a@1.0.0_b@1.0.0` and, one turn of the cycle deeper, as
  // `a@1.0.0_b@1.0.0__a@1.0.0`. `c` is the control: one package resolved under
  // two genuinely different, non-cyclic peer sets (`d@1.0.0` and `d@2.0.0`)
  // while carrying the very same artifact bytes.
  const cycleLock = (deepUnrollingIntegrity: string): string => `{
  "version": "5",
  "specifiers": {
    "npm:a@1": "1.0.0_b@1.0.0"
  },
  "npm": {
    "a@1.0.0_b@1.0.0": {
      "integrity": "${CYCLE_A_SRI}",
      "dependencies": [
        "b@1.0.0_a@1.0.0"
      ]
    },
    "a@1.0.0_b@1.0.0__a@1.0.0": {
      "integrity": "${deepUnrollingIntegrity}",
      "dependencies": [
        "b@1.0.0_a@1.0.0"
      ]
    },
    "b@1.0.0_a@1.0.0": {
      "integrity": "${CYCLE_B_SRI}",
      "dependencies": [
        "a@1.0.0_b@1.0.0"
      ]
    },
    "c@1.0.0_d@1.0.0": {
      "integrity": "${PEER_C_SRI}"
    },
    "c@1.0.0_d@2.0.0": {
      "integrity": "${PEER_C_SRI}"
    },
    "d@1.0.0": {
      "integrity": "${PEER_D1_SRI}"
    },
    "d@2.0.0": {
      "integrity": "${PEER_D2_SRI}"
    }
  }
}
`

  it('replays every unrolling of a mutual peer cycle byte-identically', () => {
    const input = cycleLock(CYCLE_A_SRI)
    const graph = parse(input)
    const output = stringify(graph)
    expect(output).toBe(input)
    for (const nativeId of ['a@1.0.0_b@1.0.0', 'a@1.0.0_b@1.0.0__a@1.0.0', 'b@1.0.0_a@1.0.0']) {
      expect(Object.keys(JSON.parse(output).npm)).toContain(nativeId)
    }
  })

  it('collapses the unrollings of one base onto a single node', () => {
    const graph = parse(cycleLock(CYCLE_A_SRI))
    expect(graph.byName('a')).toEqual(['a@1.0.0(b@1.0.0(a@1.0.0))'])
    expect(graph.byName('b')).toHaveLength(1)
    expect(graph.diagnostics()).toContainEqual(expect.objectContaining({
      code: 'DENO_PEER_CYCLE_UNROLLING_COLLAPSED',
      subject: 'a@1.0.0(b@1.0.0(a@1.0.0))',
      severity: 'warning',
      message: expect.stringContaining('a@1.0.0_b@1.0.0__a@1.0.0'),
    }))
  })

  it('refuses unrollings of one base that carry different integrity', () => {
    let refusal: { code?: string; message?: string } | undefined
    try {
      parse(cycleLock(FOREIGN_SRI))
    } catch (error) {
      refusal = error as { code?: string; message?: string }
    }
    expect(refusal).toMatchObject({ code: 'PARSE_FAILED' })
    // Both native ids and both integrity values, so the refusal says which two
    // artifacts it declined to treat as one.
    expect(refusal!.message).toContain('a@1.0.0_b@1.0.0 and a@1.0.0_b@1.0.0__a@1.0.0')
    expect(refusal!.message).toContain(CYCLE_A_SRI)
    expect(refusal!.message).toContain(FOREIGN_SRI)
  })

  it('keeps two nodes for one artifact resolved under two different peer sets', () => {
    const graph = parse(cycleLock(CYCLE_A_SRI))
    expect(graph.byName('c')).toEqual(['c@1.0.0(d@1.0.0)', 'c@1.0.0(d@2.0.0)'])
    expect(graph.getNode('c@1.0.0(d@1.0.0)')!.peerContext).toEqual(['d@1.0.0'])
    expect(graph.getNode('c@1.0.0(d@2.0.0)')!.peerContext).toEqual(['d@2.0.0'])
  })

  it('refuses every emit but the byte-exact replay while a node stands for several natives', () => {
    const graph = parse(cycleLock(CYCLE_A_SRI))
    const collapsed = graph.getNode(graph.byName('a')[0]!)!
    const mutated = graph.mutate(mutator => {
      mutator.replaceNode(collapsed.id, { ...collapsed })
    }).graph
    expect(() => stringify(mutated)).toThrow(
      /cannot safely represent mutation.*peer-cycle unrolling a@1\.0\.0_b@1\.0\.0__a@1\.0\.0 shares node/,
    )
  })

  it('points every edge of a collapsed node at a node the sealed graph carries', () => {
    const graph = parse(cycleLock(CYCLE_A_SRI))
    for (const node of graph.nodes()) {
      for (const edge of graph.out(node.id)) {
        expect(graph.getNode(edge.dst), `${edge.src} →${edge.kind} ${edge.dst}`).toBeDefined()
      }
    }
    const collapsed = graph.byName('a')[0]!
    const partner = graph.byName('b')[0]!
    expect(graph.out(collapsed, 'peer').map(edge => edge.dst)).toEqual([partner])
    expect(graph.out(partner, 'peer').map(edge => edge.dst)).toEqual([collapsed])
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

  describe('Deno v5 aliased optional peer projection', () => {
    const aliasedOptionalPeer = `${JSON.stringify({
      version: '5',
      npm: {
        'ajv-formats@3.0.1_@redocly+ajv@8.18.1': {
          integrity: SCHEDULER_027_SRI,
          dependencies: ['ajv@npm:@redocly/ajv@8.18.1'],
          optionalPeers: ['ajv@npm:@redocly/ajv@8.18.1'],
        },
        '@redocly/ajv@8.18.1': { integrity: SCHEDULER_027_SRI },
      },
    }, null, 2)}\n`

    it('projects one optional aliased peer edge and byte-replays the source', () => {
      const graph = denoV5.parse(aliasedOptionalPeer)
      const hostId = graph.byName('ajv-formats')[0]!
      const targetId = graph.byName('@redocly/ajv')[0]!

      expect(graph.out(hostId, 'peer')).toEqual([expect.objectContaining({
        dst: targetId,
        attrs: {
          alias: 'ajv',
          optional: true,
          range: 'npm:@redocly/ajv@8.18.1',
        },
      })])
      expect(graph.out(hostId, 'dep')).toEqual([])
      expect(denoV5.stringify(graph)).toBe(aliasedOptionalPeer)
    })

    it('records only the declared alias in peer metadata', () => {
      const graph = denoV5.parse(aliasedOptionalPeer)
      const payload = graph.tarballOf(graph.byName('ajv-formats')[0]!)!

      expect(payload.peerDependencies).toEqual({
        ajv: 'npm:@redocly/ajv@8.18.1',
      })
      expect(payload.peerDependenciesMeta).toEqual({
        ajv: { optional: true },
      })
    })

    it('re-emits the aliased optional peer after a package mutation', () => {
      const graph = denoV5.parse(aliasedOptionalPeer)
      const hostId = graph.byName('ajv-formats')[0]!
      const payload = graph.tarballOf(hostId)!
      const changed = graph.mutate(mutator => {
        mutator.setTarball(
          { name: 'ajv-formats', version: '3.0.1' },
          { ...payload, deprecated: 'force rebuilt entry' },
        )
      }).graph

      const nativeId = 'ajv-formats@3.0.1_@redocly+ajv@8.18.1'
      expect(JSON.parse(denoV5.stringify(changed)).npm[nativeId].optionalPeers)
        .toEqual(['ajv@npm:@redocly/ajv@8.18.1'])
    })

    it('retains a distinct mandatory suffix peer beside an optional alias', () => {
      const input = `${JSON.stringify({
        version: '5',
        npm: {
          'host@1.0.0_required@2.0.0': {
            integrity: SCHEDULER_027_SRI,
            optionalPeers: ['alias@npm:@scope/optional@3.0.0'],
          },
          'required@2.0.0': { integrity: SCHEDULER_027_SRI },
          '@scope/optional@3.0.0': { integrity: SCHEDULER_027_SRI },
        },
      }, null, 2)}\n`
      const graph = denoV5.parse(input)
      const edges = graph.out(graph.byName('host')[0]!, 'peer')

      expect(edges).toHaveLength(2)
      expect(edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ attrs: { range: '2.0.0' } }),
        expect.objectContaining({
          attrs: {
            alias: 'alias',
            optional: true,
            range: 'npm:@scope/optional@3.0.0',
          },
        }),
      ]))
    })

    it('continues deduplicating an unaliased optional peer and its suffix carrier', () => {
      const input = `${JSON.stringify({
        version: '5',
        npm: {
          'host@1.0.0_peer@2.0.0': {
            integrity: SCHEDULER_027_SRI,
            optionalPeers: ['peer'],
          },
          'peer@2.0.0': { integrity: SCHEDULER_027_SRI },
        },
      }, null, 2)}\n`
      const graph = denoV5.parse(input)

      expect(graph.out(graph.byName('host')[0]!, 'peer')).toEqual([
        expect.objectContaining({ attrs: { optional: true, range: '2.0.0' } }),
      ])
    })
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
