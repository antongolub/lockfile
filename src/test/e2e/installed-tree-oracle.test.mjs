import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createNativeDriver,
  normalizeDiagnostic,
  runFixture,
  runSample,
} from './installed-tree-oracle.mjs'

const schema = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../resources/installed-tree/receipt.schema.json',
  import.meta.url,
)), 'utf8'))

const fixture = (id = 'npm-a', family = 'npm', fields = {}) => ({
  id,
  family,
  format: `${family}-fixture`,
  repository: `example/${family}`,
  commit: '0123456789abcdef0123456789abcdef01234567',
  lockfile: `${family}.lock`,
  treeSurface: family === 'deno' ? 'none' : 'node_modules',
  tool: { alias: `pm-${family}`, version: '1.0.0', runtime: 'node-test' },
  ...fields,
})

function fakeDriver(overrides = {}) {
  const calls = {
    obtainFixture: 0,
    sourceOnline: 0,
    sourceOffline: 0,
    replay: 0,
    replayOffline: 0,
    sourceRebuild: 0,
    replayRebuild: 0,
  }
  const driver = {
    calls,
    async obtainFixture() { calls.obtainFixture += 1 },
    async sourceOnline() {
      calls.sourceOnline += 1
      return { durationMs: 1 }
    },
    async sourceOffline() {
      calls.sourceOffline += 1
      return { durationMs: 1, treeDigest: 'sha256:source' }
    },
    async replay() {
      calls.replay += 1
      return { digest: 'sha256:replay' }
    },
    async replayOffline() {
      calls.replayOffline += 1
      return { durationMs: 1, treeDigest: 'sha256:source' }
    },
    supportsRebuild() { return true },
    async sourceRebuild() {
      calls.sourceRebuild += 1
      return {
        durationMs: 1,
        workDigest: 'sha256:rebuild-work',
        treeDigest: 'sha256:rebuilt-tree',
      }
    },
    async replayRebuild() {
      calls.replayRebuild += 1
      return {
        durationMs: 1,
        workDigest: 'sha256:rebuild-work',
        treeDigest: 'sha256:rebuilt-tree',
      }
    },
    ...overrides,
  }
  return driver
}

function error(message, fields = {}) {
  return Object.assign(new Error(message), fields)
}

function resolveRef(root, ref) {
  assert.match(ref, /^#\//)
  return ref.slice(2).split('/').reduce((value, key) => value[key], root)
}

function validate(value, rule, root = schema, at = '$') {
  if (rule.$ref) return validate(value, resolveRef(root, rule.$ref), root, at)
  if (Object.hasOwn(rule, 'const')) assert.deepEqual(value, rule.const, `${at}: const`)
  if (rule.enum) assert.ok(rule.enum.includes(value), `${at}: enum`)

  const types = rule.type == null ? [] : Array.isArray(rule.type) ? rule.type : [rule.type]
  if (types.length > 0) {
    const actual = value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : Number.isInteger(value)
          ? 'integer'
          : typeof value
    assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')), `${at}: type ${actual}`)
  }

  if (typeof value === 'string') {
    if (rule.minLength != null) assert.ok(value.length >= rule.minLength, `${at}: minLength`)
    if (rule.format === 'date-time') assert.ok(Number.isFinite(Date.parse(value)), `${at}: date-time`)
  }
  if (typeof value === 'number' && rule.minimum != null) assert.ok(value >= rule.minimum, `${at}: minimum`)

  if (Array.isArray(value)) {
    if (rule.maxItems != null) assert.ok(value.length <= rule.maxItems, `${at}: maxItems`)
    if (rule.items) value.forEach((item, index) => validate(item, rule.items, root, `${at}[${index}]`))
  } else if (value && typeof value === 'object') {
    for (const required of rule.required ?? []) assert.ok(Object.hasOwn(value, required), `${at}: missing ${required}`)
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) assert.ok(Object.hasOwn(rule.properties ?? {}, key), `${at}: extra ${key}`)
    }
    for (const [key, child] of Object.entries(rule.properties ?? {})) {
      if (Object.hasOwn(value, key)) validate(value[key], child, root, `${at}.${key}`)
    }
  }
}

async function nominalRun(fixtures = [
  fixture('npm-a', 'npm'),
  fixture('npm-b', 'npm'),
  fixture('pnpm-a', 'pnpm'),
  fixture('pnpm-b', 'pnpm'),
  fixture('classic-a', 'yarn-classic'),
  fixture('classic-b', 'yarn-classic'),
  fixture('berry-a', 'yarn-berry', { format: 'yarn-berry-v8' }),
  fixture('berry-b', 'yarn-berry', { format: 'yarn-berry-v8' }),
  fixture('bun-a', 'bun', { repository: 'oven-sh/bun' }),
  fixture('bun-b', 'bun', { repository: 'oven-sh/bun' }),
  fixture('deno-a', 'deno', { format: 'deno-v4' }),
  fixture('deno-b', 'deno', { format: 'deno-v5' }),
]) {
  return runSample({
    fixtures,
    createDriver: () => fakeDriver(),
    runId: 'red-contract',
    createdAt: '2026-08-16T00:00:00.000Z',
    platform: 'darwin',
  })
}

test('the baseline public receipt validates against the checked-in JSON Schema', async () => {
  validate(await nominalRun(), schema)
})

test('the receipt names certified properties and the actual generation/provenance breadth', async () => {
  const receipt = await nominalRun()

  assert.deepEqual(receipt.fixtures.find(item => item.id === 'deno-a').certifies, [
    'acceptance',
    'cache-closure',
  ])
  assert.deepEqual(receipt.fixtures.find(item => item.id === 'deno-a').installedTree, {
    status: 'N/A',
    reason: 'NO_PROJECT_TREE_SURFACE',
  })
  assert.deepEqual(receipt.fixtures.find(item => item.id === 'npm-a').certifies, [
    'acceptance',
    'cache-closure',
    'tree-equivalence',
  ])
  assert.deepEqual(receipt.familySummary['yarn-berry'].breadth, {
    generations: ['yarn-berry-v8'],
    repositories: ['example/yarn-berry'],
  })
  assert.deepEqual(receipt.familySummary.bun.breadth, {
    generations: ['bun-fixture'],
    repositories: ['oven-sh/bun'],
  })
})

test('Deno certifies cache closure without manufacturing an empty installed-tree equality', async () => {
  const receipt = await runFixture(fixture('deno-a', 'deno'), fakeDriver({
    async sourceOffline() { return { durationMs: 1 } },
    async replayOffline() { return { durationMs: 1 } },
  }))

  assert.equal(receipt.classification, 'PASS')
  assert.deepEqual(receipt.source.treeDigests, [])
  assert.equal(receipt.replay.treeDigest, null)
  assert.deepEqual(receipt.evidence.treeDiff, [])
})

test('the schema names fixture archive unreachability as qualification, not product', () => {
  const reason = resolveRef(schema, '#/$defs/qualificationReason')
  assert.ok(reason.enum.includes('FIXTURE_UNREACHABLE'))
})

test('qualification runs the source-offline leg twice before replay', async () => {
  const driver = fakeDriver()
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'PASS')
  assert.equal(driver.calls.sourceOffline, 2)
  assert.equal(receipt.source.offline.length, 2)
  assert.equal(receipt.source.treeDigests.length, 2)
})

test('a supported rebuild leg runs on both source and replay after the tree comparison', async () => {
  const driver = fakeDriver()
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'PASS')
  assert.equal(driver.calls.sourceRebuild, 1)
  assert.equal(driver.calls.replayRebuild, 1)
  assert.equal(receipt.source.rebuildWorkDigest, 'sha256:rebuild-work')
  assert.equal(receipt.replay.rebuildWorkDigest, 'sha256:rebuild-work')
})

test('a rebuild work mismatch is deterministic product evidence', async () => {
  const driver = fakeDriver({
    async replayRebuild() {
      return {
        workDigest: 'sha256:no-work',
        treeDigest: 'sha256:rebuilt-tree',
      }
    },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'PRODUCT_DEFECT')
  assert.notDeepEqual(receipt.evidence.rebuildDiff, [])
})

test('different source-offline inventories refuse a nondeterministic fixture', async () => {
  let pass = 0
  const driver = fakeDriver({
    async sourceOffline() {
      pass += 1
      return { treeDigest: `sha256:source-${pass}` }
    },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'QUALIFICATION_REGRESSION')
  assert.deepEqual(receipt.qualification, {
    status: 'REFUSED',
    reason: 'SOURCE_TREE_NONDETERMINISTIC',
  })
  assert.equal(driver.calls.replay, 0)
})

test('an applicable source leg without a tree digest fails closed as qualification', async () => {
  const receipt = await runFixture(fixture(), fakeDriver({
    async sourceOffline() { return { durationMs: 1 } },
  }))
  assert.equal(receipt.classification, 'QUALIFICATION_REGRESSION')
  assert.equal(receipt.qualification.reason, 'SOURCE_TREE_NONDETERMINISTIC')
  assert.deepEqual(receipt.certifies, [])
})

test('a source-offline cache miss is qualification failure, never product', async () => {
  const driver = fakeDriver({
    async sourceOffline() { throw error('cache miss', { code: 'ENOTCACHED' }) },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'QUALIFICATION_REGRESSION')
  assert.deepEqual(receipt.qualification, { status: 'REFUSED', reason: 'SOURCE_OFFLINE_OPEN' })
})

test('replay ENOTCACHED after qualified source is deterministic product evidence', async () => {
  const driver = fakeDriver({
    async replayOffline() { throw error('cache miss', { code: 'ENOTCACHED' }) },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.qualification.status, 'QUALIFIED')
  assert.equal(receipt.classification, 'PRODUCT_DEFECT')
  assert.deepEqual(receipt.certifies, [])
})

test('a completed semantic installed-tree delta is deterministic product evidence', async () => {
  const driver = fakeDriver({
    async replayOffline() { return { treeDigest: 'sha256:different' } },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'PRODUCT_DEFECT')
  assert.notDeepEqual(receipt.evidence.treeDiff, [])
})

test('an applicable replay leg without a tree digest cannot become a green row', async () => {
  const receipt = await runFixture(fixture(), fakeDriver({
    async replayOffline() { return { durationMs: 1 } },
  }))
  assert.equal(receipt.classification, 'PRODUCT_DEFECT')
  assert.deepEqual(receipt.certifies, [])
})

test('a timeout, null status, or signal is ambiguous and produces no product finding', async () => {
  const driver = fakeDriver({
    async replayOffline() { throw error('killed', { signal: 'SIGKILL', exitCode: null }) },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'AMBIGUOUS_EXECUTION')
})

test('fewer than two qualified fixtures in any declared family is a qualification regression', async () => {
  const receipt = await nominalRun([
    fixture('npm-only', 'npm'),
    fixture('pnpm-only', 'pnpm'),
    fixture('classic-only', 'yarn-classic'),
    fixture('berry-only', 'yarn-berry'),
    fixture('bun-only', 'bun'),
    fixture('deno-only', 'deno'),
  ])
  assert.equal(receipt.classification, 'QUALIFICATION_REGRESSION')
  assert.equal(receipt.familySummary.npm.requested, 2)
  assert.equal(receipt.familySummary.pnpm.requested, 2)
  assert.equal(receipt.familySummary['yarn-classic'].requested, 2)
  assert.equal(receipt.familySummary['yarn-berry'].requested, 2)
  assert.equal(receipt.familySummary.bun.requested, 2)
  assert.equal(receipt.familySummary.deno.requested, 2)
})

test('receipt diagnostics normalize host, cache, and temporary paths', () => {
  const raw = [
    ['', 'Users', 'fixture-user', '.npm', '_cacache'].join('/'),
    ['', 'private', 'tmp', 'oracle'].join('/'),
    ['', 'home', 'runner', 'work', 'project'].join('/'),
    '(node:20837)',
  ].join(' ')
  const normalized = normalizeDiagnostic(raw)
  assert.doesNotMatch(normalized, /fixture-user|\/private\/tmp|\/home\/runner|\.npm\/_cacache|node:20837/)
  assert.match(normalized, /node:<PID>/)
})

test('an unreachable fixture archive is typed qualification evidence, never product', async () => {
  const driver = fakeDriver({
    async obtainFixture() { throw error('archive unavailable', { code: 'ENETUNREACH' }) },
  })
  const receipt = await runFixture(fixture(), driver)
  assert.equal(receipt.classification, 'QUALIFICATION_REGRESSION')
  assert.deepEqual(receipt.qualification, { status: 'REFUSED', reason: 'FIXTURE_UNREACHABLE' })
})

test('yarn-berry pins hardened mode on both legs so a public PR cannot re-resolve them', () => {
  const driver = createNativeDriver({ family: 'yarn-berry' })

  // Berry defaults `enableHardenedMode` to `isPR && <public GitHub repo>` and
  // skips that default only when the setting carries an explicit source. Left
  // unset, a public pull request silently adds `--check-resolutions
  // --refresh-lockfile`, the offline leg is refused by our own
  // `enableNetwork: false`, and the row dies as SOURCE_OFFLINE_OPEN. Neither a
  // developer machine nor a push build reproduces it, so this assertion is the
  // only place the pin is visible outside a public PR.
  for (const offline of [true, false]) {
    const env = driver.commandEnvironment(offline)
    assert.equal(env.YARN_ENABLE_HARDENED_MODE, 'false')
  }
})
