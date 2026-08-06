import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/formats/npm-2.ts'

const fixture = resolve('tmp/npm-corpus/raw/tmquan2508__Q-bot-afk__package-lock.json')
const corpusAvailable = existsSync(fixture)
const suite = corpusAvailable ? describe : describe.skip
const npm6 = resolve('node_modules/pm-npm-6/bin/npm-cli.js')

interface LegacyEntry extends Record<string, unknown> {
  bundled?: boolean
  dependencies?: Record<string, LegacyEntry>
}

interface Lockfile extends Record<string, unknown> {
  dependencies: Record<string, LegacyEntry>
  packages: Record<string, Record<string, unknown>>
}

function source(): string {
  return readFileSync(fixture, 'utf8')
}

function packageJson(lock: Lockfile): string {
  const root = structuredClone(lock.packages['']!)
  delete root.resolved
  delete root.integrity
  delete root.link
  return `${JSON.stringify(root, null, 2)}\n`
}

function writeProject(path: string, lock: Lockfile, manifest: string): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(resolve(path, 'package.json'), manifest)
  writeFileSync(resolve(path, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
}

function tree(root: string, prefix = ''): readonly string[] {
  const rows: string[] = []
  for (const name of readdirSync(resolve(root, prefix)).sort()) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    const absolute = resolve(root, relative)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) {
      rows.push(`l ${relative} -> ${readlinkSync(absolute)}`)
    } else if (stat.isDirectory()) {
      rows.push(`d ${relative}`)
      rows.push(...tree(root, relative))
    } else {
      const hash = createHash('sha256').update(readFileSync(absolute)).digest('hex')
      rows.push(`f ${relative} ${stat.size} ${hash}`)
    }
  }
  return rows
}

suite(
  corpusAvailable
    ? 'npm-v2 legacy mirror npm 6 native oracle'
    : 'npm-v2 legacy mirror npm 6 native oracle [skipped: exact fixture absent]',
  () => {
    it('pins the exact real npm@9.7.2 legacy-mirror witness', () => {
      expect(Buffer.byteLength(source())).toBe(284_499)
      expect(createHash('sha256').update(source()).digest('hex'))
        .toBe('020ade74c7de2a70cc222962f950f84027a8bdc772d52effd03782285a119f0f')
      const authored = JSON.parse(source()) as Lockfile
      expect(Object.keys(authored.dependencies.npm!.dependencies ?? {})).toHaveLength(213)
      expect(authored.dependencies.npm!.dependencies?.['@isaacs/string-locale-compare'])
        .toMatchObject({ version: '1.1.0', bundled: true })
    })

    it('replays the scoped direct child, deeper children, and bundled markers before npm runs', () => {
      const emitted = JSON.parse(stringify(parse(source()))) as Lockfile
      const npmDependencies = emitted.dependencies.npm!.dependencies ?? {}
      expect(npmDependencies['@isaacs/string-locale-compare'])
        .toMatchObject({ version: '1.1.0', bundled: true })
      expect(npmDependencies['@isaacs/cliui']?.dependencies).toMatchObject({
        'ansi-regex': { version: '6.0.1', bundled: true },
        'emoji-regex': { version: '9.2.2', bundled: true },
        'string-width': { version: '5.1.2', bundled: true },
        'strip-ansi': { version: '7.1.0', bundled: true },
      })
    })

    const node14 = process.env.LOCKGRAPH_NODE14_BIN
    const native = process.env.LOCKGRAPH_NPM_V2_LEGACY_OFFLINE_ORACLE === '1'
      && node14 !== undefined
      ? it
      : it.skip

    native('npm 6 accepts source and replay offline with identical installed trees', () => {
      const base = mkdtempSync(resolve(tmpdir(), 'lockgraph-npm-v2-legacy-'))
      try {
        const authored = JSON.parse(source()) as Lockfile
        const emitted = JSON.parse(stringify(parse(source()))) as Lockfile
        const manifest = packageJson(authored)
        const cache = resolve(base, 'cache')
        const run = (cwd: string, offline: boolean) => spawnSync(node14!, [
          npm6,
          'ci',
          '--ignore-scripts',
          '--audit=false',
          '--fund=false',
          '--cache', cache,
          ...(offline ? ['--offline'] : []),
        ], {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: resolve(base, 'home'),
            NO_UPDATE_NOTIFIER: '1',
            npm_config_cache: cache,
          },
        })

        mkdirSync(resolve(base, 'home'), { recursive: true })
        const prime = resolve(base, 'prime')
        const sourceOffline = resolve(base, 'source-offline')
        const replayOffline = resolve(base, 'replay-offline')
        writeProject(prime, authored, manifest)
        writeProject(sourceOffline, authored, manifest)
        writeProject(replayOffline, emitted, manifest)

        expect(run(prime, false).status, 'npm 6 online source prime').toBe(0)
        expect(run(sourceOffline, true).status, 'npm 6 exact source offline').toBe(0)
        expect(run(replayOffline, true).status, 'npm 6 replay offline').toBe(0)
        const sourceTree = tree(resolve(sourceOffline, 'node_modules'))
        const replayTree = tree(resolve(replayOffline, 'node_modules'))
        const firstDifference = Array.from(
          { length: Math.max(sourceTree.length, replayTree.length) },
          (_, index) => ({ index, source: sourceTree[index], replay: replayTree[index] }),
        ).find(row => row.source !== row.replay)
        expect(replayTree, `first installed-tree difference: ${JSON.stringify(firstDifference)}`)
          .toEqual(sourceTree)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }, 300_000)
  },
)
