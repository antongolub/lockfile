import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/api/format-api.ts'

const pnpmBin = resolve(process.cwd(), 'node_modules/pm-pnpm-10/bin/pnpm.cjs')

const NATIVE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      courses:
        specifier: file:vendor/courses
        version: file:vendor/courses
      docs:
        specifier: workspace:*
        version: link:packages/docs

  packages/docs: {}

packages:

  courses@file:vendor/courses:
    resolution: {directory: vendor/courses, type: directory}

snapshots:

  courses@file:vendor/courses:
    dependencies:
      docs: link:packages/docs
`

const PROJECT_FILES = {
  'package.json': JSON.stringify({
    name: 'pnpm-emitter-oracle',
    version: '1.0.0',
    private: true,
    packageManager: 'pnpm@10.34.5',
    dependencies: {
      courses: 'file:vendor/courses',
      docs: 'workspace:*',
    },
  }, null, 2),
  'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
  'packages/docs/package.json': JSON.stringify({ name: 'docs', version: '1.0.0' }, null, 2),
  'vendor/courses/package.json': JSON.stringify({
    name: 'courses',
    version: '1.0.0',
    dependencies: { docs: 'link:packages/docs' },
  }, null, 2),
} as const

function emittedLock(): string {
  return stringify(parse(NATIVE_LOCK, 'pnpm-v9'), 'pnpm-v9')
}

function withProject<T>(lockfile: string, run: (root: string) => T): T {
  const root = mkdtempSync(resolve(tmpdir(), 'lockgraph-pnpm-v9-local-'))
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

function install(root: string, frozen: boolean): void {
  execFileSync(process.execPath, [
    pnpmBin,
    'install',
    ...(frozen ? ['--frozen-lockfile'] : []),
    '--offline',
    '--ignore-scripts',
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: 'pipe',
  })
}

describe('pnpm v9 local-directory producer oracle', () => {
  it('accepts emitted bytes in frozen mode and leaves the lock unchanged', () => {
    const lockfile = emittedLock()
    withProject(lockfile, root => {
      install(root, true)
      expect(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')).toBe(lockfile)
    })
  })

  it('keeps emitted bytes canonical in write-enabled mode and materialises both links', () => {
    const lockfile = emittedLock()
    withProject(lockfile, root => {
      install(root, false)
      expect(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')).toBe(lockfile)
      expect(existsSync(resolve(root, 'node_modules/docs/package.json'))).toBe(true)
      const coursesTarget = resolve(
        root,
        'node_modules',
        readlinkSync(resolve(root, 'node_modules/courses')),
      )
      expect(existsSync(resolve(coursesTarget, '..', 'docs/package.json'))).toBe(true)
    })
  })
})
