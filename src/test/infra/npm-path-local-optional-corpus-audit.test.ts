import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

interface Measurement {
  readonly additions: number
  readonly flatLocks: number
  readonly nonReplayableSource: number
  readonly replayed: number
  readonly replayableSource: number
  readonly sourceFalse: number
  readonly sourceTrue: number
  readonly survived: number
  readonly versionAdditions: Readonly<Record<'npm-2' | 'npm-3', number>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

let cached: Measurement | undefined

function measure(): Measurement {
  if (cached !== undefined) return cached
  let additions = 0
  let flatLocks = 0
  let nonReplayableSource = 0
  let replayed = 0
  let replayableSource = 0
  let sourceFalse = 0
  let sourceTrue = 0
  let survived = 0
  const versionAdditions = { 'npm-2': 0, 'npm-3': 0 }

  for (const file of readdirSync(corpusRoot).sort()) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    let source: unknown
    try { source = JSON.parse(input) } catch { continue }
    if (!isRecord(source) || (source.lockfileVersion !== 2 && source.lockfileVersion !== 3)) continue
    if (!isRecord(source.packages)) continue
    flatLocks += 1
    const sourcePackages = source.packages as Record<string, unknown>
    let fileSourceTrue = 0
    for (const entry of Object.values(sourcePackages)) {
      if (!isRecord(entry)) continue
      if (entry.optional === true) fileSourceTrue += 1
      if (entry.optional === false) sourceFalse += 1
    }
    sourceTrue += fileSourceTrue

    const npmFormat = source.lockfileVersion === 2 ? 'npm-2' : 'npm-3'
    const format = detect(input)
    if (format !== npmFormat) {
      nonReplayableSource += fileSourceTrue
      continue
    }
    let replay: unknown
    try {
      replay = JSON.parse(stringify(parse(input, format), format, { strict: false }))
    } catch {
      nonReplayableSource += fileSourceTrue
      continue
    }
    if (!isRecord(replay) || !isRecord(replay.packages)) {
      nonReplayableSource += fileSourceTrue
      continue
    }
    replayed += 1
    replayableSource += fileSourceTrue
    const replayPackages = replay.packages as Record<string, unknown>
    for (const [path, entry] of Object.entries(sourcePackages)) {
      if (!isRecord(entry) || entry.optional !== true) continue
      const replayEntry = replayPackages[path]
      if (isRecord(replayEntry) && replayEntry.optional === true) survived += 1
    }
    for (const [path, entry] of Object.entries(replayPackages)) {
      if (!isRecord(entry) || entry.optional !== true) continue
      const sourceEntry = sourcePackages[path]
      if (!isRecord(sourceEntry) || sourceEntry.optional !== true) {
        additions += 1
        versionAdditions[npmFormat] += 1
      }
    }
  }

  cached = Object.freeze({
    additions,
    flatLocks,
    nonReplayableSource,
    replayed,
    replayableSource,
    sourceFalse,
    sourceTrue,
    survived,
    versionAdditions: Object.freeze(versionAdditions),
  })
  return cached
}

suite(
  corpusAvailable
    ? 'npm path-local optional corpus audit'
    : 'npm path-local optional corpus audit [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('pins the measured npm-v2/v3 population and source carrier', () => {
      expect(measure()).toMatchObject({
        flatLocks: 806,
        nonReplayableSource: 194,
        replayed: 793,
        replayableSource: 18_392,
        sourceFalse: 0,
        sourceTrue: 18_586,
      })
    }, 180_000)

    it('retains every replayable source-authored optional cell', () => {
      expect(measure().survived).toBe(18_392)
    }, 180_000)

    it('never adds optional at a source-absent install path', () => {
      expect({
        additions: measure().additions,
        byFormat: measure().versionAdditions,
      }).toEqual({
        additions: 0,
        byFormat: { 'npm-2': 0, 'npm-3': 0 },
      })
    }, 180_000)
  },
)
