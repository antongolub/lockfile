import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/index.ts'
import {
  createNativeLock,
  FROZEN_ORACLE_MATRIX,
  frozenOracleSkipReason,
  runFrozenOracle,
  runMutableLockfileOracle,
  type FrozenOracleAdapter,
  type FrozenOracleCandidate,
} from '../helpers/frozen-oracle.ts'
import {
  startFrozenRegistry,
  stopFrozenRegistry,
  type FrozenRegistryProcess,
} from '../helpers/frozen-registry-process.ts'

const UNKNOWN_KEY = 'zzzUnknownVendor'
const here = dirname(fileURLToPath(import.meta.url))
const tarballPath = resolve(here, '../resources/fixtures/tarballs/ms-2.1.3.tgz')
const registryScript = resolve(here, '../helpers/frozen-registry.mjs')
let registry: FrozenRegistryProcess | undefined

beforeAll(async () => {
  registry = await startFrozenRegistry(registryScript, [tarballPath])
  if (registry.registry !== undefined) process.env.LOCKGRAPH_TEST_REGISTRY = registry.registry
})

afterAll(async () => {
  delete process.env.LOCKGRAPH_TEST_REGISTRY
  await stopFrozenRegistry(registry?.child)
})

function packageManager(adapter: FrozenOracleAdapter): string {
  if (adapter.family === 'yarn-classic' || adapter.family === 'yarn-berry') {
    return `yarn@${adapter.version}`
  }
  return `${adapter.family}@${adapter.version}`
}

function projectFiles(adapter: FrozenOracleAdapter): Readonly<Record<string, string | Uint8Array>> {
  return {
    'package.json': `${JSON.stringify({
      name: 'lockgraph-unknown-extension-oracle',
      version: '1.0.0',
      private: true,
      packageManager: packageManager(adapter),
      dependencies: { ms: '2.1.3' },
    }, null, 2)}\n`,
    ...(adapter.family === 'yarn-berry'
      ? {
          '.yarnrc.yml': 'nodeLinker: node-modules\nenableScripts: false\n'
            + 'unsafeHttpWhitelist:\n  - 127.0.0.1\n'
            + (adapter.format === 'yarn-berry-v10' ? 'npmMinimalAgeGate: 0\n' : ''),
        }
      : {}),
  }
}

function lockPath(adapter: FrozenOracleAdapter): string {
  if (adapter.family === 'npm') return 'package-lock.json'
  if (adapter.family === 'pnpm') return 'pnpm-lock.yaml'
  if (adapter.family === 'bun') return 'bun.lock'
  return 'yarn.lock'
}

function injectAcceptedExtension(adapter: FrozenOracleAdapter, lockfile: string): string {
  if (adapter.family === 'npm') {
    return lockfile.replace(
      /^(\s*"lockfileVersion":\s*\d+,\r?\n)/m,
      `$1  "${UNKNOWN_KEY}": { "nested": "sentinel" },\n`,
    )
  }
  if (adapter.family === 'pnpm') {
    return lockfile.replace(
      /^(lockfileVersion:[^\n]*\n)/m,
      `$1${UNKNOWN_KEY}:\n  nested: sentinel\n`,
    )
  }
  if (adapter.family === 'bun') {
    return lockfile.replace(
      /^(\s*"lockfileVersion":\s*1,\r?\n)/m,
      `$1  "${UNKNOWN_KEY}": { "nested": "sentinel" },\n`,
    )
  }
  return lockfile.replace(
    /^# yarn lockfile v1\r?$/m,
    `# yarn lockfile v1\n\n${UNKNOWN_KEY} "sentinel"`,
  )
}

function injectBerryMetadata(lockfile: string, key: string, value: string): string {
  return lockfile.replace(
    /^(__metadata:\r?\n(?:[ \t]+[^\n]+\r?\n)+)/m,
    `$1  ${key}: ${value}\n`,
  )
}

function candidate(adapter: FrozenOracleAdapter, lockfile: string): FrozenOracleCandidate {
  const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    target: { format: adapter.format, managerVersion: adapter.version },
    lockfile,
    companions: [],
  })).digest('hex')}`
  return Object.freeze({
    protocol: 'lockgraph-frozen-projection/v1',
    target: Object.freeze({ format: adapter.format, managerVersion: adapter.version }),
    projectionDigest,
    lockfile,
    companions: Object.freeze([]),
  })
}

const acceptedAliases = [
  'pm-npm-6',
  'pm-npm-8',
  'pm-npm-11',
  'pm-pnpm-7',
  'pm-pnpm-8',
  'pm-pnpm-10',
  'bun',
  'pm-yarn-1',
] as const

describe('infra: pinned producer acceptance for unknown native extensions', () => {
  beforeEach(context => {
    if (registry?.unavailableReason !== undefined) context.skip(registry.unavailableReason)
  })

  for (const alias of acceptedAliases) {
    const adapter = FROZEN_ORACLE_MATRIX.find(item => item.alias === alias)!
    const reason = frozenOracleSkipReason(adapter)
    const run = reason === undefined ? it : it.skip
    run(`${alias} accepts its native extension and the adapter replay under frozen mode`, () => {
      const files = createNativeLock(adapter, projectFiles(adapter))
      const injected = injectAcceptedExtension(adapter, String(files[lockPath(adapter)]!))
      expect(injected).toContain(UNKNOWN_KEY)

      const native = runFrozenOracle(candidate(adapter, injected), adapter, files)
      expect(native.reason).toBeUndefined()
      expect(native.receipt).toBeDefined()

      const replay = stringify(adapter.format, parse(adapter.format, injected))
      expect(replay).toContain(UNKNOWN_KEY)
      const frozen = runFrozenOracle(candidate(adapter, replay), adapter, files)
      expect(frozen.reason).toBeUndefined()
      expect(frozen.receipt).toBeDefined()
    }, 120_000)
  }
})

describe('infra: pinned Berry unknown-metadata negative plus repair oracle', () => {
  beforeEach(context => {
    if (registry?.unavailableReason !== undefined) context.skip(registry.unavailableReason)
  })

  for (const adapter of FROZEN_ORACLE_MATRIX.filter(item => item.family === 'yarn-berry')) {
    it(`${adapter.alias} strips mutable, rejects immutable, and accepts repaired output`, () => {
      const files = createNativeLock(adapter, projectFiles(adapter))
      const native = String(files[lockPath(adapter)]!)
      const injected = injectBerryMetadata(native, UNKNOWN_KEY, 'sentinel')
      expect(injected).toContain(UNKNOWN_KEY)

      const mutable = runMutableLockfileOracle(injected, adapter, files)
      expect(mutable.reason).toBeUndefined()
      expect(mutable.lockfile).not.toContain(UNKNOWN_KEY)

      const rejected = runFrozenOracle(candidate(adapter, injected), adapter, files)
      expect(rejected.receipt).toBeUndefined()
      expect(rejected.reason).toMatch(/rejected|changed/)

      const diagnostics: string[] = []
      const repaired = stringify(adapter.format, parse(adapter.format, injected), {
        strict: false,
        onDiagnostic: diagnostic => diagnostics.push(`${diagnostic.subject}:${diagnostic.code}`),
      })
      expect(repaired).not.toContain(UNKNOWN_KEY)
      expect(diagnostics).toContain(
        `__metadata.${UNKNOWN_KEY}:${adapter.format.toUpperCase().replaceAll('-', '_')}_UNKNOWN_METADATA_DROPPED`,
      )

      const accepted = runFrozenOracle(candidate(adapter, repaired), adapter, files)
      expect(accepted.reason).toBeUndefined()
      expect(accepted.receipt).toBeDefined()

      // The old interop contract treated `compressionLevel` as an opaque lock
      // metadata field. All seven exact producers instead remove it just like
      // any other unknown subkey, so keep that correction under native proof.
      const withCompressionLevel = injectBerryMetadata(native, 'compressionLevel', '0')
      const compressionMutable = runMutableLockfileOracle(withCompressionLevel, adapter, files)
      expect(compressionMutable.reason).toBeUndefined()
      expect(compressionMutable.lockfile).not.toContain('compressionLevel:')
      const repairedCompression = stringify(
        adapter.format,
        parse(adapter.format, withCompressionLevel),
        { strict: false },
      )
      expect(repairedCompression).not.toContain('compressionLevel:')
      const compressionFrozen = runFrozenOracle(
        candidate(adapter, repairedCompression),
        adapter,
        files,
      )
      expect(compressionFrozen.reason).toBeUndefined()
      expect(compressionFrozen.receipt).toBeDefined()
    }, 120_000)
  }
})
