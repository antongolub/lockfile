#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readmePath = join(root, 'README.md')
const generatedRoot = join(root, 'target', 'readme-examples')
const examplesRoot = join(generatedRoot, 'examples')
const runtimeRoot = join(generatedRoot, 'runtime')
const workRoot = join(generatedRoot, 'work')
const tscPath = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const markerPattern = /^<!-- readme-example id="([a-z0-9-]+)" mode="(typecheck|fixture:([a-z0-9-]+))" -->$/

const fixtureProfiles = {
  'simple-pnpm-v9-to-npm3': {
    source: join(
      root,
      'src',
      'test',
      'resources',
      'fixtures',
      'lockfiles',
      'simple',
      'pnpm-v9.lock',
    ),
    input: 'pnpm-lock.yaml',
    async verify(cwd) {
      const lock = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8'))
      assert.equal(lock.lockfileVersion, 3)
      assert.deepEqual(Object.keys(lock.packages), [
        '',
        'node_modules/lodash',
        'node_modules/ms',
      ])
      assert.equal(lock.packages[''].dependencies.lodash, '4.17.21')
      assert.equal(lock.packages[''].dependencies.ms, '2.1.3')
      assert.equal(lock.packages['node_modules/lodash'].version, '4.17.21')
      assert.equal(lock.packages['node_modules/ms'].version, '2.1.3')
    },
  },
}

const compilerArgs = [
  '--ignoreConfig',
  '--pretty',
  'false',
  '--strict',
  '--target',
  'ES2022',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--types',
  'node',
  '--skipLibCheck',
  '--forceConsistentCasingInFileNames',
]

const source = await readFile(readmePath, 'utf8')
const lines = source.split(/\r?\n/u)
const examples = []
const ids = new Set()
const extractionErrors = []
let markerCount = 0

for (let index = 0; index < lines.length; index += 1) {
  const marker = lines[index].match(markerPattern)
  if (marker) {
    markerCount += 1
    if (lines[index + 1] !== '```ts') {
      extractionErrors.push(
        `marker ${marker[1]} at README.md:${index + 1} is not followed by a TypeScript fence`,
      )
    }
    continue
  }

  if (lines[index] !== '```ts') continue

  const preceding = lines[index - 1]?.match(markerPattern)
  if (!preceding) {
    extractionErrors.push(`unmarked TypeScript fence at README.md:${index + 1}`)
    continue
  }

  const [, id, mode, profile] = preceding
  if (ids.has(id)) {
    extractionErrors.push(`duplicate README example id: ${id}`)
  }
  ids.add(id)

  let closing = index + 1
  while (closing < lines.length && lines[closing] !== '```') closing += 1
  if (closing === lines.length) {
    extractionErrors.push(`unclosed TypeScript fence for ${id} at README.md:${index + 1}`)
    break
  }

  if (profile && !(profile in fixtureProfiles)) {
    extractionErrors.push(`unknown fixture profile ${profile} for ${id}`)
  }

  examples.push({
    id,
    mode,
    profile,
    line: index + 1,
    source: `${lines.slice(index + 1, closing).join('\n')}\n`,
  })
  index = closing
}

if (markerCount !== examples.length) {
  extractionErrors.push(
    `found ${markerCount} markers but extracted ${examples.length} TypeScript fences`,
  )
}
if (examples.length === 0) extractionErrors.push('README contains no marked TypeScript examples')

if (extractionErrors.length > 0) {
  for (const error of extractionErrors) console.error(`EXTRACT FAIL ${error}`)
  process.exitCode = 1
} else {
  console.log(`EXTRACT PASS ${examples.length} marked TypeScript examples`)
}

if (process.exitCode) process.exit()

await rm(generatedRoot, { recursive: true, force: true })
await mkdir(examplesRoot, { recursive: true })
await mkdir(runtimeRoot, { recursive: true })
await mkdir(workRoot, { recursive: true })

const networkGuardPath = join(generatedRoot, 'deny-network.mjs')
await writeFile(
  networkGuardPath,
  `import { syncBuiltinESMExports } from 'node:module'\n` +
    `import dns from 'node:dns'\n` +
    `import http from 'node:http'\n` +
    `import https from 'node:https'\n` +
    `import net from 'node:net'\n` +
    `import tls from 'node:tls'\n` +
    `const deny = () => { throw new Error('README example attempted network access') }\n` +
    `for (const [module, names] of [[dns, ['lookup', 'resolve', 'resolve4', 'resolve6']], [http, ['get', 'request']], [https, ['get', 'request']], [net, ['connect', 'createConnection']], [tls, ['connect']]]) {\n` +
    `  for (const name of names) if (typeof module[name] === 'function') module[name] = deny\n` +
    `}\n` +
    `globalThis.fetch = deny\n` +
    `syncBuiltinESMExports()\n`,
)

const typeFailures = []
const typePasses = []
const runtimeFailures = []
const runtimePasses = []

for (const example of examples) {
  const inputPath = join(examplesRoot, `${example.id}.ts`)
  await writeFile(inputPath, example.source)

  const checked = spawnSync(
    process.execPath,
    [tscPath, ...compilerArgs, '--noEmit', inputPath],
    { cwd: root, encoding: 'utf8' },
  )

  if (checked.status !== 0) {
    typeFailures.push(example.id)
    console.error(`TYPE FAIL ${example.id} (README.md:${example.line})`)
    const diagnostics = `${checked.stdout}${checked.stderr}`.trim()
    if (diagnostics) console.error(diagnostics)
    continue
  }

  typePasses.push(example.id)
  console.log(`TYPE PASS ${example.id}`)

  if (!example.profile) continue

  const emittedRoot = join(runtimeRoot, example.id)
  const emitted = spawnSync(
    process.execPath,
    [
      tscPath,
      ...compilerArgs,
      '--rootDir',
      examplesRoot,
      '--outDir',
      emittedRoot,
      inputPath,
    ],
    { cwd: root, encoding: 'utf8' },
  )
  if (emitted.status !== 0) {
    runtimeFailures.push(example.id)
    console.error(`RUNTIME FAIL ${example.id}: fixture compilation failed`)
    const diagnostics = `${emitted.stdout}${emitted.stderr}`.trim()
    if (diagnostics) console.error(diagnostics)
    continue
  }

  const profile = fixtureProfiles[example.profile]
  const cwd = join(workRoot, example.id)
  await rm(cwd, { recursive: true, force: true })
  await mkdir(join(cwd, 'home'), { recursive: true })
  await mkdir(join(cwd, 'tmp'), { recursive: true })
  await copyFile(profile.source, join(cwd, profile.input))

  const executed = spawnSync(
    process.execPath,
    ['--import', networkGuardPath, join(emittedRoot, `${example.id}.js`)],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: join(cwd, 'home'),
        TMPDIR: join(cwd, 'tmp'),
        XDG_CACHE_HOME: join(cwd, 'home', '.cache'),
      },
    },
  )

  try {
    assert.equal(
      executed.status,
      0,
      `${executed.stdout}${executed.stderr}`.trim() || `process exited ${executed.status}`,
    )
    await profile.verify(cwd)
    runtimePasses.push(example.id)
    console.log(`RUNTIME PASS ${example.id} (${example.profile})`)
  } catch (error) {
    runtimeFailures.push(example.id)
    console.error(`RUNTIME FAIL ${example.id} (${example.profile})`)
    console.error(error instanceof Error ? error.message : String(error))
  }
}

console.log(
  `SUMMARY type ${typePasses.length} passed / ${typeFailures.length} failed; ` +
    `runtime ${runtimePasses.length} passed / ${runtimeFailures.length} failed`,
)
if (typeFailures.length > 0) console.error(`FAILED TYPE IDS ${typeFailures.join(', ')}`)
if (runtimeFailures.length > 0) console.error(`FAILED RUNTIME IDS ${runtimeFailures.join(', ')}`)

if (typeFailures.length > 0 || runtimeFailures.length > 0) process.exitCode = 1
