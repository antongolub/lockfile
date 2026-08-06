import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

interface Measurement {
  readonly drops: readonly string[]
  readonly nativeRoots: number
  readonly rootEntries: number
  readonly rows: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const CANONICAL_ROOT_KEYS = new Set([
  'name',
  'version',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
])

let cached: Measurement | undefined

function measure(): Measurement {
  if (cached !== undefined) return cached
  let nativeRoots = 0
  let rootEntries = 0
  const drops: string[] = []
  const population = new Map<string, { present: number; dropped: number }>()

  for (const file of readdirSync(corpusRoot).sort()) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    let source: unknown
    try { source = JSON.parse(input) } catch { continue }
    if (!isRecord(source) || (source.lockfileVersion !== 2 && source.lockfileVersion !== 3)) continue
    const packages = source.packages
    if (!isRecord(packages) || !isRecord(packages[''])) continue
    const root = packages['']
    rootEntries += 1
    for (const key of Object.keys(root)) {
      const rowKey = `v${source.lockfileVersion}:${key}`
      const row = population.get(rowKey) ?? { present: 0, dropped: 0 }
      row.present += 1
      population.set(rowKey, row)
    }
    if (!Object.keys(root).some(key => !CANONICAL_ROOT_KEYS.has(key))) continue
    nativeRoots += 1

    const format = detect(input)
    let output: string | undefined
    if (format !== undefined) {
      try { output = stringify(parse(input, format), format, { strict: false }) } catch { /* measured elsewhere */ }
    }
    // This intentionally uses non-strict replay for a broad population sweep.
    // A green result here is a value-fidelity census, not a strict seal guarantee.
    if (format !== `npm-${source.lockfileVersion}` || output === undefined) continue
    const reparsed = JSON.parse(output) as { packages?: Record<string, Record<string, unknown>> }
    const outputRoot = reparsed.packages?.[''] ?? {}

    for (const key of Object.keys(root)) {
      const rowKey = `v${source.lockfileVersion}:${key}`
      const row = population.get(rowKey)!
      if (JSON.stringify(root[key]) !== JSON.stringify(outputRoot[key])) {
        row.dropped += 1
        drops.push(`${file}:packages[""].${key}`)
      }
    }
  }

  const rows = [...population.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([key, value]) => `${key} ${value.dropped}/${value.present}`)
  process.stdout.write(
    `npm native root prefilter: ${nativeRoots}/${rootEntries}\n`
    + `npm native root keys:\n${rows.join('\n')}\n`,
  )
  cached = Object.freeze({
    drops: Object.freeze(drops),
    nativeRoots,
    rootEntries,
    rows: Object.freeze(rows),
  })
  return cached
}

suite(
  corpusAvailable
    ? 'npm native root-entry corpus audit'
    : 'npm native root-entry corpus audit [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('never drops a source-authored native root-entry key on same-format replay', () => {
      expect(measure().drops).toEqual([])
    }, 180_000)

    it('reports the native-root prefilter frame without pinning corpus size', () => {
      const { nativeRoots, rootEntries } = measure()
      expect(nativeRoots).toBeLessThanOrEqual(rootEntries)
      // The global byte-exact floor is owned by
      // npm-undetected-corpus-audit.test.ts, not this native-root audit.
    }, 180_000)
  },
)
