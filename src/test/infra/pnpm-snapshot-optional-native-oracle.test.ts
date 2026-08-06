import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/api/format-api.ts'

// The severity of a dropped snapshot `optional` bit is not a fidelity question:
// pnpm stops treating the snapshot as skippable and goes to the store for a
// tarball the source install never needed. This oracle needs no network — the
// package is platform-foreign here, so pnpm resolves it, then either skips it
// (bit present) or demands its tarball (bit absent).

const pnpmBin = resolve(process.cwd(), 'node_modules/pm-pnpm-9/bin/pnpm.cjs')

const NATIVE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    optionalDependencies:
      '@esbuild/android-arm64':
        specifier: 0.28.1
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

const PROJECT_FILES = {
  'package.json': JSON.stringify({
    name: 'pnpm-optional-oracle',
    version: '1.0.0',
    private: true,
    optionalDependencies: { '@esbuild/android-arm64': '0.28.1' },
  }, null, 2),
} as const

function withProject<T>(lockfile: string, run: (root: string) => T): T {
  const root = mkdtempSync(resolve(tmpdir(), 'lockgraph-pnpm-optional-'))
  try {
    for (const [path, contents] of Object.entries(PROJECT_FILES)) {
      const target = resolve(root, path)
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, contents)
    }
    writeFileSync(resolve(root, 'pnpm-lock.yaml'), lockfile)
    return run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function install(root: string, store: string): { status: number; output: string } {
  try {
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
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

function emittedLock(): string {
  return stringify(parse(NATIVE_LOCK, 'pnpm-v9'), 'pnpm-v9')
}

describe('pnpm snapshot optional producer oracle', () => {
  it('carries the source-authored optional bit into the emitted snapshot', () => {
    expect(emittedLock()).toContain('optional: true')
  })

  it('installs offline from both the source lock and the replay', () => {
    const store = mkdtempSync(resolve(tmpdir(), 'lockgraph-pnpm-store-'))
    try {
      // Baseline first. A control whose source leg fails proves nothing about
      // the replay leg, so the source result is asserted, not assumed.
      const source = withProject(NATIVE_LOCK, root => install(root, store))
      expect({ leg: 'source', status: source.status }).toEqual({ leg: 'source', status: 0 })

      const replay = withProject(emittedLock(), root => install(root, store))
      expect({ leg: 'replay', status: replay.status, output: replay.output.includes('NO_OFFLINE_TARBALL') })
        .toEqual({ leg: 'replay', status: 0, output: false })
    } finally {
      rmSync(store, { recursive: true, force: true })
    }
  }, 300_000)
})
