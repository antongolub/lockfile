import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detect, parse, stringify } from '../../../main/ts/index.ts'

// Real `package-lock.json` shapes from the 1828-file npm corpus sweep that
// escaped as RAW `TypeError`s out of internal code — a strictly worse failure
// class than any fidelity gap, because an embedding caller gets no code, no
// subject and no actionable message, only a stack trace from our internals.
//
// Each fixture is a REDUCTION of a named real lock: a strict subset of its
// entries and fields, nothing invented, kept to the smallest input that still
// reproduces. The `-reduced` suffix is honest provenance (cf. the `-localdep`
// suffix convention in yarn-classic-robustness) — these are NOT verbatim pins.
//
//   marvelouswololo-ssr-react-reduced  `"resolved": false` nested inside the
//     bundled subtree of an optional dep (`fsevents`). The dominant carrier:
//     8 of the 10 crashing locks had it only in that position.
//   nimasoroush-differencify-reduced   `"resolved": false` on a flat top-level
//     entry — the minimal real case (that lock carried exactly one).
//   npm-cli-workspace-simple-reduced   the OBJECT form of the root `workspaces`
//     field, `{ "packages": [...] }`. Taken verbatim from npm's own arborist
//     test fixture `workspaces-changed` (already minimal); 6 corpus locks
//     carried it. npm genuinely accepts this spelling, so it is SUPPORTED
//     rather than diagnosed.
const here = dirname(fileURLToPath(import.meta.url))
const lock = (name: string): string =>
  readFileSync(resolve(here, '../../resources/fixtures/real-world', name, 'package-lock.json'), 'utf8')

const RESOLVED_FALSE = [
  'marvelouswololo-ssr-react-reduced',
  'nimasoroush-differencify-reduced',
] as const

describe('parse', () => {
  it.each(RESOLVED_FALSE)('parses %s, whose entries carry npm\'s `"resolved": false` marker', name => {
    const input = lock(name)
    expect(detect(input)).toBe('npm-1')
    const graph = parse(input, 'npm-1')
    // The entry survives as a node; only the unusable `resolved` is dropped.
    const id = graph.byName('ansi-regex')[0]!
    expect(graph.getNode(id)).toBeDefined()
    expect(graph.tarballOf(id)?.nativeResolution).toBeUndefined()
    // The integrity sitting beside the dropped `resolved` must NOT be lost.
    expect(graph.tarballOf(id)?.integrity).toBeDefined()
  })

  it.each(RESOLVED_FALSE)('round-trips %s without re-emitting a bogus `resolved`', name => {
    const graph = parse(lock(name), 'npm-1')
    const out = JSON.parse(stringify(graph, 'npm-1')) as {
      dependencies: Record<string, { resolved?: unknown; dependencies?: Record<string, { resolved?: unknown }> }>
    }
    const flat = out.dependencies['ansi-regex']
    const nested = out.dependencies['fsevents']?.dependencies?.['ansi-regex']
    expect((flat ?? nested)?.resolved).toBeUndefined()
  })

  it('parses npm-cli-workspace-simple-reduced, whose root `workspaces` uses the object form', () => {
    const input = lock('npm-cli-workspace-simple-reduced')
    const graph = parse(input, 'npm-2')
    expect(graph.byName('a')[0]).toBeDefined()
    expect(graph.byName('b')[0]).toBeDefined()
  })
})

describe('stringify', () => {
  it('replays the object form of the root `workspaces` field byte-for-byte', () => {
    const input = lock('npm-cli-workspace-simple-reduced')
    const source = JSON.parse(input) as { packages: Record<string, { workspaces?: unknown }> }
    const out = JSON.parse(stringify(parse(input, 'npm-2'), 'npm-2')) as {
      packages: Record<string, { workspaces?: unknown }>
    }
    expect(out.packages['']!.workspaces).toEqual(source.packages['']!.workspaces)
  })
})
