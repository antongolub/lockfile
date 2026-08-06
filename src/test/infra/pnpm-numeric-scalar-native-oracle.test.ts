import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/api/format-api.ts'

// pnpm compares the lock's importer `specifier` against the manifest's declared
// range under `--frozen-lockfile`. A range authored as `'0'` is a STRING; emit
// it bare and YAML reads back a NUMBER, the comparison no longer matches, and
// pnpm refuses the lock as out of date.
//
// No network: the sole dependency is optional and platform-foreign, so pnpm
// resolves it and then skips it. What is under test is the compare, not a fetch.

const pnpmBin = resolve(process.cwd(), 'node_modules/pm-pnpm-9/bin/pnpm.cjs')

const NATIVE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    optionalDependencies:
      '@esbuild/android-arm64':
        specifier: '0'
        version: 0.28.1

packages:

  '@esbuild/android-arm64@0.28.1':
    resolution: {integrity: sha512-4RiLNMVJ6Lz8kK1lb0YzoQ4rrKKFCB2NNCdRTdBRIkc5+DSBoU4TWt7wgVdNi3o2xF+r7oXKAdxlxeMdSJnLcQ==}
    engines: {node: '>=18'}
    cpu: [arm64]
    os: [android]

snapshots:

  '@esbuild/android-arm64@0.28.1':
    optional: true
`

const MANIFEST = JSON.stringify({
  name: 'pnpm-numeric-scalar-oracle',
  version: '1.0.0',
  private: true,
  optionalDependencies: { '@esbuild/android-arm64': '0' },
}, null, 2)

function emittedLock(): string {
  return stringify(parse(NATIVE_LOCK, 'pnpm-v9'), 'pnpm-v9')
}

function install(lockfile: string, store: string): { status: number; output: string } {
  const root = mkdtempSync(resolve(tmpdir(), 'lockgraph-pnpm-numeric-'))
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(resolve(root, 'package.json'), MANIFEST)
    writeFileSync(resolve(root, 'pnpm-lock.yaml'), lockfile)
    const output = execFileSync(process.execPath, [
      pnpmBin,
      'install',
      '--frozen-lockfile',
      '--offline',
      '--ignore-scripts',
      '--store-dir',
      store,
    ], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: 'pipe' })
    return { status: 0, output }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('pnpm numeric specifier producer oracle', () => {
  it('keeps a numeric-looking specifier quoted in the emitted lock', () => {
    expect(emittedLock()).toContain("specifier: '0'")
  })

  it('is accepted frozen from both the source lock and the replay', () => {
    const store = mkdtempSync(resolve(tmpdir(), 'lockgraph-pnpm-numeric-store-'))
    try {
      // The source leg is asserted, not assumed: a control whose baseline fails
      // says nothing about the replay.
      const source = install(NATIVE_LOCK, store)
      expect({ leg: 'source', status: source.status }).toEqual({ leg: 'source', status: 0 })

      const replay = install(emittedLock(), store)
      expect({
        leg: 'replay',
        status: replay.status,
        outdated: replay.output.includes('OUTDATED_LOCKFILE'),
      }).toEqual({ leg: 'replay', status: 0, outdated: false })
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  }, 300_000)
})
