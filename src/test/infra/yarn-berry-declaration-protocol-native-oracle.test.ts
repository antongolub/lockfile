import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/index.ts'
import {
  parse as parseSyml,
  type SymlMap,
} from '../../main/ts/formats/_yarn-syml.ts'
import {
  createNativeLock,
  FROZEN_ORACLE_MATRIX,
  runFrozenOracle,
  runMutableLockfileOracle,
  type FrozenOracleAdapter,
  type FrozenOracleCandidate,
  type FrozenOracleProjectFiles,
  type FrozenOracleResult,
  type MutableLockfileOracleResult,
} from '../helpers/frozen-oracle.ts'
import {
  startFrozenRegistry,
  stopFrozenRegistry,
  type FrozenRegistryProcess,
} from '../helpers/frozen-registry-process.ts'

const here = dirname(fileURLToPath(import.meta.url))
const tarballPath = resolve(here, '../resources/fixtures/tarballs/ms-2.1.3.tgz')
const registryScript = resolve(here, '../helpers/frozen-registry.mjs')
const adapters = Object.fromEntries(
  FROZEN_ORACLE_MATRIX
    .filter(adapter => ['pm-yarn-2', 'pm-yarn-berry-v5', 'pm-yarn-berry-v6'].includes(adapter.alias))
    .map(adapter => [adapter.alias, adapter]),
) as Readonly<Record<'pm-yarn-2' | 'pm-yarn-berry-v5' | 'pm-yarn-berry-v6', FrozenOracleAdapter>>

interface PlainCase {
  readonly adapter: FrozenOracleAdapter
  readonly files: FrozenOracleProjectFiles
  readonly bare: string
  readonly explicit: string
  readonly replay: string
  readonly sourceFrozen: FrozenOracleResult
  readonly sourceMutable: MutableLockfileOracleResult
}

interface SelfAliasCase {
  readonly adapter: FrozenOracleAdapter
  readonly files: FrozenOracleProjectFiles
  readonly source: string
  readonly replay: string
  readonly sourceFrozen: FrozenOracleResult
  readonly sourceMutable: MutableLockfileOracleResult
  readonly replayFrozen: FrozenOracleResult
  readonly replayMutable: MutableLockfileOracleResult
}

let registry: FrozenRegistryProcess | undefined
let plainV4: PlainCase
let plainV5: PlainCase
let plainV6: PlainCase
let selfAliasV4: SelfAliasCase

function isMap(value: unknown): value is SymlMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rootDependency(lockfile: string, name: string): string | undefined {
  for (const value of Object.values(parseSyml(lockfile))) {
    if (!isMap(value) || typeof value.resolution !== 'string') continue
    if (!value.resolution.endsWith('@workspace:.')) continue
    const dependencies = value.dependencies
    if (!isMap(dependencies)) return undefined
    const declaration = dependencies[name]
    return typeof declaration === 'string' ? declaration : undefined
  }
  return undefined
}

function projectFiles(
  adapter: FrozenOracleAdapter,
  dependency: string,
): FrozenOracleProjectFiles {
  return {
    'package.json': `${JSON.stringify({
      name: 'lockgraph-berry-declaration-protocol-oracle',
      version: '1.0.0',
      private: true,
      packageManager: `yarn@${adapter.version}`,
      dependencies: { ms: dependency },
    }, null, 2)}\n`,
    '.yarnrc.yml': [
      'nodeLinker: node-modules',
      'enableScripts: false',
      'unsafeHttpWhitelist:',
      '  - 127.0.0.1',
      '',
    ].join('\n'),
  }
}

function candidate(adapter: FrozenOracleAdapter, lockfile: string): FrozenOracleCandidate {
  const target = { format: adapter.format, managerVersion: adapter.version } as const
  const projectionDigest = `sha256:${createHash('sha256').update(JSON.stringify({
    target,
    lockfile,
    companions: [],
  })).digest('hex')}`
  return Object.freeze({
    protocol: 'lockgraph-frozen-projection/v1',
    target: Object.freeze(target),
    projectionDigest,
    lockfile,
    companions: Object.freeze([]),
  })
}

function adapterReplay(adapter: FrozenOracleAdapter, lockfile: string): string {
  return stringify(adapter.format, parse(adapter.format, lockfile), { strict: false })
}

function preparePlain(adapter: FrozenOracleAdapter): PlainCase {
  const files = projectFiles(adapter, 'npm:2.1.3')
  const bare = String(createNativeLock(adapter, projectFiles(adapter, '2.1.3'))['yarn.lock'])
  const explicit = String(createNativeLock(adapter, files)['yarn.lock'])
  const replay = adapterReplay(adapter, explicit)
  return {
    adapter,
    files,
    bare,
    explicit,
    replay,
    sourceFrozen: runFrozenOracle(candidate(adapter, explicit), adapter, files),
    sourceMutable: runMutableLockfileOracle(explicit, adapter, files),
  }
}

function prepareSelfAlias(adapter: FrozenOracleAdapter): SelfAliasCase {
  const files = projectFiles(adapter, 'npm:ms@2.1.3')
  const source = String(createNativeLock(adapter, files)['yarn.lock'])
  const replay = adapterReplay(adapter, source)
  return {
    adapter,
    files,
    source,
    replay,
    sourceFrozen: runFrozenOracle(candidate(adapter, source), adapter, files),
    sourceMutable: runMutableLockfileOracle(source, adapter, files),
    replayFrozen: runFrozenOracle(candidate(adapter, replay), adapter, files),
    replayMutable: runMutableLockfileOracle(replay, adapter, files),
  }
}

beforeAll(async () => {
  registry = await startFrozenRegistry(registryScript, [tarballPath])
  if (registry.registry === undefined) return
  process.env.LOCKGRAPH_TEST_REGISTRY = registry.registry
  plainV4 = preparePlain(adapters['pm-yarn-2'])
  plainV5 = preparePlain(adapters['pm-yarn-berry-v5'])
  plainV6 = preparePlain(adapters['pm-yarn-berry-v6'])
  selfAliasV4 = prepareSelfAlias(adapters['pm-yarn-2'])
}, 120_000)

afterAll(async () => {
  delete process.env.LOCKGRAPH_TEST_REGISTRY
  await stopFrozenRegistry(registry?.child)
})

beforeEach(context => {
  if (registry?.unavailableReason !== undefined) context.skip(registry.unavailableReason)
})

describe('Yarn Berry declaration protocol native oracle', () => {
  it('replays the producer-authored v4 self-alias byte-exactly', () => {
    expect(selfAliasV4.replay).toBe(selfAliasV4.source)
  })

  it('retains the structural npm: target in the v4 self-alias root value', () => {
    expect(rootDependency(selfAliasV4.replay, 'ms')).toBe('npm:ms@2.1.3')
  })

  it('emits a v4 self-alias accepted by the pinned producer in immutable mode', () => {
    expect(selfAliasV4.replayFrozen.receipt).toBeDefined()
  })

  it('emits a v4 self-alias left byte-stable by the pinned producer write path', () => {
    expect(selfAliasV4.replayMutable.lockfile).toBe(selfAliasV4.replay)
  })

  it.each([
    ['v5', () => plainV5],
    ['v6', () => plainV6],
  ] as const)('replays a source-authored explicit-plain %s lock byte-exactly', (_label, getCase) => {
    const row = getCase()
    expect(row.replay).toBe(row.explicit)
  })

  it.each([
    ['v5', () => plainV5],
    ['v6', () => plainV6],
  ] as const)('retains source-authored npm: in the explicit-plain %s root value', (_label, getCase) => {
    expect(rootDependency(getCase().replay, 'ms')).toBe('npm:2.1.3')
  })

  it('pins bare native minting for v4, v5, and v6', () => {
    for (const row of [plainV4, plainV5, plainV6]) {
      expect(rootDependency(row.bare, 'ms'), row.adapter.alias).toBe('2.1.3')
    }
  })

  it('proves the native v4 self-alias source is immutable and write-stable', () => {
    expect(selfAliasV4.sourceFrozen.receipt).toBeDefined()
    expect(selfAliasV4.sourceMutable.lockfile).toBe(selfAliasV4.source)
  })

  it('proves source-authored explicit-plain v5 and v6 locks are immutable and write-stable', () => {
    for (const row of [plainV5, plainV6]) {
      expect(row.sourceFrozen.receipt, row.adapter.alias).toBeDefined()
      expect(row.sourceMutable.lockfile, row.adapter.alias).toBe(row.explicit)
    }
  })
})
