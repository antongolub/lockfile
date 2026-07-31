#!/usr/bin/env node

// Compiles every marked TypeScript block in README.md against the built package,
// and runs the ones tagged with a fixture profile in an isolated, network-denied
// sandbox. A README example that no longer works is a failing build.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const out = join(root, 'target', 'readme-examples')
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const src = join(out, 'src')
const js = join(out, 'js')

const fixtures = {
  'simple-pnpm-v9-to-npm3': {
    lock: join(root, 'src/test/resources/fixtures/lockfiles/simple/pnpm-v9.lock'),
    as: 'pnpm-lock.yaml',
    async verify(cwd) {
      const lock = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8'))
      assert.equal(lock.lockfileVersion, 3)
      assert.deepEqual(Object.keys(lock.packages), ['', 'node_modules/lodash', 'node_modules/ms'])
      assert.equal(lock.packages[''].dependencies.lodash, '4.17.21')
      assert.equal(lock.packages[''].dependencies.ms, '2.1.3')
      assert.equal(lock.packages['node_modules/lodash'].version, '4.17.21')
      assert.equal(lock.packages['node_modules/ms'].version, '2.1.3')
    },
  },
}

// Emitting implies typechecking, so one compile per example covers both gates.
const tscArgs = ['--ignoreConfig', '--pretty', 'false', '--strict', '--target', 'ES2022',
  '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node',
  '--skipLibCheck', '--forceConsistentCasingInFileNames', '--rootDir', src, '--outDir', js]

const marker = /<!-- readme-example id="([a-z0-9-]+)" mode="(?:typecheck|fixture:([a-z0-9-]+))" -->/
const block = new RegExp(`^${marker.source}\\n\`\`\`ts\\n([\\s\\S]*?)^\`\`\`$`, 'gm')
const lineAt = (text, index) => text.slice(0, index).split('\n').length

const readme = await readFile(join(root, 'README.md'), 'utf8')
const examples = []
const errors = []

for (const match of readme.matchAll(block)) {
  const [whole, id, profile, source] = match
  if (examples.some((e) => e.id === id)) errors.push(`duplicate README example id: ${id}`)
  if (profile && !(profile in fixtures)) errors.push(`unknown fixture profile ${profile} for ${id}`)
  examples.push({ id, profile, source, fence: match.index + whole.indexOf('```ts') })
}

// Every ```ts fence must belong to an extracted block; the leftovers are fences
// that carry no marker, or that a marker opened and nothing closed.
for (const fence of readme.matchAll(/^```ts$/gm)) {
  if (examples.some((e) => e.fence === fence.index)) continue
  const preceding = readme.slice(0, fence.index).split('\n').at(-2) ?? ''
  const at = `README.md:${lineAt(readme, fence.index)}`
  errors.push(marker.test(preceding) ? `unclosed TypeScript fence at ${at}` : `unmarked TypeScript fence at ${at}`)
}

if (examples.length === 0) errors.push('README contains no marked TypeScript examples')

if (errors.length > 0) {
  for (const error of errors) console.error(`EXTRACT FAIL ${error}`)
  process.exit(1)
}
console.log(`EXTRACT PASS ${examples.length} marked TypeScript examples`)

await rm(out, { recursive: true, force: true })
await mkdir(src, { recursive: true })

// Named exports only — a transport holding its own reference before this loads is
// outside the guard. Re-prove denial when a fixture gains an alternate transport.
const denyNetwork = join(out, 'deny-network.mjs')
await writeFile(denyNetwork, `
import { syncBuiltinESMExports } from 'node:module'
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
const deny = () => { throw new Error('README example attempted network access') }
for (const [module, names] of [[dns, ['lookup', 'resolve', 'resolve4', 'resolve6']],
  [http, ['get', 'request']], [https, ['get', 'request']],
  [net, ['connect', 'createConnection']], [tls, ['connect']]]) {
  for (const name of names) if (typeof module[name] === 'function') module[name] = deny
}
globalThis.fetch = deny
syncBuiltinESMExports()
`)

const failed = { type: [], runtime: [] }
const passed = { type: [], runtime: [] }

const report = (kind, id, ok, detail) => {
  ;(ok ? passed : failed)[kind].push(id)
  ;(ok ? console.log : console.error)(`${kind.toUpperCase()} ${ok ? 'PASS' : 'FAIL'} ${id}`)
  if (!ok && detail) console.error(detail)
}

for (const example of examples) {
  // Compiled one at a time: an example must stand alone, not lean on its neighbours.
  const file = join(src, `${example.id}.ts`)
  await writeFile(file, example.source)
  const compiled = spawnSync(process.execPath, [tsc, ...tscArgs, file], { cwd: root, encoding: 'utf8' })

  const output = `${compiled.stdout}${compiled.stderr}`.trim()
  report('type', example.id, compiled.status === 0, output)
  if (compiled.status !== 0 || !example.profile) continue

  const fixture = fixtures[example.profile]
  const cwd = join(out, 'work', example.id)
  await mkdir(join(cwd, 'home'), { recursive: true })
  await mkdir(join(cwd, 'tmp'), { recursive: true })
  await copyFile(fixture.lock, join(cwd, fixture.as))

  const executed = spawnSync(process.execPath, ['--import', denyNetwork, join(js, `${example.id}.js`)], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: join(cwd, 'home'), TMPDIR: join(cwd, 'tmp'), XDG_CACHE_HOME: join(cwd, 'home', '.cache') },
  })

  try {
    assert.equal(executed.status, 0, `${executed.stdout}${executed.stderr}`.trim() || `process exited ${executed.status}`)
    await fixture.verify(cwd)
    report('runtime', example.id, true)
  } catch (error) {
    report('runtime', example.id, false, error instanceof Error ? error.message : String(error))
  }
}

console.log(`SUMMARY type ${passed.type.length} passed / ${failed.type.length} failed; ` +
  `runtime ${passed.runtime.length} passed / ${failed.runtime.length} failed`)
for (const kind of ['type', 'runtime']) {
  if (failed[kind].length > 0) console.error(`FAILED ${kind.toUpperCase()} IDS ${failed[kind].join(', ')}`)
}

if (failed.type.length + failed.runtime.length > 0) process.exitCode = 1
