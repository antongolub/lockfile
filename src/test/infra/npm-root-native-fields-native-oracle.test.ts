import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/formats/npm-2.ts'
import {
  FROZEN_ORACLE_MATRIX,
  runFrozenOracle,
  type FrozenOracleCandidate,
} from '../helpers/frozen-oracle.ts'

const adapter = FROZEN_ORACLE_MATRIX.find(entry => entry.alias === 'pm-npm-8')!

const authored = `{
  "name": "root-native-fields-oracle",
  "version": "1.0.0",
  "lockfileVersion": 2,
  "requires": true,
  "packages": {
    "": {
      "name": "root-native-fields-oracle",
      "version": "1.0.0",
      "engines": {
        "node": ">=18"
      }
    }
  }
}
`

const stripped = `{
  "name": "root-native-fields-oracle",
  "version": "1.0.0",
  "lockfileVersion": 2,
  "requires": true,
  "packages": {
    "": {
      "name": "root-native-fields-oracle",
      "version": "1.0.0"
    }
  }
}
`

const withUnknownRootKey = `{
  "name": "root-native-fields-oracle",
  "version": "1.0.0",
  "lockfileVersion": 2,
  "requires": true,
  "packages": {
    "": {
      "name": "root-native-fields-oracle",
      "version": "1.0.0",
      "futureRootField": {
        "producer": "unknown-key-oracle"
      },
      "engines": {
        "node": ">=18"
      }
    }
  }
}
`

const projectFiles = Object.freeze({
  'package.json': JSON.stringify({
    name: 'root-native-fields-oracle',
    version: '1.0.0',
    private: true,
    engines: { node: '>=18' },
  }),
})

function candidate(lockfile: string): FrozenOracleCandidate {
  const target = { format: adapter.format, managerVersion: adapter.version } as const
  const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    target,
    lockfile,
    companions: [],
  })).digest('hex')}`
  return Object.freeze({
    protocol: 'lockgraph-frozen-projection/v1',
    target,
    projectionDigest,
    lockfile,
    companions: Object.freeze([]),
  })
}

describe('infra: npm native root-entry producer oracle', () => {
  it('pins the exact npm 8 root-engines producer bytes', () => {
    expect(Buffer.byteLength(authored)).toBe(264)
    expect(createHash('sha256').update(authored).digest('hex'))
      .toBe('d589129522127249661f0b45c9a41c6b763911f2622894fe9c7867d6af2d1257')
  })

  it('replays the producer-authored root engines byte-identically', () => {
    expect(stringify(parse(authored))).toBe(authored)
  })

  it('has pinned npm 8 accept the same lock with root engines stripped', () => {
    const result = runFrozenOracle(candidate(stripped), adapter, projectFiles)
    expect(result.reason).toBeUndefined()
    expect(result.receipt).toMatchObject({ verification: 'frozen-verified' })
  }, 60_000)

  it('has pinned npm 8 accept an unknown packages[""] key', () => {
    const result = runFrozenOracle(candidate(withUnknownRootKey), adapter, projectFiles)
    expect(result.reason).toBeUndefined()
    expect(result.receipt).toMatchObject({ verification: 'frozen-verified' })
  }, 60_000)
})
