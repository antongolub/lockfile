#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { fixtures as npmFixtures } from '../resources/installed-tree/npm.mjs'
import { fixtures as pnpmFixtures } from '../resources/installed-tree/pnpm.mjs'
import { fixtures as yarnClassicFixtures } from '../resources/installed-tree/yarn-classic.mjs'
import { fixtures as yarnBerryFixtures } from '../resources/installed-tree/yarn-berry.mjs'
import { fixtures as bunFixtures } from '../resources/installed-tree/bun.mjs'
import { fixtures as denoFixtures } from '../resources/installed-tree/deno.mjs'

export const RECEIPT_SCHEMA_VERSION = 1
export const REQUIRED_PER_FAMILY = 2

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const RECEIPT_DIR = resolve(ROOT, 'target/installed-tree-oracle')
const FAMILIES = ['npm', 'pnpm', 'yarn-classic', 'yarn-berry', 'bun', 'deno']
const LOCK_NAMES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'deno.lock',
])
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gu

const notRunLeg = () => ({
  status: 'NOT_RUN',
  exitCode: null,
  signal: null,
  durationMs: 0,
  output: '',
})

function passedLeg(result = {}) {
  return {
    status: 'PASS',
    exitCode: result.exitCode ?? 0,
    signal: result.signal ?? null,
    durationMs: result.durationMs ?? 0,
    output: normalizeDiagnostic(result.output ?? ''),
  }
}

function failedLeg(error) {
  return {
    status: 'FAIL',
    exitCode: error.exitCode ?? null,
    signal: error.signal ?? null,
    durationMs: error.durationMs ?? 0,
    output: normalizeDiagnostic(error.output ?? error.message ?? String(error)),
  }
}

export function normalizeDiagnostic(value) {
  return String(value)
    .replaceAll('\\', '/')
    .replace(/\/Users\/[^/\s]+(?:\/[\w.@+-]+)*(?=\/\.npm\/_cacache)/gu, '<HOME>')
    .replace(/\/(?:private\/)?(?:var\/folders\/[^\s]+|tmp)(?:\/[^\s]*)?/gu, '<TMP>')
    .replace(/\/home\/[^/\s]+(?:\/[^\s]*)?/gu, '<HOME>')
    .replace(/\/Users\/[^/\s]+(?:\/[^\s]*)?/gu, '<HOME>')
    .replace(/(?:<HOME>)?\/?\.npm\/_cacache(?:\/[^\s]*)?/gu, '<CACHE>')
    .replace(/\(node:\d+\)/gu, '(node:<PID>)')
    .replace(/(?:\/\/[^/\s]+\/):_authToken=[^\s]+/giu, '$1:_authToken=<REDACTED>')
    .replace(/(?:authorization|bearer)(?:\s*[:=]\s*|\s+)[^\s]+/giu, 'authorization=<REDACTED>')
    .slice(-12_000)
}

function emptyFixtureReceipt(fixture) {
  const treeApplicable = fixture.treeSurface !== 'none'
  return {
    id: fixture.id,
    family: fixture.family,
    format: fixture.format,
    provenance: {
      repository: fixture.repository,
      commit: fixture.commit,
      path: fixture.repositoryPath ?? fixture.lockfile,
    },
    certifies: [],
    installedTree: treeApplicable
      ? { status: 'APPLICABLE', reason: null }
      : { status: 'N/A', reason: 'NO_PROJECT_TREE_SURFACE' },
    qualification: { status: 'REFUSED', reason: null },
    classification: 'AMBIGUOUS_EXECUTION',
    tool: {
      alias: fixture.tool.alias,
      version: fixture.tool.version,
      runtime: fixture.tool.runtime,
    },
    source: {
      online: notRunLeg(),
      offline: [],
      treeDigests: [],
      rebuild: notRunLeg(),
      rebuildWorkDigest: null,
      rebuildTreeDigest: null,
    },
    replay: {
      conversionDigest: null,
      offline: notRunLeg(),
      treeDigest: null,
      rebuild: notRunLeg(),
      rebuildWorkDigest: null,
      rebuildTreeDigest: null,
    },
    evidence: {
      nativeOutput: '',
      treeDiff: [],
      rebuildDiff: [],
      networkAttempts: [],
    },
  }
}

function qualificationReason(error, fallback) {
  const allowed = new Set([
    'BINARY_MISSING',
    'WRITER_MISMATCH',
    'COMPANION_MISSING',
    'PRIVATE_REGISTRY',
    'FIXTURE_UNREACHABLE',
    'FIXTURE_HASH_MISMATCH',
    'SOURCE_REWRITE',
    'SOURCE_ONLINE_FAILED',
    'SOURCE_OFFLINE_OPEN',
    'SOURCE_TREE_NONDETERMINISTIC',
  ])
  if (allowed.has(error.code)) return error.code
  if (['ENETUNREACH', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)) {
    return 'FIXTURE_UNREACHABLE'
  }
  return fallback
}

function isAmbiguous(error) {
  if (error.code === 'ENOTCACHED') return false
  return Boolean(error.signal) || error.timedOut === true || error.exitCode == null
}

function unexpectedNetworkAttempts(output, fixture) {
  const allowed = new Set(fixture.allowedOrigins)
  return [...new Set(String(output).match(URL_PATTERN) ?? [])]
    .filter(value => {
      try { return !allowed.has(new URL(value).origin) } catch { return true }
    })
    .map(normalizeDiagnostic)
}

export async function runFixture(fixture, driver) {
  const receipt = emptyFixtureReceipt(fixture)
  const treeApplicable = receipt.installedTree.status === 'APPLICABLE'

  try {
    try {
      await driver.obtainFixture(fixture)
    } catch (error) {
      receipt.qualification.reason = qualificationReason(error, 'FIXTURE_UNREACHABLE')
      receipt.classification = 'QUALIFICATION_REGRESSION'
      receipt.evidence.nativeOutput = failedLeg(error).output
      return receipt
    }

    try {
      const online = await driver.sourceOnline(fixture)
      receipt.source.online = passedLeg(online)
    } catch (error) {
      receipt.source.online = failedLeg(error)
      receipt.qualification.reason = qualificationReason(error, 'SOURCE_ONLINE_FAILED')
      receipt.classification = 'QUALIFICATION_REGRESSION'
      return receipt
    }

    for (let pass = 0; pass < 2; pass += 1) {
      try {
        const offline = await driver.sourceOffline(fixture, pass)
        if (treeApplicable) {
          if (typeof offline.treeDigest !== 'string') {
            throw makeError('source installed-tree digest is missing', {
              code: 'SOURCE_TREE_NONDETERMINISTIC',
            })
          }
          receipt.source.treeDigests.push(offline.treeDigest)
        }
        receipt.source.offline.push(passedLeg(offline))
      } catch (error) {
        receipt.source.offline.push(failedLeg(error))
        receipt.qualification.reason = qualificationReason(error, 'SOURCE_OFFLINE_OPEN')
        receipt.classification = 'QUALIFICATION_REGRESSION'
        return receipt
      }
    }

    if (treeApplicable && receipt.source.treeDigests[0] !== receipt.source.treeDigests[1]) {
      receipt.qualification.reason = 'SOURCE_TREE_NONDETERMINISTIC'
      receipt.evidence.treeDiff = driver.diffSourceTrees
        ? await driver.diffSourceTrees(fixture)
        : [
            `source-pass-1 ${receipt.source.treeDigests[0]}`,
            `source-pass-2 ${receipt.source.treeDigests[1]}`,
          ]
      receipt.classification = 'QUALIFICATION_REGRESSION'
      return receipt
    }

    receipt.qualification = { status: 'QUALIFIED', reason: null }

    try {
      const conversion = await driver.replay(fixture)
      receipt.replay.conversionDigest = conversion.digest
    } catch (error) {
      receipt.classification = isAmbiguous(error) ? 'AMBIGUOUS_EXECUTION' : 'PRODUCT_DEFECT'
      receipt.evidence.nativeOutput = failedLeg(error).output
      return receipt
    }

    let productDefect = false
    try {
      const replay = await driver.replayOffline(fixture)
      if (treeApplicable && typeof replay.treeDigest !== 'string') {
        throw makeError('replay installed-tree digest is missing', { exitCode: 1 })
      }
      receipt.replay.offline = passedLeg(replay)
      if (treeApplicable) receipt.replay.treeDigest = replay.treeDigest
      receipt.evidence.networkAttempts = unexpectedNetworkAttempts(replay.output, fixture)
      if (receipt.evidence.networkAttempts.length > 0) {
        productDefect = true
      }
    } catch (error) {
      receipt.replay.offline = failedLeg(error)
      receipt.evidence.nativeOutput = receipt.replay.offline.output
      receipt.evidence.networkAttempts = unexpectedNetworkAttempts(receipt.evidence.nativeOutput, fixture)
      receipt.classification = isAmbiguous(error) ? 'AMBIGUOUS_EXECUTION' : 'PRODUCT_DEFECT'
      return receipt
    }

    if (treeApplicable && receipt.replay.treeDigest !== receipt.source.treeDigests[0]) {
      receipt.evidence.treeDiff = driver.diffTrees
        ? await driver.diffTrees(fixture)
        : [
            `source ${receipt.source.treeDigests[0]}`,
            `replay ${receipt.replay.treeDigest}`,
          ]
      productDefect = true
    }

    if (driver.supportsRebuild?.() === true) {
      try {
        const sourceRebuild = await driver.sourceRebuild(fixture)
        receipt.source.rebuild = passedLeg(sourceRebuild)
        receipt.source.rebuildWorkDigest = sourceRebuild.workDigest
        receipt.source.rebuildTreeDigest = sourceRebuild.treeDigest
      } catch (error) {
        receipt.source.rebuild = failedLeg(error)
        receipt.qualification = { status: 'REFUSED', reason: 'SOURCE_REBUILD_FAILED' }
        receipt.classification = 'QUALIFICATION_REGRESSION'
        return receipt
      }

      try {
        const replayRebuild = await driver.replayRebuild(fixture)
        receipt.replay.rebuild = passedLeg(replayRebuild)
        receipt.replay.rebuildWorkDigest = replayRebuild.workDigest
        receipt.replay.rebuildTreeDigest = replayRebuild.treeDigest
      } catch (error) {
        receipt.replay.rebuild = failedLeg(error)
        receipt.evidence.nativeOutput = receipt.replay.rebuild.output
        receipt.classification = isAmbiguous(error) ? 'AMBIGUOUS_EXECUTION' : 'PRODUCT_DEFECT'
        return receipt
      }

      if (
        receipt.source.rebuildWorkDigest !== receipt.replay.rebuildWorkDigest
        || receipt.source.rebuildTreeDigest !== receipt.replay.rebuildTreeDigest
      ) {
        receipt.evidence.rebuildDiff = [
          `source work ${receipt.source.rebuildWorkDigest}`,
          `replay work ${receipt.replay.rebuildWorkDigest}`,
          `source tree ${receipt.source.rebuildTreeDigest}`,
          `replay tree ${receipt.replay.rebuildTreeDigest}`,
        ]
        productDefect = true
      }
    }

    receipt.classification = productDefect ? 'PRODUCT_DEFECT' : 'PASS'
    if (receipt.classification === 'PASS') {
      receipt.certifies = treeApplicable
        ? ['acceptance', 'cache-closure', 'tree-equivalence']
        : ['acceptance', 'cache-closure']
    }
    return receipt
  } finally {
    await driver.cleanup?.()
  }
}

function familyCount(fixtures, family) {
  const selected = fixtures.filter(fixture => fixture.family === family)
  const qualified = selected.filter(fixture => fixture.qualification.status === 'QUALIFIED')
  return {
    requested: REQUIRED_PER_FAMILY,
    qualified: qualified.length,
    executed: selected.filter(fixture => fixture.replay.offline.status !== 'NOT_RUN').length,
    passed: selected.filter(fixture => fixture.classification === 'PASS').length,
    breadth: {
      generations: [...new Set(qualified.map(fixture => fixture.format))].sort(),
      repositories: [...new Set(qualified.map(fixture => fixture.provenance.repository))].sort(),
    },
  }
}

function runClassification(fixtures, familySummary) {
  if (fixtures.some(fixture => fixture.classification === 'PRODUCT_DEFECT')) return 'PRODUCT_DEFECT'
  if (fixtures.some(fixture => fixture.classification === 'AMBIGUOUS_EXECUTION')) return 'AMBIGUOUS_EXECUTION'
  if (fixtures.some(fixture => fixture.classification === 'QUALIFICATION_REGRESSION')) {
    return 'QUALIFICATION_REGRESSION'
  }
  if (Object.values(familySummary).some(family => family.qualified < REQUIRED_PER_FAMILY)) {
    return 'QUALIFICATION_REGRESSION'
  }
  return 'PASS'
}

export async function runSample({
  fixtures,
  createDriver,
  runId = randomUUID(),
  createdAt = new Date().toISOString(),
  platform = process.platform,
}) {
  const fixtureReceipts = []
  for (const fixture of fixtures) {
    fixtureReceipts.push(await runFixture(fixture, createDriver(fixture)))
  }
  const familySummary = Object.fromEntries(
    FAMILIES.map(family => [family, familyCount(fixtureReceipts, family)]),
  )

  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    runId,
    createdAt,
    platform,
    concurrency: 1,
    pressureClassifier: 'deferred',
    classification: runClassification(fixtureReceipts, familySummary),
    familySummary,
    fixtures: fixtureReceipts,
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function rebuildWorkDigest(output) {
  const work = normalizeDiagnostic(output).split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('$') || /: (?:Done|Failed)$/u.test(line))
  return `sha256:${sha256(work.join('\n'))}`
}

function makeError(message, fields = {}) {
  return Object.assign(new Error(message), fields)
}

function runtimeFor(name) {
  if (name === 'node18') return process.env.LOCKGRAPH_NODE18 || process.execPath
  if (name === 'node22') return process.env.LOCKGRAPH_NODE22 || process.execPath
  return process.execPath
}

async function runProcess(command, args, { cwd, env, timeoutMs = 240_000 } = {}) {
  const startedAt = performance.now()
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', error => {
      rejectPromise(makeError(error.message, {
        code: error.code === 'ENOENT' ? 'BINARY_MISSING' : error.code,
        exitCode: null,
        durationMs: performance.now() - startedAt,
        output,
      }))
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      const result = {
        exitCode,
        signal,
        durationMs: performance.now() - startedAt,
        output,
      }
      if (exitCode === 0 && signal == null) resolvePromise(result)
      else rejectPromise(makeError(`command failed with ${signal ?? `exit ${exitCode}`}`, {
        ...result,
        timedOut: signal === 'SIGKILL',
        code: /ENOTCACHED|ERR_PNPM_META_FETCH_FAIL|offline.*metadata/iu.test(output)
          ? 'ENOTCACHED'
          : undefined,
      }))
    })
  })
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableJson(value[key])]))
  }
  return value
}

function normalizedFile(bytes, path, replacements) {
  // pnpm copies the project lock into the virtual store. Its bytes duplicate
  // the already frozen-validated conversion input; semantic install state is
  // asserted separately through `.modules.yaml` and the materialized tree.
  if (path === '.pnpm/lock.yaml') return Buffer.from('<PROJECT_LOCK_MIRROR>')
  if (bytes.includes(0)) return bytes
  let text = bytes.toString('utf8')
  if (!Buffer.from(text).equals(bytes)) return bytes
  for (const [from, to] of replacements) text = text.replaceAll(from, to)
  if (basename(path) === '.modules.yaml') {
    text = text.replace(/^\s*"?prunedAt"?:.*$/gmu, 'prunedAt: <TIME>')
  }
  if (basename(path) === '.pnpm-workspace-state-v1.json') {
    try {
      const state = JSON.parse(text)
      delete state.lastValidatedTimestamp
      text = JSON.stringify(stableJson(state))
    } catch {}
  }
  if (basename(path) === '.package-lock.json') {
    try { text = JSON.stringify(stableJson(JSON.parse(text))) } catch {}
  }
  return Buffer.from(text)
}

function inventory(root, replacements) {
  const rows = []
  function visit(path) {
    const stat = lstatSync(path)
    const rel = relative(root, path).split(sep).join('/') || '.'
    const mode = (stat.mode & 0o777).toString(8)
    if (stat.isSymbolicLink()) {
      let target = readlinkSync(path).replaceAll('\\', '/')
      for (const [from, to] of replacements) target = target.replaceAll(from, to)
      rows.push(`${rel}\tsymlink\t${target}`)
      return
    }
    if (stat.isDirectory()) {
      rows.push(`${rel}\tdir\t${mode}`)
      for (const name of readdirSync(path).sort()) visit(join(path, name))
      return
    }
    if (stat.isFile()) {
      const data = normalizedFile(readFileSync(path), rel, replacements)
      rows.push(`${rel}\tfile\t${mode}\t${sha256(data)}`)
    }
  }
  visit(root)
  return rows
}

function copyTree(source, target) {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(readlinkSync(source), target)
  } else if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name))
  } else {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
    chmodSync(target, stat.mode & 0o777)
  }
}

async function materialize(file, project) {
  let bytes
  if (typeof file.content === 'string') {
    bytes = Buffer.from(file.content)
  } else {
    let response
    try {
      response = await fetch(file.url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
    } catch (error) {
      throw makeError(`fixture file unavailable: ${file.path}`, {
        code: 'FIXTURE_UNREACHABLE',
        output: error.message,
      })
    }
    if (!response.ok) {
      throw makeError(`fixture file unavailable: ${file.path} (${response.status})`, {
        code: response.status === 404 ? 'COMPANION_MISSING' : 'FIXTURE_UNREACHABLE',
      })
    }
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (sha256(bytes) !== file.sha256) {
    throw makeError(`fixture digest mismatch: ${file.path}`, { code: 'FIXTURE_HASH_MISMATCH' })
  }
  const target = resolve(project, file.path)
  if (!target.startsWith(`${project}${sep}`)) {
    throw makeError(`fixture path escapes project: ${file.path}`, { code: 'COMPANION_MISSING' })
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
}

class NativeDriver {
  constructor(fixture) {
    this.fixture = fixture
    this.root = mkdtempSync(join(tmpdir(), 'lockgraph-installed-tree-'))
    this.source = join(this.root, 'source')
    this.replayProject = join(this.root, 'replay')
    this.cache = join(this.root, 'cache')
    this.sourceInventory = []
    this.sourceInventories = []
    this.replayInventory = []
  }

  async obtainFixture() {
    mkdirSync(this.source, { recursive: true })
    mkdirSync(this.cache, { recursive: true })
    for (const file of this.fixture.files) await materialize(file, this.source)

    const lockPath = join(this.source, this.fixture.lockfile)
    if (!LOCK_NAMES.has(basename(lockPath))) {
      throw makeError('fixture lockfile is not declared', { code: 'COMPANION_MISSING' })
    }
    this.sourceLockDigest = sha256(readFileSync(lockPath))

    const version = await this.runTool(['--version'], {
      cwd: this.source,
      timeoutMs: 30_000,
    })
    const reportedVersion = this.fixture.family === 'deno'
      ? /^deno\s+(\S+)/u.exec(version.output.trim())?.[1]
      : version.output.trim()
    if (reportedVersion !== this.fixture.tool.version) {
      throw makeError(`writer mismatch: expected ${this.fixture.tool.version}`, {
        code: 'WRITER_MISMATCH',
        output: version.output,
      })
    }
  }

  runtime() {
    return runtimeFor(this.fixture.tool.runtime)
  }

  toolPath() {
    if (this.fixture.tool.path) return resolve(ROOT, this.fixture.tool.path)
    return resolve(ROOT, 'node_modules', this.fixture.tool.alias, this.fixture.tool.bin)
  }

  runTool(args, options) {
    return this.fixture.tool.runtime === 'native'
      ? runProcess(this.toolPath(), args, options)
      : runProcess(this.runtime(), [this.toolPath(), ...args], options)
  }

  commandEnvironment(offline) {
    if (this.fixture.family === 'npm') {
      return {
        NPM_CONFIG_CACHE: this.cache,
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      }
    }
    if (this.fixture.family === 'pnpm') {
      return {
        PNPM_HOME: join(this.root, 'pnpm-home'),
        PNPM_STORE_DIR: join(this.cache, 'store'),
        PNPM_CACHE_DIR: join(this.cache, 'metadata'),
      }
    }
    if (this.fixture.family === 'yarn-classic') {
      return {
        YARN_CACHE_FOLDER: join(this.cache, 'yarn-classic'),
        YARN_IGNORE_SCRIPTS: '1',
      }
    }
    if (this.fixture.family === 'yarn-berry') {
      return {
        YARN_CACHE_FOLDER: join(this.cache, 'yarn-berry'),
        YARN_ENABLE_GLOBAL_CACHE: 'false',
        YARN_ENABLE_NETWORK: offline ? 'false' : 'true',
        YARN_ENABLE_SCRIPTS: 'false',
        YARN_NODE_LINKER: 'node-modules',
      }
    }
    if (this.fixture.family === 'bun') {
      return {
        BUN_INSTALL_CACHE_DIR: join(this.cache, 'bun'),
      }
    }
    return {
      DENO_DIR: join(this.cache, 'deno'),
      DENO_NO_PROMPT: '1',
      DENO_NO_UPDATE_CHECK: '1',
      NO_COLOR: '1',
    }
  }

  command(offline) {
    const args = [...(offline ? this.fixture.commands.offline : this.fixture.commands.online)]
    if (this.fixture.family === 'pnpm') {
      args.push('--store-dir', join(this.cache, 'store'), '--cache-dir', join(this.cache, 'metadata'))
    }
    if (this.fixture.family === 'yarn-classic') {
      args.push('--cache-folder', join(this.cache, 'yarn-classic'))
    }
    return this.runTool(args, {
      cwd: offline === 'replay' ? this.replayProject : this.source,
      env: this.commandEnvironment(Boolean(offline)),
    })
  }

  treeRoot(project) {
    return join(project, this.fixture.treeSurface ?? 'node_modules')
  }

  assertSourceLockUnchanged() {
    const digest = sha256(readFileSync(join(this.source, this.fixture.lockfile)))
    if (digest !== this.sourceLockDigest) {
      throw makeError('source lockfile was rewritten', { code: 'SOURCE_REWRITE' })
    }
  }

  async sourceOnline() {
    const result = await this.command(false)
    this.assertSourceLockUnchanged()
    if (this.fixture.treeSurface !== 'none') {
      rmSync(this.treeRoot(this.source), { recursive: true, force: true })
    }
    return result
  }

  async sourceOffline() {
    if (this.fixture.treeSurface !== 'none') {
      rmSync(this.treeRoot(this.source), { recursive: true, force: true })
    }
    const result = await this.command(true)
    this.assertSourceLockUnchanged()
    if (this.fixture.treeSurface === 'none') return result
    this.sourceInventory = inventory(this.treeRoot(this.source), [
      [this.source.replaceAll('\\', '/'), '<PROJECT>'],
      [this.cache.replaceAll('\\', '/'), '<CACHE>'],
      [this.root.replaceAll('\\', '/'), '<WORK>'],
    ])
    this.sourceInventories.push(this.sourceInventory)
    return { ...result, treeDigest: `sha256:${sha256(this.sourceInventory.join('\n'))}` }
  }

  async replay() {
    mkdirSync(this.replayProject, { recursive: true })
    for (const file of this.fixture.files) {
      copyTree(join(this.source, file.path), join(this.replayProject, file.path))
    }
    const { parse, stringify } = await import('../../../dist/index.js')
    const input = readFileSync(join(this.source, this.fixture.lockfile), 'utf8')
    const output = stringify(parse(input, this.fixture.format), this.fixture.format, { strict: false })
    writeFileSync(join(this.replayProject, this.fixture.lockfile), output)
    return { digest: `sha256:${sha256(output)}` }
  }

  async replayOffline() {
    if (this.fixture.treeSurface !== 'none') {
      rmSync(this.treeRoot(this.replayProject), { recursive: true, force: true })
    }
    const result = await this.command('replay')
    if (this.fixture.treeSurface === 'none') return result
    this.replayInventory = inventory(this.treeRoot(this.replayProject), [
      [this.replayProject.replaceAll('\\', '/'), '<PROJECT>'],
      [this.cache.replaceAll('\\', '/'), '<CACHE>'],
      [this.root.replaceAll('\\', '/'), '<WORK>'],
    ])
    return { ...result, treeDigest: `sha256:${sha256(this.replayInventory.join('\n'))}` }
  }

  supportsRebuild() {
    return Array.isArray(this.fixture.commands.rebuild)
  }

  async rebuild(project) {
    const args = [
      ...this.fixture.commands.rebuild,
      '--store-dir', join(this.cache, 'store'),
    ]
    const result = await runProcess(this.runtime(), [this.toolPath(), ...args], {
      cwd: project,
      env: {
        CI: 'true',
        npm_config_offline: 'true',
        PNPM_HOME: join(this.root, 'pnpm-home'),
      },
    })
    const rows = inventory(join(project, 'node_modules'), [
      [project.replaceAll('\\', '/'), '<PROJECT>'],
      [this.cache.replaceAll('\\', '/'), '<CACHE>'],
      [this.root.replaceAll('\\', '/'), '<WORK>'],
    ])
    return {
      ...result,
      workDigest: rebuildWorkDigest(result.output),
      treeDigest: `sha256:${sha256(rows.join('\n'))}`,
    }
  }

  async sourceRebuild() {
    return this.rebuild(this.source)
  }

  async replayRebuild() {
    return this.rebuild(this.replayProject)
  }

  async diffTrees() {
    return this.diffInventories(this.sourceInventory, this.replayInventory, 'source', 'replay')
  }

  async diffSourceTrees() {
    return this.diffInventories(
      this.sourceInventories[0] ?? [],
      this.sourceInventories[1] ?? [],
      'source-pass-1',
      'source-pass-2',
    )
  }

  diffInventories(leftRows, rightRows, leftLabel, rightLabel) {
    const source = new Set(leftRows)
    const replay = new Set(rightRows)
    return [
      ...[...source].filter(row => !replay.has(row)).map(row => `${leftLabel}-only ${row}`),
      ...[...replay].filter(row => !source.has(row)).map(row => `${rightLabel}-only ${row}`),
    ].slice(0, 200).map(normalizeDiagnostic)
  }

  async cleanup() {
    rmSync(this.root, { recursive: true, force: true })
  }
}

export function createNativeDriver(fixture) {
  return new NativeDriver(fixture)
}

export async function main() {
  const profileAt = process.argv.indexOf('--profile')
  const profile = profileAt === -1 ? null : process.argv[profileAt + 1]
  if (profile !== 'pr') {
    console.error('usage: installed-tree-oracle.mjs --profile pr')
    process.exitCode = 2
    return
  }

  const receipt = await runSample({
    fixtures: [
      ...npmFixtures,
      ...pnpmFixtures,
      ...yarnClassicFixtures,
      ...yarnBerryFixtures,
      ...bunFixtures,
      ...denoFixtures,
    ],
    createDriver: createNativeDriver,
  })
  mkdirSync(RECEIPT_DIR, { recursive: true })
  const receiptPath = join(RECEIPT_DIR, 'receipt.json')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)

  console.log(`installed-tree oracle: ${receipt.classification}`)
  for (const fixture of receipt.fixtures) {
    console.log(`  ${fixture.id}: ${fixture.classification}${
      fixture.qualification.reason ? ` (${fixture.qualification.reason})` : ''
    }`)
  }
  console.log(`receipt: ${relative(ROOT, receiptPath)}`)
  if (receipt.classification !== 'PASS') process.exitCode = 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
