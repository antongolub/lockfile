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

interface Witness {
  readonly field: 'dev' | 'peer' | 'inBundle'
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  readonly path: string
}

const witnesses = {
  dev: {
    field: 'dev',
    file: '0Ankit0__express-node__package-lock.json',
    bytes: 44_670,
    sha256: 'a2e4a775b455a19d21e0e248dde8fb559baad79f3c27e70171c41b3b6900cc57',
    path: 'node_modules/mongoose/node_modules/ms',
  },
  peer: {
    field: 'peer',
    file: 'firebase__firebase-tools__scripts_agent-evals_package-lock.json',
    bytes: 111_575,
    sha256: 'ceb800bdb7a67a36e2b8462e54d5dcea02534a57ed4953c2b4cf823dcd0bf667',
    path: 'node_modules/eslint/node_modules/ansi-regex',
  },
  inBundle: {
    field: 'inBundle',
    file: 'npm__cli__workspaces_arborist_test_fixtures_testing-bundledeps-sw_package-lock.json',
    bytes: 4_368,
    sha256: '5943a9deb870060397c05d5e843694a122fd9a5e26fe6b458d75b8edaf74e4d7',
    path: 'node_modules/@isaacs/testing-bundledeps-b',
  },
} as const satisfies Record<string, Witness>

const corpusRoot = resolve('tmp/npm-corpus/raw')
const available = Object.values(witnesses).every(witness =>
  existsSync(resolve(corpusRoot, witness.file)))
const suite = available ? describe : describe.skip

function source(witness: Witness): string {
  return readFileSync(resolve(corpusRoot, witness.file), 'utf8')
}

function cloneWithToggledFlag(witness: Witness): Record<string, unknown> {
  const lock = JSON.parse(source(witness)) as {
    packages: Record<string, Record<string, unknown>>
  } & Record<string, unknown>
  const entry = lock.packages[witness.path]!
  if (entry[witness.field] === true) delete entry[witness.field]
  else entry[witness.field] = true
  return lock
}

function materializeRegistry<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll(
    '${REGISTRY}',
    'https://registry.npmjs.org',
  )) as T
}

function manifest(lock: { packages: Record<string, Record<string, unknown>> }): string {
  const root = structuredClone(lock.packages['']!)
  delete root.resolved
  delete root.integrity
  delete root.link
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
      const hash = createHash('sha256').update(readFileSync(absolute)).digest('hex')
      rows.push(`f ${relative} ${stat.size} ${hash}`)
    }
  }
  return rows
}

function nativeControl(
  witness: Witness,
  npmVersion: 8 | 11,
  extraArgs: readonly string[] = [],
): void {
  const exact = materializeRegistry(JSON.parse(source(witness)) as {
    packages: Record<string, Record<string, unknown>>
  })
  const clone = materializeRegistry(cloneWithToggledFlag(witness))
  const body = manifest(exact)
  const npm = resolve(`node_modules/pm-npm-${npmVersion}/bin/npm-cli.js`)
  const base = mkdtempSync(resolve(tmpdir(), `lockgraph-npm-${witness.field}-`))
  const cache = resolve(base, 'cache')
  const home = resolve(base, 'home')
  const writeProject = (name: string, lock: unknown): string => {
    const cwd = resolve(base, name)
    mkdirSync(cwd, { recursive: true })
    writeFileSync(resolve(cwd, 'package.json'), body)
    writeFileSync(resolve(cwd, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    return cwd
  }
  const run = (cwd: string, offline: boolean) => spawnSync(process.execPath, [
    npm,
    'ci',
    '--ignore-scripts',
    '--audit=false',
    '--fund=false',
    '--cache', cache,
    ...extraArgs,
    ...(offline ? ['--offline'] : []),
  ], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, NO_UPDATE_NOTIFIER: '1', npm_config_cache: cache },
  })

  try {
    mkdirSync(home, { recursive: true })
    const prime = writeProject('prime', exact)
    const exactOffline = writeProject('exact-offline', exact)
    const cloneOffline = writeProject('clone-offline', clone)
    const primeRun = run(prime, false)
    const exactRun = run(exactOffline, true)
    const cloneRun = run(cloneOffline, true)
    expect(primeRun.status, `${witness.field} npm${npmVersion} online prime:\n${primeRun.stdout}\n${primeRun.stderr}`).toBe(0)
    expect(exactRun.status, `${witness.field} npm${npmVersion} exact offline:\n${exactRun.stdout}\n${exactRun.stderr}`).toBe(0)
    expect(cloneRun.status, `${witness.field} npm${npmVersion} clone offline:\n${cloneRun.stdout}\n${cloneRun.stderr}`).toBe(0)
    expect(tree(resolve(cloneOffline, 'node_modules')))
      .toEqual(tree(resolve(exactOffline, 'node_modules')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

suite(
  available
    ? 'npm path-local dev/peer/inBundle native controls'
    : 'npm path-local dev/peer/inBundle native controls [skipped: corpus absent]',
  () => {
    for (const witness of Object.values(witnesses)) {
      it(`pins the exact ${witness.field} one-field witness`, () => {
        const input = source(witness)
        expect(Buffer.byteLength(input)).toBe(witness.bytes)
        expect(createHash('sha256').update(input).digest('hex')).toBe(witness.sha256)
        const exact = JSON.parse(input) as { packages: Record<string, Record<string, unknown>> }
        const toggled = cloneWithToggledFlag(witness) as {
          packages: Record<string, Record<string, unknown>>
        }
        const before = exact.packages[witness.path]![witness.field]
        const after = toggled.packages[witness.path]![witness.field]
        expect([before, after]).toEqual(before === true ? [true, undefined] : [undefined, true])
      })
    }

    const native = process.env.LOCKGRAPH_NPM_PATH_LOCAL_FLAGS_ORACLE === '1' ? it : it.skip
    native('dev is inert under npm 11 --omit=dev', () => {
      nativeControl(witnesses.dev, 11, ['--omit=dev'])
    }, 300_000)
    native('peer is inert under npm 11 default and --legacy-peer-deps', () => {
      nativeControl(witnesses.peer, 11)
      nativeControl(witnesses.peer, 11, ['--legacy-peer-deps'])
    }, 300_000)
    native('inBundle is inert under npm 8 and npm 11', () => {
      nativeControl(witnesses.inBundle, 8)
      nativeControl(witnesses.inBundle, 11)
    }, 300_000)
  },
)
