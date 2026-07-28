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

const NODE_FAMILY_FORMATS = FORMAT_IDS.filter(format => format !== 'deno')
const DENO_FORWARD_PAIRS = new Set(NODE_FAMILY_FORMATS
  .map(format => `deno -> ${format}`))
const DENO_REVERSE_PAIRS = new Set(NODE_FAMILY_FORMATS
  .map(format => `${format} -> deno`))

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
runIntraFamily(
  'interop: deno -> npm-family manifest-backed conversion',
  CONTRACTS.filter(contract =>
    DENO_FORWARD_PAIRS.has(`${contract.from} -> ${contract.to}`)),
)

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
    expect(CONTRACTS.filter(contract =>
      contract.unsupportedReason === undefined)).toHaveLength(256)
    expect(CONTRACTS.filter(contract =>
      contract.unsupportedReason !== undefined)).toHaveLength(16)
    for (const from of FORMAT_IDS) {
      for (const to of FORMAT_IDS) {
        if (from !== to) expect(registered).toContain(`${from} -> ${to}`)
      }
    }
  })

  it('registers 16 manifest-backed deno outputs and 16 fail-closed deno inputs', () => {
    const forward = CONTRACTS.filter(contract =>
      DENO_FORWARD_PAIRS.has(`${contract.from} -> ${contract.to}`))
    expect(forward).toHaveLength(16)
    expect(forward.every(contract =>
      contract.unsupportedReason === undefined
      && contract.enrichRequired?.includes('manifests') === true,
    )).toBe(true)

    const reverse = CONTRACTS.filter(contract =>
      DENO_REVERSE_PAIRS.has(`${contract.from} -> ${contract.to}`))
    expect(reverse).toHaveLength(16)
    expect(new Set(reverse.map(contract =>
      `${contract.from} -> ${contract.to}`))).toEqual(DENO_REVERSE_PAIRS)

    for (const contract of reverse) {
      expect(contract.unsupportedReason).toBe(
        'npm-family -> deno requires synthesising Deno native npm ids and peer suffixes that no pinned Deno producer has validated',
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
