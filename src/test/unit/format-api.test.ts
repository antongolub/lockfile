import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Graph } from '../../main/ts/graph.ts'
import { LockfileError } from '../../main/ts/api/errors.ts'
import {
  check,
  detect,
  isFormatId,
  parse,
  stringify,
} from '../../main/ts/api/format-api.ts'

const LOCKFILES = 'src/test/resources/fixtures/lockfiles/deps-with-scopes'
const pnpmLock = readFileSync(`${LOCKFILES}/pnpm-v9.lock`, 'utf8')
const npmLock = readFileSync(`${LOCKFILES}/npm-3.lock`, 'utf8')

const ids = (graph: Graph): string[] => [...graph.nodes()].map(node => node.id).sort()

function parseError(input: string): LockfileError {
  let error: unknown
  try { parse(input) } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(LockfileError)
  return error as LockfileError
}

describe('isFormatId', () => {
  it('accepts every shipped id', () => {
    for (const id of ['npm-1', 'npm-3', 'pnpm-v9', 'yarn-classic', 'deno-v5', 'lockgraph']) {
      expect(isFormatId(id)).toBe(true)
    }
  })

  it('rejects a lockfile body, which is what makes argument order decidable', () => {
    expect(isFormatId(pnpmLock)).toBe(false)
    expect(isFormatId(npmLock)).toBe(false)
    expect(isFormatId('npm')).toBe(false)
    expect(isFormatId(undefined)).toBe(false)
    expect(isFormatId({ format: 'npm-3' })).toBe(false)
  })
})

describe('parse', () => {
  it('takes the input first with the format second', () => {
    expect([...parse(pnpmLock, 'pnpm-v9').nodes()].length).toBeGreaterThan(0)
  })

  it('takes the format from an options bag', () => {
    expect([...parse(pnpmLock, { format: 'pnpm-v9' }).nodes()].length).toBeGreaterThan(0)
  })

  it('detects the format when none is given', () => {
    expect(detect(pnpmLock)).toBe('pnpm-v9')
    expect(ids(parse(pnpmLock))).toEqual(ids(parse(pnpmLock, 'pnpm-v9')))
  })

  it('still accepts the format-first order', () => {
    expect(ids(parse('pnpm-v9', pnpmLock))).toEqual(ids(parse(pnpmLock, 'pnpm-v9')))
  })

  it('passes options through in either order', () => {
    const seen: string[] = []
    parse(pnpmLock, 'pnpm-v9', { onDiagnostic: d => seen.push(d.code) })
    const legacy: string[] = []
    parse('pnpm-v9', pnpmLock, { onDiagnostic: d => legacy.push(d.code) })
    expect(seen).toEqual(legacy)
  })

  it('keeps options and format separate when both ride the bag', () => {
    const seen: string[] = []
    const graph = parse(pnpmLock, { format: 'pnpm-v9', onDiagnostic: d => seen.push(d.code) })
    expect([...graph.nodes()].length).toBeGreaterThan(0)
  })

  it('refuses when the format is neither given nor detectable', () => {
    const error = parseError('not a lockfile at all')
    expect(error.code).toBe('FORMAT_DETECT_FAILED')
    expect(error.message).toContain('pass it explicitly')
  })

  it('names a pre-npm-5 shrinkwrap with no integrity instead of treating it as junk', () => {
    const error = parseError(JSON.stringify({
      name: 'legacy-shrinkwrap',
      version: '1.0.0',
      dependencies: {
        dep: {
          version: '1.0.0',
          from: 'dep@1.0.0',
          resolved: 'https://registry.npmjs.org/dep/-/dep-1.0.0.tgz',
        },
      },
    }))

    expect(error.code).toBe('FORMAT_DETECT_FAILED')
    expect(error.diagnostics).toEqual([
      expect.objectContaining({
        code: 'NPM_SHRINKWRAP_PRE_LOCKFILE_VERSION',
        severity: 'error',
        message: expect.stringMatching(/pre-npm-5 shrinkwrap.*integrity.*refus/i),
      }),
    ])
  })

  it.each([
    {
      lockfileVersion: 2,
      input: { lockfileVersion: 2, requires: true, packages: {} },
    },
    {
      lockfileVersion: 3,
      input: { lockfileVersion: 3, requires: true },
    },
  ])('names a malformed npm-v$lockfileVersion lock with no packages root', ({
    lockfileVersion,
    input,
  }) => {
    const error = parseError(JSON.stringify(input))

    expect(error.code).toBe('FORMAT_DETECT_FAILED')
    expect(error.diagnostics).toEqual([
      expect.objectContaining({
        code: 'NPM_LOCKFILE_STRUCTURE_MISSING',
        severity: 'error',
        message: expect.stringMatching(
          new RegExp(`lockfileVersion ${lockfileVersion}.*packages.*root`, 'i'),
        ),
      }),
    ])
  })

  it('does not name an integrity-bearing pre-version object as the legacy corpus shape', () => {
    const error = parseError(JSON.stringify({
      dependencies: {
        dep: {
          version: '1.0.0',
          integrity: 'sha512-AAAA',
        },
      },
    }))
    expect(error.diagnostics).toEqual([])
  })

  it('does not name an arbitrary object as the legacy corpus shape', () => {
    expect(parseError(JSON.stringify({ name: 'not-a-lockfile' })).diagnostics).toEqual([])
  })

  it('detects and parses a producer-valid dependency-free npm-v2 lock', () => {
    const input = JSON.stringify({
      name: 'empty-project',
      version: '1.0.0',
      lockfileVersion: 2,
      requires: true,
      packages: {
        '': { name: 'empty-project', version: '1.0.0' },
      },
    })
    expect(detect(input)).toBe('npm-2')
    expect([...parse(input).nodes()].map(node => node.id)).toEqual(['empty-project@1.0.0'])
  })
})

describe('stringify', () => {
  const graph = parse(pnpmLock, 'pnpm-v9')

  it('takes the graph first with the format second', () => {
    expect(stringify(graph, 'npm-3')).toBe(stringify('npm-3', graph))
  })

  it('takes the format from an options bag', () => {
    expect(stringify(graph, { format: 'npm-3' })).toBe(stringify('npm-3', graph))
  })

  it('passes options through in either order', () => {
    expect(stringify(graph, 'npm-3', { lineEnding: 'crlf' }))
      .toBe(stringify('npm-3', graph, { lineEnding: 'crlf' }))
    expect(stringify(graph, { format: 'npm-3', lineEnding: 'crlf' }))
      .toBe(stringify('npm-3', graph, { lineEnding: 'crlf' }))
  })

  it('refuses without a target format, which cannot be inferred from a graph', () => {
    let error: unknown
    try { stringify(graph) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(LockfileError)
    expect((error as LockfileError).code).toBe('INVALID_INPUT')
    expect((error as Error).message).toContain('target format is required')
  })
})

describe('check', () => {
  it('takes the input first with the format second', () => {
    expect(check(pnpmLock, 'pnpm-v9')).toBe(true)
    expect(check(pnpmLock, 'npm-3')).toBe(false)
  })

  it('still accepts the format-first order', () => {
    expect(check('pnpm-v9', pnpmLock)).toBe(true)
    expect(check('npm-3', pnpmLock)).toBe(false)
  })
})

describe('round trip', () => {
  it('reads and writes through the input-first pair', () => {
    const out = stringify(parse(pnpmLock), 'npm-3')
    expect(detect(out)).toBe('npm-3')
    expect(ids(parse(out))).toEqual(ids(parse(out, 'npm-3')))
  })
})
