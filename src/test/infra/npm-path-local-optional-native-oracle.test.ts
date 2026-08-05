import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/formats/npm-2.ts'

const fixture = resolve('tmp/npm-corpus/raw/aws-samples__cluster-sample-app__package-lock.json')
const corpusAvailable = existsSync(fixture)
const suite = corpusAvailable ? describe : describe.skip
const targetPath = 'node_modules/safer-buffer'
const bundledPath = 'node_modules/npm/node_modules/safer-buffer'

function source(): string {
  return readFileSync(fixture, 'utf8')
}

function packageJson(lock: { packages: Record<string, Record<string, unknown>> }): string {
  const root = structuredClone(lock.packages['']!)
  delete root.resolved
  delete root.integrity
  delete root.link
  return `${JSON.stringify(root, null, 2)}\n`
}

function writeProject(path: string, lock: Record<string, unknown>, manifest: string): void {
  mkdirSync(path, { recursive: true })
  writeFileSync(resolve(path, 'package.json'), manifest)
  writeFileSync(resolve(path, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
}

suite(
  corpusAvailable
    ? 'npm path-local optional native oracle'
    : 'npm path-local optional native oracle [skipped: exact corpus fixture absent]',
  () => {
    it('pins the exact real npm-v2 optional-spread witness', () => {
      expect(Buffer.byteLength(source())).toBe(241_960)
      expect(createHash('sha256').update(source()).digest('hex'))
        .toBe('5646efedd8b57e8622629a2fb4ce027b68da523ae71f18bb0473ba2922ee5ebd')
    })

    it('keeps the bundled optional cell without fabricating it at the required path', () => {
      const authored = JSON.parse(source()) as {
        packages: Record<string, { optional?: boolean }>
      }
      const emitted = JSON.parse(stringify(parse(source()))) as typeof authored
      expect(authored.packages[targetPath]?.optional).toBeUndefined()
      expect(authored.packages[bundledPath]?.optional).toBe(true)
      expect(emitted.packages[bundledPath]?.optional).toBe(true)
      expect(emitted.packages[targetPath]?.optional).toBeUndefined()
    })

    const native = process.env.LOCKGRAPH_NPM_OPTIONAL_OFFLINE_ORACLE === '1' ? it : it.skip
    native('proves one false optional cell converts a required offline failure into exit zero', () => {
      const base = mkdtempSync(resolve(tmpdir(), 'lockgraph-npm-optional-'))
      try {
        const authored = JSON.parse(source()) as {
          packages: Record<string, Record<string, unknown>>
          [key: string]: unknown
        }
        const manifest = packageJson(authored)
        const cache = resolve(base, 'cache')
        const npmCli = resolve('node_modules/pm-npm-8/bin/npm-cli.js')
        const run = (cwd: string, offline: boolean) => spawnSync(process.execPath, [
          npmCli,
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

        const prime = resolve(base, 'prime')
        mkdirSync(resolve(base, 'home'), { recursive: true })
        writeProject(prime, authored, manifest)
        expect(run(prime, false).status).toBe(0)

        const required = structuredClone(authored)
        required.packages[targetPath]!.resolved =
          'https://registry.npmjs.org/safer-buffer/-/safer-buffer-0.0.0-lockfile-flag-control.tgz'
        required.packages[targetPath]!.integrity =
          `sha512-${Buffer.alloc(64).toString('base64')}`
        const optional = structuredClone(required)
        optional.packages[targetPath]!.optional = true
        const restored = structuredClone(optional)
        delete restored.packages[targetPath]!.optional
        expect(restored).toEqual(required)

        const requiredDir = resolve(base, 'required')
        const optionalDir = resolve(base, 'optional')
        writeProject(requiredDir, required, manifest)
        writeProject(optionalDir, optional, manifest)
        const requiredRun = run(requiredDir, true)
        const optionalRun = run(optionalDir, true)
        expect(requiredRun.status).toBe(1)
        expect(`${requiredRun.stdout}\n${requiredRun.stderr}`).toContain('ENOTCACHED')
        expect(optionalRun.status).toBe(0)
        expect(existsSync(optionalDir)).toBe(false)
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    }, 60_000)
  },
)
