import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

interface Measurement {
  readonly carrierLocks: number
  readonly installedCarriers: number
  readonly installedExact: number
  readonly rootCarriers: number
  readonly rootExact: number
  readonly totalCarriers: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

let cached: Measurement | undefined

function measure(): Measurement {
  if (cached !== undefined) return cached
  let carrierLocks = 0
  let installedCarriers = 0
  let installedExact = 0
  let rootCarriers = 0
  let rootExact = 0
  let totalCarriers = 0

  for (const file of readdirSync(corpusRoot).sort()) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    let source: unknown
    try { source = JSON.parse(input) } catch { continue }
    if (!isRecord(source) || (source.lockfileVersion !== 2 && source.lockfileVersion !== 3)) continue
    if (!isRecord(source.packages)) continue
    const carrierEntries = Object.entries(source.packages)
      .filter(([, entry]) => isRecord(entry) && Object.hasOwn(entry, 'bundleDependencies'))
    if (carrierEntries.length === 0) continue
    const format = detect(input)
    if (format !== `npm-${source.lockfileVersion}`) continue
    let replay: unknown
    try {
      replay = JSON.parse(stringify(parse(input, format), format, { strict: false }))
    } catch {
      continue
    }
    if (!isRecord(replay) || !isRecord(replay.packages)) continue

    let fileCarriers = 0
    for (const [path, entry] of carrierEntries) {
      if (!isRecord(entry)) continue
      fileCarriers += 1
      totalCarriers += 1
      const replayEntry = replay.packages[path]
      const exact = isRecord(replayEntry)
        && JSON.stringify(replayEntry.bundleDependencies) === JSON.stringify(entry.bundleDependencies)
      if (path === '') {
        rootCarriers += 1
        if (exact) rootExact += 1
      } else {
        installedCarriers += 1
        if (exact) installedExact += 1
      }
    }
    if (fileCarriers > 0) carrierLocks += 1
  }

  cached = Object.freeze({
    carrierLocks,
    installedCarriers,
    installedExact,
    rootCarriers,
    rootExact,
    totalCarriers,
  })
  return cached
}

suite(
  corpusAvailable
    ? 'npm installed-package bundle carrier corpus audit'
    : 'npm installed-package bundle carrier corpus audit [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('pins the replayable npm-v2/v3 installed-package carrier population', () => {
      expect(measure()).toMatchObject({
        carrierLocks: 34,
        installedCarriers: 49,
        rootCarriers: 3,
        totalCarriers: 52,
      })
    }, 180_000)

    it('retains every root and installed-package bundle carrier exactly', () => {
      expect({
        installed: measure().installedExact,
        root: measure().rootExact,
      }).toEqual({ installed: 49, root: 3 })
    }, 180_000)
  },
)
