import { describe, expect, it } from 'vitest'
import {
  convert,
  LockfileError,
  parse,
  stringify,
  type FormatId,
} from '../../main/ts/index.ts'
import type { Diagnostic } from '../../main/ts/graph.ts'
import { fixture } from '../helpers/lockfile-test-utils.ts'

const UNKNOWN_KEY = 'zzzUnknownVendor'

function jsonExtension(input: string): string {
  const source = JSON.parse(input) as Record<string, unknown>
  const entries = Object.entries(source)
  entries.splice(1, 0, [UNKNOWN_KEY, { nested: 'sentinel' }])
  return JSON.stringify(Object.fromEntries(entries), null, 2) + '\n'
}

function yamlExtension(input: string): string {
  return input.replace(
    /^(lockfileVersion:[^\n]*\n)/,
    `$1${UNKNOWN_KEY}:\n  nested: sentinel\n`,
  )
}

function bunExtension(input: string): string {
  return input.replace(
    /("lockfileVersion": 1,\r?\n)/,
    `$1  "${UNKNOWN_KEY}": { "nested": "sentinel" },\n`,
  )
}

function extended(format: FormatId): string {
  const input = fixture(`simple/${format}.lock`)
  if (format.startsWith('npm-')) return jsonExtension(input)
  if (format.startsWith('pnpm-')) return yamlExtension(input)
  if (format === 'bun-text') return bunExtension(input)
  return input
}

describe('producer-compatible unknown project metadata', () => {
  it.each([
    'npm-1',
    'npm-2',
    'npm-3',
    'npm-4',
    'pnpm-v5',
    'pnpm-v6',
    'pnpm-v9',
    'bun-text',
  ] as const)('%s preserves a structured unknown top-level value on exact and same-format paths', async format => {
    const output = stringify(format, parse(format, extended(format)))
    expect(output).toContain(UNKNOWN_KEY)
    expect(output).toContain('sentinel')
    const converted = await convert(extended(format), {
      from: format,
      to: format,
      strict: false,
    })
    expect(converted).toContain(UNKNOWN_KEY)
    expect(converted).toContain('sentinel')
  })

  it('preserves source top-level placement and lets modeled fields win', () => {
    const input = jsonExtension(fixture('simple/npm-3.lock'))
    const output = stringify('npm-3', parse('npm-3', input))
    expect(output.indexOf('"name"')).toBeLessThan(output.indexOf(`"${UNKNOWN_KEY}"`))
    expect(output.indexOf(`"${UNKNOWN_KEY}"`)).toBeLessThan(output.indexOf('"version"'))
    expect(output).toContain('"lockfileVersion": 3')
  })

  it('names every unknown carrier when a cross-format conversion drops it', () => {
    const diagnostics: Diagnostic[] = []
    const output = stringify('npm-3', parse('pnpm-v9', extended('pnpm-v9')), {
      strict: false,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(output).not.toContain(UNKNOWN_KEY)
    expect(diagnostics.some(diagnostic =>
      diagnostic.code === 'COMPLETENESS_ADAPTER_STATE_LOST'
      && diagnostic.message.includes(`top-level:${UNKNOWN_KEY}`),
    )).toBe(true)
  })

  it.each([
    'npm-1',
    'npm-2',
    'npm-3',
    'npm-4',
    'pnpm-v5',
    'pnpm-v6',
    'pnpm-v9',
    'bun-text',
  ] as const)('%s names a detached carrier and fails closed in strict mode', format => {
    const source = parse(format, extended(format))
    const detached = source.mutate(mutator => {
      mutator.diagnostic({ code: 'TEST_MUTATION', severity: 'info', message: 'detach' })
    }).graph
    const diagnostics: Diagnostic[] = []
    const output = stringify(format, detached, {
      strict: false,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(output).not.toContain(UNKNOWN_KEY)
    expect(diagnostics.some(diagnostic =>
      diagnostic.code === 'COMPLETENESS_ADAPTER_STATE_LOST'
      && diagnostic.message.includes(`top-level:${UNKNOWN_KEY}`),
    )).toBe(true)
    expect(() => stringify(format, detached)).toThrow(LockfileError)
  })
})

describe('producer-specific unknown directives', () => {
  it('preserves a measured Yarn Classic global scalar directive', () => {
    const input = fixture('simple/yarn-classic.lock').replace(
      '# yarn lockfile v1\n',
      `# yarn lockfile v1\n\n${UNKNOWN_KEY} "sentinel"\n`,
    )
    const graph = parse('yarn-classic', input)
    expect(stringify('yarn-classic', graph)).toContain(`${UNKNOWN_KEY} "sentinel"`)
    const mutated = graph.mutate(mutator => {
      mutator.diagnostic({ code: 'TEST_MUTATION', severity: 'info', message: 'propagate' })
    }).graph
    expect(stringify('yarn-classic', mutated)).toContain(`${UNKNOWN_KEY} "sentinel"`)

    const diagnostics: Diagnostic[] = []
    const output = stringify('npm-3', graph, {
      strict: false,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(output).not.toContain(UNKNOWN_KEY)
    expect(diagnostics.some(diagnostic =>
      diagnostic.message.includes(`global-directive:${UNKNOWN_KEY}`),
    )).toBe(true)
  })

  it('keeps malformed Yarn Classic top-level text rejected', () => {
    const input = fixture('simple/yarn-classic.lock').replace(
      '# yarn lockfile v1\n',
      '# yarn lockfile v1\n\nnot a valid global directive with spaces\n',
    )
    expect(() => parse('yarn-classic', input)).toThrow(/malformed yarn-classic global directive/)
  })

  it('repairs producer-invalid Berry metadata in non-strict mode and fails strict', () => {
    const input = fixture('simple/yarn-berry-v4.lock').replace(
      /(__metadata:\n(?:  .+\n)+)/,
      `$1  ${UNKNOWN_KEY}: sentinel\n`,
    )
    const graph = parse('yarn-berry-v4', input)
    const mutated = graph.mutate(mutator => {
      mutator.diagnostic({ code: 'TEST_MUTATION', severity: 'info', message: 'propagate' })
    }).graph
    const diagnostics: Diagnostic[] = []
    const output = stringify('yarn-berry-v4', mutated, {
      strict: false,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })
    expect(output).not.toContain(UNKNOWN_KEY)
    expect(diagnostics.some(diagnostic =>
      diagnostic.code === 'YARN_BERRY_V4_UNKNOWN_METADATA_DROPPED'
      && diagnostic.subject === `__metadata.${UNKNOWN_KEY}`,
    )).toBe(true)
    expect(() => stringify('yarn-berry-v4', mutated)).toThrow(LockfileError)
  })

  it('rejects an unknown lockgraph record with tag and line', () => {
    const lockgraph = stringify(
      'lockgraph',
      parse('npm-3', fixture('simple/npm-3.lock')),
      { strict: false },
    )
    const input = lockgraph.replace(/^R /m, 'X vendor-extension\nR ')
    expect(() => parse('lockgraph', input)).toThrow(/unknown record tag "X" on line \d+/)
  })
})
