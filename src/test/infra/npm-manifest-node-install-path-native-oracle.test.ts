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

import { parse, stringify } from '../../main/ts/api/format-api.ts'

const file = 'fffzzau__taiz-bundler__package-lock.json'
const corpusPath = resolve('tmp/npm-corpus/raw', file)
const suite = existsSync(corpusPath) ? describe : describe.skip

function source(): string { return readFileSync(corpusPath, 'utf8') }

function manifest(lock: { packages: Record<string, Record<string, unknown>> }): string {
  const root = structuredClone(lock.packages['']!)
  for (const key of ['resolved', 'integrity', 'link', 'hasInstallScript']) delete root[key]
  return `${JSON.stringify(root, null, 2)}\n`
}

function tree(root: string, prefix = ''): readonly string[] {
  const rows: string[] = []
  for (const name of readdirSync(resolve(root, prefix)).sort()) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    if (relative === '.package-lock.json') continue
    const absolute = resolve(root, relative)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) rows.push(`l ${relative} -> ${readlinkSync(absolute)}`)
    else if (stat.isDirectory()) {
      rows.push(`d ${relative}`)
      rows.push(...tree(root, relative))
    } else {
      rows.push(`f ${relative} ${stat.size} ${createHash('sha256').update(readFileSync(absolute)).digest('hex')}`)
    }
  }
  return rows
}

suite('npm manifest-node installed-path native oracle', () => {
  it('pins the exact real root-identity witness and exposes the missing replay path', () => {
    const input = source()
    expect(Buffer.byteLength(input)).toBe(17_899)
    expect(createHash('sha256').update(input).digest('hex'))
      .toBe('587536a152ae13944018116dce2f1d8e38a52d527b52ffdfc88b4ed744376d55')
    const authored = JSON.parse(input)
    const replay = JSON.parse(stringify(parse(input, 'npm-3'), 'npm-3', { strict: false }))
    expect(replay.packages['node_modules/taiz-bundler'])
      .toEqual(authored.packages['node_modules/taiz-bundler'])
  })

  const native = process.env.LOCKGRAPH_NPM_MANIFEST_NODE_ORACLE === '1' ? it : it.skip
  native('npm 11 accepts source and replay offline with identical installed trees', () => {
    const input = source()
    const authored = JSON.parse(input)
    const replay = stringify(parse(input, 'npm-3'), 'npm-3', { strict: false })
    const base = mkdtempSync(resolve(tmpdir(), 'lockgraph-npm-manifest-node-'))
    const cache = resolve(base, 'cache')
    const home = resolve(base, 'home')
    const npm = resolve('node_modules/pm-npm-11/bin/npm-cli.js')
    const writeProject = (name: string, lock: string): string => {
      const cwd = resolve(base, name)
      mkdirSync(cwd, { recursive: true })
      writeFileSync(resolve(cwd, 'package.json'), manifest(authored))
      writeFileSync(resolve(cwd, 'package-lock.json'), lock)
      return cwd
    }
    const run = (cwd: string, offline: boolean) => spawnSync(process.execPath, [
      npm, 'ci', '--ignore-scripts', '--audit=false', '--fund=false', '--cache', cache,
      ...(offline ? ['--offline'] : []),
    ], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, npm_config_cache: cache } })
    try {
      mkdirSync(home, { recursive: true })
      const primeDir = writeProject('prime', input)
      const exactDir = writeProject('exact', input)
      const replayDir = writeProject('replay', replay)
      const prime = run(primeDir, false)
      const exact = run(exactDir, true)
      const converted = run(replayDir, true)
      expect(prime.status, prime.stderr).toBe(0)
      expect(exact.status, exact.stderr).toBe(0)
      expect(converted.status, converted.stderr).toBe(0)
      expect(tree(resolve(replayDir, 'node_modules')))
        .toEqual(tree(resolve(exactDir, 'node_modules')))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  }, 300_000)
})
