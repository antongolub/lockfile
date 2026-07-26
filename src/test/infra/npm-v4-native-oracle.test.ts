import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/formats/npm-4.ts'
import {
  createNativeLock,
  runFrozenOracle,
  type FrozenOracleAdapter,
  type FrozenOracleCandidate,
} from '../helpers/frozen-oracle.ts'
import {
  startFrozenRegistry,
  stopFrozenRegistry,
  type FrozenRegistryProcess,
} from '../helpers/frozen-registry-process.ts'

const here = dirname(fileURLToPath(import.meta.url))
const tarballPath = resolve(here, '../resources/fixtures/tarballs/ms-2.1.3.tgz')
const registryScript = resolve(here, '../helpers/frozen-registry.mjs')
const nodeRange = '^22.22.2 || ^24.15.0 || >=26.0.0'

const adapter: FrozenOracleAdapter = Object.freeze({
  family: 'npm',
  format: 'npm-4',
  version: '12.0.1',
  alias: 'pm-npm-12',
  binName: 'npm',
  nativeLockfileVersion: 4,
  nodeRange,
})

const patch = `--- a/index.js
+++ b/index.js
@@ -1,5 +1,6 @@
 /**
+ * Lockgraph npm-4 native oracle marker.
  * Helpers.
  */
${' '}
 var s = 1000;
`

let registry: FrozenRegistryProcess | undefined

beforeAll(async () => {
  registry = await startFrozenRegistry(registryScript, [tarballPath])
  if (registry.registry !== undefined) {
    process.env.LOCKGRAPH_TEST_REGISTRY = registry.registry
  }
})

afterAll(async () => {
  delete process.env.LOCKGRAPH_TEST_REGISTRY
  await stopFrozenRegistry(registry?.child)
})

beforeEach(context => {
  if (registry?.unavailableReason !== undefined) context.skip(registry.unavailableReason)
})

const runnable = semver.satisfies(process.versions.node, nodeRange) ? it : it.skip

describe('infra: npm-4 native npm 12 oracle', () => {
  runnable(
    `npm 12 creates v4 only for a patch trigger and accepts byte-stable mutable/frozen replay`
      + (semver.satisfies(process.versions.node, nodeRange)
        ? ''
        : ` [skip: Node ${process.versions.node} does not satisfy ${nodeRange}]`),
    () => {
      const manifest = {
        name: 'lockgraph-npm-v4-native-oracle',
        version: '1.0.0',
        private: true,
        packageManager: 'npm@12.0.1',
        dependencies: { ms: '2.1.3' },
        patchedDependencies: {
          'ms@2.1.3': 'patches/ms@2.1.3.patch',
        },
      }
      const input = {
        'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
        'patches/ms@2.1.3.patch': patch,
      }
      const created = createNativeLock(adapter, input)
      const lockfile = String(created['package-lock.json'])
      const parsed = JSON.parse(lockfile) as {
        lockfileVersion: number
        packages: Record<string, {
          patched?: { integrity: string; path: string }
        }>
      }

      expect(parsed.lockfileVersion).toBe(4)
      expect(parsed.packages['node_modules/ms']?.patched).toEqual({
        integrity: `sha512-${createHash('sha512').update(patch).digest('base64')}`,
        path: 'patches/ms@2.1.3.patch',
      })
      expect(stringify(parse(lockfile))).toBe(lockfile)

      // A second native mutable lock-only install must not rewrite any input.
      const mutableReplay = createNativeLock(adapter, created)
      expect(mutableReplay['package-lock.json']).toBe(lockfile)
      expect(mutableReplay['package.json']).toBe(created['package.json'])
      expect(mutableReplay['patches/ms@2.1.3.patch'])
        .toBe(created['patches/ms@2.1.3.patch'])

      const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
        target: { format: adapter.format, managerVersion: adapter.version },
        lockfile,
        companions: [],
      })).digest('hex')}`
      const candidate: FrozenOracleCandidate = Object.freeze({
        protocol: 'lockgraph-frozen-projection/v1',
        target: Object.freeze({
          format: adapter.format,
          managerVersion: adapter.version,
        }),
        projectionDigest,
        lockfile,
        companions: Object.freeze([]),
      })
      const frozen = runFrozenOracle(candidate, adapter, created)
      expect(frozen.reason).toBeUndefined()
      expect(frozen.receipt).toMatchObject({
        target: candidate.target,
        projectionDigest,
        verification: 'frozen-verified',
      })

      const rejected = runFrozenOracle(candidate, adapter, {
        ...created,
        'patches/ms@2.1.3.patch': 'not a unified patch\n',
      })
      expect(rejected.receipt).toBeUndefined()
      expect(rejected.reason).toMatch(/frozen command rejected candidate.*npm error/i)
      expect(rejected.reason).not.toContain('lockgraph-frozen-oracle-')
      expect(rejected.reason).not.toContain(process.cwd())
    },
    60_000,
  )
})
