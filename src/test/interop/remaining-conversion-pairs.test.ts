import { describe, expect, it } from 'vitest'
import { CONTRACTS } from './_matrix.ts'
import type { FormatId } from './_types.ts'
import { convert } from './_dispatch.ts'
import { runIntraFamily } from './intra-family/_runner.ts'

const FORMAT_IDS: FormatId[] = [
  'yarn-berry-v4',
  'yarn-berry-v5',
  'yarn-berry-v6',
  'yarn-berry-v7',
  'yarn-berry-v8',
  'yarn-berry-v9',
  'yarn-berry-v10',
  'yarn-classic',
  'npm-1',
  'npm-2',
  'npm-3',
  'npm-4',
  'pnpm-v5',
  'pnpm-v6',
  'pnpm-v9',
  'bun-text',
  'deno',
]

const DENO_UNSUPPORTED_PAIRS = new Set(FORMAT_IDS
  .filter(format => format !== 'deno')
  .flatMap(format => [`deno -> ${format}`, `${format} -> deno`]))

const EXPECTED_REMAINING_PAIRS = new Set([
  ...[
    'yarn-berry-v4',
    'yarn-berry-v5',
    'yarn-berry-v6',
    'yarn-berry-v7',
    'yarn-berry-v8',
  ].flatMap(berry =>
    ['npm-1', 'npm-2', 'pnpm-v5', 'pnpm-v6'].flatMap(other => [
      `${berry} -> ${other}`,
      `${other} -> ${berry}`,
    ])),
  ...['npm-3', 'pnpm-v9', 'bun-text'].flatMap(other => [
    `yarn-berry-v7 -> ${other}`,
    `${other} -> yarn-berry-v7`,
  ]),
  ...['npm-1', 'npm-2'].flatMap(npm =>
    ['pnpm-v5', 'pnpm-v6'].flatMap(pnpm => [
      `${npm} -> ${pnpm}`,
      `${pnpm} -> ${npm}`,
    ])),
])

const incidentContracts = CONTRACTS.filter(contract =>
  EXPECTED_REMAINING_PAIRS.has(`${contract.from} -> ${contract.to}`))

runIntraFamily('interop: final sparse conversion-matrix closure', incidentContracts)

describe('interop: complete conversion-matrix coverage', () => {
  it('registers the final 54 ordered incident pairs exactly once', () => {
    expect(incidentContracts).toHaveLength(54)
    expect(new Set(incidentContracts.map(contract =>
      `${contract.from} -> ${contract.to}`))).toEqual(EXPECTED_REMAINING_PAIRS)
  })

  it('covers every ordered pair among all 17 public formats exactly once', () => {
    const registered = new Set(CONTRACTS.map(contract =>
      `${contract.from} -> ${contract.to}`))

    expect(CONTRACTS).toHaveLength(272)
    expect(registered).toHaveLength(272)
    for (const from of FORMAT_IDS) {
      for (const to of FORMAT_IDS) {
        if (from !== to) expect(registered).toContain(`${from} -> ${to}`)
      }
    }
  })

  it('registers all 32 deno-touching pairs as explicit fail-closed contracts', () => {
    const denoContracts = CONTRACTS.filter(contract =>
      DENO_UNSUPPORTED_PAIRS.has(`${contract.from} -> ${contract.to}`))
    expect(denoContracts).toHaveLength(32)
    expect(new Set(denoContracts.map(contract =>
      `${contract.from} -> ${contract.to}`))).toEqual(DENO_UNSUPPORTED_PAIRS)

    for (const contract of denoContracts) {
      expect(contract.unsupportedReason).toBe(
        'deno is limited to same-format npm-section audit-fix; JSR/remote dependencies require source transformation via https://github.com/denoland/dnt before npm-family conversion, and that composed path is not certified by lockgraph',
      )
      expect(() => convert({
        from: contract.from,
        to: contract.to,
        source: 'this must not be parsed',
      })).toThrow(
        `convert: unsupported ${contract.from} -> ${contract.to}: ${contract.unsupportedReason}`,
      )
    }
  })
})
