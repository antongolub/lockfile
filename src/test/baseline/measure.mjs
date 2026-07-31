#!/usr/bin/env node

// Fingerprints the whole observable surface of a build, so "did this refactor change
// anything?" becomes one number you can diff between two commits.
//
// For each of eight real locks (npm / pnpm / berry / lockgraph, small and large) it runs
// parse, stringify, a same-format round trip, a cross-format conversion, a graph mutation
// and an enrichment, and records a sha256 of each result — plus per-module emitted bytes,
// the `npm pack` byte count, and TypeScript's instantiation count. Everything folds into a
// single `reportDigest`, which moves if and only if some observable output moved; the
// per-fixture digests then say which operation moved it.
//
// That is the value, and it is not what the test suite gives you. Tests assert the
// expectations someone thought to write down. This asserts nothing and notices everything:
// a conversion that starts emitting one different byte, a graph identity silently no longer
// preserved, a tree-shaking regression, a type-level explosion. Run it before a refactor,
// run it after, diff the two reports.
//
//   npm run measure           full report, including timings
//   npm run measure:verify    deterministic fields only, run twice and compared —
//                             use it to prove an output does not vary between runs
//
// What it is NOT: a gate. Nothing here fails a build. `RATIFIED_BASELINE` below is copied
// into the report for reference and is compared against nothing, so it drifts silently —
// as of 2026-07-31 its two size numbers are 23% and 27% away from what the build actually
// produces. CI does not run this script at all. It pays off only when a human runs it on
// both sides of a change and reads the difference.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

import { convert, enrich, parse, stringify } from '../../../dist/index.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const DIST = join(ROOT, 'dist')
const PINNED_GENERATED_AT = '2000-01-01T00:00:00Z'

const RATIFIED_BASELINE = Object.freeze({
  sizeLimit: Object.freeze({ all: '996.96 kB', types: '122.05 kB' }),
  typeScriptInstantiations: 55_082,
  rootFacade: Object.freeze({ sourceLines: 2_026, emittedBytes: 59_419 }),
})

const FIXTURES = Object.freeze([
  Object.freeze({
    id: 'npm-small',
    family: 'npm',
    scale: 'small',
    format: 'npm-3',
    targetFormat: 'pnpm-v9',
    path: 'src/test/resources/fixtures/lockfiles/simple/npm-3.lock',
  }),
  Object.freeze({
    id: 'npm-large',
    family: 'npm',
    scale: 'large',
    format: 'npm-3',
    targetFormat: 'pnpm-v9',
    path: 'src/test/resources/fixtures/real-world/socketio-socket.io-main-190572d/package-lock.json',
  }),
  Object.freeze({
    id: 'pnpm-small',
    family: 'pnpm',
    scale: 'small',
    format: 'pnpm-v9',
    targetFormat: 'npm-3',
    path: 'src/test/resources/fixtures/lockfiles/simple/pnpm-v9.lock',
  }),
  Object.freeze({
    id: 'pnpm-large',
    family: 'pnpm',
    scale: 'large',
    format: 'pnpm-v9',
    targetFormat: 'npm-3',
    path: 'src/test/resources/fixtures/real-world/angular-angular-main-45e8fb5/pnpm-lock.yaml',
  }),
  Object.freeze({
    id: 'berry-small',
    family: 'yarn-berry',
    scale: 'small',
    format: 'yarn-berry-v9',
    targetFormat: 'npm-3',
    path: 'src/test/resources/fixtures/lockfiles/simple/yarn-berry-v9.lock',
  }),
  Object.freeze({
    id: 'berry-large',
    family: 'yarn-berry',
    scale: 'large',
    format: 'yarn-berry-v8',
    targetFormat: 'npm-3',
    path: 'src/test/resources/fixtures/real-world/parcel-bundler-parcel-v2-5948485/yarn.lock',
  }),
  Object.freeze({
    id: 'lockgraph-small',
    family: 'lockgraph',
    scale: 'small',
    format: 'lockgraph',
    targetFormat: 'npm-3',
    path: 'src/test/resources/fixtures/lockgraph/lodash-yarn-classic.lockgraph',
  }),
  Object.freeze({
    id: 'lockgraph-large',
    family: 'lockgraph',
    scale: 'large',
    format: 'lockgraph',
    targetFormat: 'npm-3',
    path: 'src/test/resources/fixtures/lockgraph/prettier-yarn-berry-v10.lockgraph',
  }),
])

const compareStrings = (left, right) => left < right ? -1 : left > right ? 1 : 0

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : canonicalize(item))
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, item]) => [canonicalize(key), canonicalize(item)])
      .sort(([left], [right]) => compareStrings(JSON.stringify(left), JSON.stringify(right)))
  }
  if (value instanceof Set) {
    return [...value].map(canonicalize).sort((left, right) =>
      compareStrings(JSON.stringify(left), JSON.stringify(right)))
  }
  if (value !== null && typeof value === 'object') {
    const output = {}
    for (const key of Object.keys(value).sort(compareStrings)) {
      if (value[key] !== undefined) output[key] = canonicalize(value[key])
    }
    return output
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  return value
}

const stableJson = value => JSON.stringify(canonicalize(value))
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const bytesOf = value => Buffer.byteLength(value)

function normalizeNonIdentityMeta(value) {
  return value
    .replace(/^generatedAt .+$/m, `generatedAt ${PINNED_GENERATED_AT}`)
    .replace(/^generator .+$/m, 'generator <normalized>')
}

function graphText(graph) {
  return normalizeNonIdentityMeta(stringify('lockgraph', graph, { strict: false }))
}

function graphSummary(graph) {
  const nodes = [...graph.nodes()]
  let edges = 0
  for (const node of nodes) edges += graph.out(node.id).length
  return {
    digest: sha256(graphText(graph)),
    nodes: nodes.length,
    edges,
    tarballs: [...graph.tarballs()].length,
    diagnostics: graph.diagnostics().length,
  }
}

function replaceFirstNode(graph) {
  const nodes = [...graph.nodes()].sort((left, right) => compareStrings(left.id, right.id))
  if (nodes.length === 0) return graph.mutate(() => {})
  const first = nodes[0]
  return graph.mutate(mutator => mutator.replaceNode(first.id, first))
}

async function readFixtureInputs() {
  const output = []
  for (const fixture of FIXTURES) {
    output.push({ ...fixture, input: await readFile(join(ROOT, fixture.path), 'utf8') })
  }
  return output
}

function roundTrip(fixture) {
  const first = stringify(fixture.format, parse(fixture.format, fixture.input), { strict: false })
  const reparsed = parse(fixture.format, first)
  const output = normalizeNonIdentityMeta(stringify(fixture.format, reparsed, { strict: false }))
  return { output, graph: reparsed }
}

async function fixtureResult(fixture) {
  const graph = parse(fixture.format, fixture.input)
  const parseResult = graphSummary(graph)

  const sameFormatOutput = normalizeNonIdentityMeta(stringify(fixture.format, graph, { strict: false }))
  const stringifyResult = {
    digest: sha256(sameFormatOutput),
    bytes: bytesOf(sameFormatOutput),
  }

  const roundTripped = roundTrip(fixture)
  const roundTripResult = {
    digest: sha256(roundTripped.output),
    bytes: bytesOf(roundTripped.output),
    graphDigest: graphSummary(roundTripped.graph).digest,
  }

  // `convertAssessed` left the shipped surface in 0.6; the public `convert` reports
  // through `onDiagnostic` instead. Both the emitted bytes and what gets reported are
  // fingerprinted — a build that silently changes its diagnostics has changed too.
  const conversionDiagnostics = []
  let convertedOutput
  try {
    convertedOutput = normalizeNonIdentityMeta(await convert(fixture.input, {
      sourceFormat: fixture.format,
      target: fixture.targetFormat,
      contract: 'snapshot',
      store: false,
      onDiagnostic: (diagnostic) => conversionDiagnostics.push(diagnostic),
    }))
  } catch (error) {
    conversionDiagnostics.push({ thrown: error?.code ?? String(error) })
  }
  const conversionPayload = { diagnostics: conversionDiagnostics, output: convertedOutput }
  const conversionResult = {
    digest: sha256(stableJson(conversionPayload)),
    diagnosticsDigest: sha256(stableJson(conversionDiagnostics)),
    diagnostics: conversionDiagnostics.length,
    outputDigest: convertedOutput === undefined ? null : sha256(convertedOutput),
    outputBytes: convertedOutput === undefined ? 0 : bytesOf(convertedOutput),
  }

  const mutated = replaceFirstNode(graph)
  const mutationPayload = {
    graph: graphSummary(mutated.graph),
    applied: mutated.applied,
    unresolved: mutated.unresolved,
  }
  const mutationResult = {
    digest: sha256(stableJson(mutationPayload)),
    graphDigest: mutationPayload.graph.digest,
    applied: mutated.applied.length,
    unresolved: mutated.unresolved.length,
  }

  const enriched = await enrich(graph, {}, {
    target: { format: fixture.targetFormat },
    contract: 'snapshot',
  })
  const enrichmentPayload = {
    graph: graphSummary(enriched.graph),
    diagnostics: enriched.diagnostics,
  }
  const enrichmentResult = {
    digest: sha256(stableJson(enrichmentPayload)),
    graphDigest: enrichmentPayload.graph.digest,
    diagnosticsDigest: sha256(stableJson(enriched.diagnostics)),
    diagnostics: enriched.diagnostics.length,
    preservedIdentity: enriched.graph === graph,
  }

  const results = {
    parse: parseResult,
    stringify: stringifyResult,
    sameFormatRoundTrip: roundTripResult,
    crossFormatAssessment: conversionResult,
    graphMutation: mutationResult,
    enrichment: enrichmentResult,
  }
  return {
    id: fixture.id,
    family: fixture.family,
    scale: fixture.scale,
    format: fixture.format,
    targetFormat: fixture.targetFormat,
    path: fixture.path,
    bytes: bytesOf(fixture.input),
    fixtureDigest: sha256(fixture.input),
    resultDigest: sha256(stableJson(results)),
    results,
  }
}

async function collectFixtureResults(fixtures) {
  const output = []
  for (const fixture of fixtures) output.push(await fixtureResult(fixture))
  return output
}

function importedSpecifiers(source) {
  const output = new Set()
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) output.add(match[1])
  }
  return [...output].sort(compareStrings)
}

async function existingFile(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next emitted-file spelling.
    }
  }
  return undefined
}

async function resolveEmittedImport(from, specifier, kind) {
  if (!specifier.startsWith('.')) return undefined
  let candidate = resolve(dirname(from), specifier)
  if (kind === 'dts' && candidate.endsWith('.js')) candidate = `${candidate.slice(0, -3)}.d.ts`
  const extension = kind === 'js' ? '.js' : '.d.ts'
  const candidates = extname(candidate) === ''
    ? [candidate + extension, join(candidate, `index${extension}`)]
    : [candidate]
  const found = await existingFile(candidates)
  if (found === undefined) return undefined
  const local = relative(DIST, found)
  if (local === '..' || local.startsWith(`..${sep}`)) return undefined
  return found
}

async function reachableFiles(entry, kind) {
  const pending = [entry]
  const visited = new Set()
  while (pending.length > 0) {
    const current = pending.shift()
    if (visited.has(current)) continue
    visited.add(current)
    const source = await readFile(current, 'utf8')
    for (const specifier of importedSpecifiers(source)) {
      const dependency = await resolveEmittedImport(current, specifier, kind)
      if (dependency !== undefined && !visited.has(dependency)) pending.push(dependency)
    }
    pending.sort(compareStrings)
  }
  return [...visited].sort(compareStrings)
}

async function fileBytes(files) {
  let bytes = 0
  for (const file of files) bytes += (await stat(file)).size
  return bytes
}

// Read out of package.json rather than restated here, because a restated copy drifts:
// this list still expected a `registry/index` emit after that subpath became an alias of
// the root, and still enumerated `./formats/*` subpaths that stopped being public — so
// the script had not run since. What ships is what gets attributed.
async function publicEntries() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  return Object.entries(manifest.exports)
    .map(([subpath, target]) => [subpath, target.default.replace(/^\.\/dist\//, '').replace(/\.js$/, '')])
    .sort(([left], [right]) => compareStrings(left, right))
}

async function emittedAttribution() {
  const subpaths = []
  for (const [subpath, emitted] of await publicEntries()) {
    const js = await reachableFiles(join(DIST, `${emitted}.js`), 'js')
    const dts = await reachableFiles(join(DIST, `${emitted}.d.ts`), 'dts')
    subpaths.push({
      subpath,
      jsBytes: await fileBytes(js),
      jsFiles: js.length,
      declarationBytes: await fileBytes(dts),
      declarationFiles: dts.length,
    })
  }

  const emittedFiles = []
  const pending = [DIST]
  while (pending.length > 0) {
    const directory = pending.shift()
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => compareStrings(left.name, right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) emittedFiles.push(path)
    }
    pending.sort(compareStrings)
  }

  const jsFiles = emittedFiles.filter(file => file.endsWith('.js'))
  const declarationFiles = emittedFiles.filter(file => file.endsWith('.d.ts'))
  const sourceFacade = await readFile(join(ROOT, 'src/main/ts/index.ts'), 'utf8')
  return {
    method: 'transitive static relative-import closure; shared files count independently per subpath',
    totals: {
      jsBytes: await fileBytes(jsFiles),
      jsFiles: jsFiles.length,
      declarationBytes: await fileBytes(declarationFiles),
      declarationFiles: declarationFiles.length,
    },
    rootFacade: {
      sourceLines: (sourceFacade.match(/\n/g) ?? []).length,
      emittedBytes: (await stat(join(DIST, 'index.js'))).size,
    },
    publicSubpaths: subpaths,
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${command} exited with ${result.status}${detail === '' ? '' : `: ${detail}`}`)
  }
  return result.stdout
}

function packageDryRun() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const stdout = run(npm, ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], {
    env: {
      ...process.env,
      npm_config_cache: join(tmpdir(), 'lockgraph-measure-npm-cache'),
      npm_config_update_notifier: 'false',
    },
  })
  const parsed = JSON.parse(stdout)
  const result = Array.isArray(parsed) ? parsed[0] : parsed
  return {
    packedBytes: result.size,
    unpackedBytes: result.unpackedSize,
    entries: result.entryCount ?? result.files?.length ?? 0,
  }
}

function extendedDiagnostics(includeVolatile) {
  const stdout = run(process.execPath, [
    join(ROOT, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--extendedDiagnostics',
  ])
  const stable = {}
  const volatile = {}
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.+)$/.exec(line.trim())
    if (match === null) continue
    const [, key, raw] = match
    if (/^[\d,]+$/.test(raw)) stable[key] = Number(raw.replace(/,/g, ''))
    else volatile[key] = raw
  }
  return includeVolatile ? { stable, volatile } : { stable }
}

function numericOption(name, fallback) {
  const prefix = `--${name}=`
  const raw = process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length)
    ?? process.env[`LOCKGRAPH_MEASURE_${name.toUpperCase()}`]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${prefix}<positive integer> required`)
  return parsed
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function quantile(sorted, value) {
  return sorted[Math.round((sorted.length - 1) * value)]
}

const rounded = value => Math.round(value * 1_000) / 1_000
let blackhole

async function measureOperation(operation, warmups, samples) {
  for (let index = 0; index < warmups; index += 1) blackhole = await operation()
  const timings = []
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now()
    blackhole = await operation()
    timings.push(performance.now() - started)
  }
  const sorted = timings.slice().sort((left, right) => left - right)
  const center = median(sorted)
  const deviations = timings.map(value => Math.abs(value - center)).sort((left, right) => left - right)
  return {
    medianMs: rounded(center),
    madMs: rounded(median(deviations)),
    iqrMs: rounded(quantile(sorted, 0.75) - quantile(sorted, 0.25)),
    minMs: rounded(sorted[0]),
    maxMs: rounded(sorted[sorted.length - 1]),
  }
}

async function volatileTimings(fixtures, warmups, samples) {
  const results = []
  for (const fixture of fixtures) {
    const graph = parse(fixture.format, fixture.input)
    const operations = {
      parse: () => parse(fixture.format, fixture.input),
      stringify: () => stringify(fixture.format, graph, { strict: false }),
      sameFormatRoundTrip: () => roundTrip(fixture),
      crossFormatConversion: () => convert(fixture.input, {
        sourceFormat: fixture.format,
        target: fixture.targetFormat,
        contract: 'snapshot',
        store: false,
      }).catch(() => undefined),
      graphMutation: () => replaceFirstNode(graph),
      enrichment: () => enrich(graph, {}, {
        target: { format: fixture.targetFormat },
        contract: 'snapshot',
      }),
    }
    const measured = {}
    for (const [name, operation] of Object.entries(operations)) {
      measured[name] = await measureOperation(operation, warmups, samples)
    }
    results.push({ id: fixture.id, operations: measured })
  }
  return {
    warning: 'Volatile observations for same-machine A/B comparisons only; never a CI pass/fail gate.',
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    warmups,
    samples,
    dispersion: 'median absolute deviation (MAD) and interquartile range (IQR)',
    fixtures: results,
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const deterministicOnly = args.has('--deterministic-only') || args.has('--verify-determinism')
  const verifyDeterminism = args.has('--verify-determinism')
  const warmups = numericOption('warmups', 2)
  const samples = numericOption('samples', 7)

  const inputs = await readFixtureInputs()
  const fixtures = await collectFixtureResults(inputs)
  let verification
  if (verifyDeterminism) {
    const repeated = await collectFixtureResults(inputs)
    if (stableJson(repeated) !== stableJson(fixtures)) {
      throw new Error('fixture/result digest verification failed: repeated runs differ')
    }
    verification = { repeatedFixtureAndResultDigests: true }
  }

  const artifacts = await emittedAttribution()
  const packageBytes = packageDryRun()
  const typeScript = extendedDiagnostics(!deterministicOnly)
  const deterministicPayload = {
    schema: 'lockgraph-measurement/v1',
    ratifiedBaseline: RATIFIED_BASELINE,
    fixtures,
    emittedArtifacts: artifacts,
    packageDryRun: packageBytes,
    typeScriptExtendedDiagnostics: typeScript.stable,
  }
  const deterministic = {
    ...deterministicPayload,
    reportDigest: sha256(stableJson(deterministicPayload)),
    ...(verification === undefined ? {} : { verification }),
  }

  const report = deterministicOnly
    ? deterministic
    : {
        ...deterministic,
        volatileExtendedDiagnostics: typeScript.volatile,
        volatileTimings: await volatileTimings(inputs, warmups, samples),
      }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

await main()
