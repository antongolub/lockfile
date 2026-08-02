import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/formats/npm-2.ts'
import {
  FROZEN_ORACLE_MATRIX,
  runFrozenOracle,
  type FrozenOracleCandidate,
} from '../helpers/frozen-oracle.ts'

const adapter = FROZEN_ORACLE_MATRIX.find(entry => entry.alias === 'pm-npm-8')!

// Exact authored package-lock.json from
// Templarian/MaterialDesign-SVG at the npm-corpus pinned revision.
const lockfile = `{
  "name": "@mdi/svg",
  "version": "7.4.47",
  "lockfileVersion": 2,
  "requires": true,
  "packages": {
    "": {
      "name": "@mdi/svg",
      "version": "7.4.47",
      "license": "Apache-2.0"
    }
  }
}
`

const projectFiles = Object.freeze({
  'package.json': JSON.stringify({
    name: '@mdi/svg',
    version: '7.4.47',
    private: true,
  }),
})

function candidate(candidateLockfile: string): FrozenOracleCandidate {
  const target = { format: adapter.format, managerVersion: adapter.version } as const
  const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    target,
    lockfile: candidateLockfile,
    companions: [],
  })).digest('hex')}`
  return Object.freeze({
    protocol: 'lockgraph-frozen-projection/v1',
    target,
    projectionDigest,
    lockfile: candidateLockfile,
    companions: Object.freeze([]),
  })
}

describe('infra: dependency-free npm-v2 native oracle', () => {
  it('pins the exact real producer file', () => {
    expect(Buffer.byteLength(lockfile)).toBe(212)
    expect(createHash('sha256').update(lockfile).digest('hex'))
      .toBe('02f1f77bdd6ccac2bd802e20aa4c7e7871b06bf295843e99a6d7fdbdf54e8d98')
  })

  it('byte-roundtrips the exact real producer file', () => {
    expect(stringify(parse(lockfile))).toBe(lockfile)
  })

  it('has pinned npm 8 accept the emitted real lock with npm ci', () => {
    const emitted = stringify(parse(lockfile))
    const result = runFrozenOracle(candidate(emitted), adapter, projectFiles)
    expect(result.reason).toBeUndefined()
    expect(result.receipt).toMatchObject({ verification: 'frozen-verified' })
  }, 60_000)
})
