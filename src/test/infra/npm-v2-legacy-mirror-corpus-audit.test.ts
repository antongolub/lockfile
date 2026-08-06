import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

interface LegacyEntry extends Record<string, unknown> {
  bundled?: boolean
  dependencies?: Record<string, LegacyEntry>
}

interface LegacyCell {
  readonly depth: number
  readonly entry: LegacyEntry
  readonly installPath: string
  readonly parentPath: string
  readonly slot: string
}

interface Measurement {
  readonly candidates: number
  readonly missingBelowScopedParent: number
  readonly missingBundledBelowScopedParent: number
  readonly missingBundledScopedDirect: number
  readonly missingOther: number
  readonly missingScopedDirect: number
  readonly missingWithoutFlatEntry: number
  readonly replayed: number
  readonly selected: number
  readonly sourceBundled: number
  readonly replayableBundled: number
  readonly sourceNested: number
  readonly survivedBundled: number
  readonly nonReplayable: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function legacyCells(
  entries: Record<string, unknown>,
  parentPath = '',
  depth = 0,
): LegacyCell[] {
  const cells: LegacyCell[] = []
  for (const [slot, rawEntry] of Object.entries(entries)) {
    if (!isRecord(rawEntry)) continue
    const entry = rawEntry as LegacyEntry
    const installPath = parentPath === ''
      ? `node_modules/${slot}`
      : `${parentPath}/node_modules/${slot}`
    cells.push({ depth, entry, installPath, parentPath, slot })
    if (isRecord(entry.dependencies)) {
      cells.push(...legacyCells(entry.dependencies, installPath, depth + 1))
    }
  }
  return cells
}

let cached: Measurement | undefined

function measure(): Measurement {
  if (cached !== undefined) return cached
  let candidates = 0
  let missingBelowScopedParent = 0
  let missingBundledBelowScopedParent = 0
  let missingBundledScopedDirect = 0
  let missingOther = 0
  let missingScopedDirect = 0
  let missingWithoutFlatEntry = 0
  let replayed = 0
  let selected = 0
  let sourceBundled = 0
  let replayableBundled = 0
  let sourceNested = 0
  let survivedBundled = 0
  let nonReplayable = 0

  for (const file of readdirSync(corpusRoot).sort()) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    let source: unknown
    try { source = JSON.parse(input) } catch { continue }
    if (!isRecord(source) || source.lockfileVersion !== 2) continue
    if (!isRecord(source.packages) || !isRecord(source.dependencies)) continue
    candidates += 1
    const sourceCells = legacyCells(source.dependencies)
    const carrierPaths = Object.entries(source.packages)
      .filter(([path, entry]) =>
        path !== ''
        && isRecord(entry)
        && Array.isArray(entry.bundleDependencies)
        && entry.bundleDependencies.length > 0)
      .map(([path]) => path)
    if (carrierPaths.length === 0) continue
    selected += 1
    const carrierDirect = sourceCells.filter(cell => carrierPaths.includes(cell.parentPath))
    const scopedDirectPaths = carrierDirect
      .filter(cell => cell.slot.startsWith('@'))
      .map(cell => cell.installPath)
    const belowScopedDirect = sourceCells.filter(cell =>
      scopedDirectPaths.includes(cell.parentPath))
    sourceNested += carrierDirect.length
    sourceBundled += carrierDirect.filter(cell => cell.entry.bundled === true).length

    const format = detect(input)
    if (format !== 'npm-2') {
      nonReplayable += 1
      continue
    }
    let output: unknown
    try {
      output = JSON.parse(stringify(parse(input, format), format, { strict: false }))
    } catch (error) {
      void error
      nonReplayable += 1
      continue
    }
    if (!isRecord(output) || !isRecord(output.dependencies)) {
      nonReplayable += 1
      continue
    }
    replayed += 1
    const outputByPath = new Map(
      legacyCells(output.dependencies).map(cell => [cell.installPath, cell.entry]),
    )
    for (const cell of [...carrierDirect, ...belowScopedDirect]) {
      const emitted = outputByPath.get(cell.installPath)
      if (cell.entry.bundled === true && carrierDirect.includes(cell)) {
        replayableBundled += 1
        if (emitted?.bundled === true) survivedBundled += 1
      }
      if (emitted !== undefined) continue
      if (!isRecord(source.packages[cell.installPath])) missingWithoutFlatEntry += 1
      if (cell.slot.startsWith('@')) {
        missingScopedDirect += 1
        if (cell.entry.bundled === true) missingBundledScopedDirect += 1
      } else if (cell.installPath.includes('/node_modules/@')) {
        missingBelowScopedParent += 1
        if (cell.entry.bundled === true) missingBundledBelowScopedParent += 1
      } else {
        missingOther += 1
      }
    }
  }

  cached = Object.freeze({
    candidates,
    missingBelowScopedParent,
    missingBundledBelowScopedParent,
    missingBundledScopedDirect,
    missingOther,
    missingScopedDirect,
    missingWithoutFlatEntry,
    replayed,
    selected,
    sourceBundled,
    replayableBundled,
    sourceNested,
    survivedBundled,
    nonReplayable,
  })
  return cached
}

suite(
  corpusAvailable
    ? 'npm-v2 legacy mirror scoped-tree and bundled-marker corpus audit'
    : 'npm-v2 legacy mirror scoped-tree and bundled-marker corpus audit [skipped: corpus absent]',
  () => {
    it('reports the affected source carrier without pinning the movable corpus frame', () => {
      const frame = measure()
      console.info('npm-v2 legacy mirror prefilter', {
        candidates: frame.candidates,
        directChildren: frame.sourceNested,
        directBundled: frame.sourceBundled,
        nonReplayable: frame.nonReplayable,
        replayableBundled: frame.replayableBundled,
        replayed: frame.replayed,
        selected: frame.selected,
      })
      expect(frame.replayed + frame.nonReplayable).toBe(frame.selected)
      expect(frame.sourceNested).toBeGreaterThan(0)
      expect(frame.sourceBundled).toBeGreaterThan(0)
      expect(frame.replayableBundled).toBeGreaterThan(0)
    }, 180_000)

    it('retains every scoped direct child and every child below a scoped parent', () => {
      expect({
        belowScopedParent: measure().missingBelowScopedParent,
        bundledBelowScopedParent: measure().missingBundledBelowScopedParent,
        bundledScopedDirect: measure().missingBundledScopedDirect,
        other: measure().missingOther,
        scopedDirect: measure().missingScopedDirect,
        withoutFlatEntry: measure().missingWithoutFlatEntry,
      }).toEqual({
        belowScopedParent: 0,
        bundledBelowScopedParent: 0,
        bundledScopedDirect: 0,
        other: 0,
        scopedDirect: 0,
        withoutFlatEntry: 0,
      })
    }, 180_000)

    it('retains every source-authored legacy `bundled: true` marker', () => {
      expect(measure().survivedBundled).toBe(measure().replayableBundled)
    }, 180_000)
  },
)
