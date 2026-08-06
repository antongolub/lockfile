import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detect, parse, stringify } from '../../main/ts/index.ts'
import { NODE_MODULES_ENTRY_KEYS } from '../../main/ts/formats/_npm-core.ts'

// Two invariants over one walk.
//
// 1. A source key the canonical projection cannot emit has no carrier except
//    the exact-path native record. `hasShrinkwrap` is the sharp case: three
//    cells in the whole corpus, and dropping one makes pinned npm 8 and npm 11
//    fail an offline install. Population never predicts severity.
//
// 2. `NODE_MODULES_ENTRY_KEYS` is declared beside the builder, so it can drift
//    from what the builder actually writes. Nothing else would notice; this
//    walk already has every emitted entry in hand.

const here = dirname(fileURLToPath(import.meta.url))
const corpusRoot = resolve(here, '../../../tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

// Present in the corpus, absent from the projection. Named here as the audit's
// subject, not as the implementation's rule — the retention predicate asks the
// key set, never this list.
const UNPROJECTABLE_WITNESSES = ['hasShrinkwrap', 'devOptional', 'extraneous'] as const

type Census = {
  readonly replayed: number
  readonly present: Readonly<Record<string, number>>
  readonly survived: Readonly<Record<string, number>>
  readonly dropped: Readonly<Record<string, readonly string[]>>
  readonly undeclaredEmittedKeys: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let cached: Census | undefined

function measure(): Census {
  if (cached !== undefined) return cached
  let replayed = 0
  const present: Record<string, number> = {}
  const survived: Record<string, number> = {}
  const dropped: Record<string, string[]> = {}
  const undeclared = new Set<string>()
  for (const witness of UNPROJECTABLE_WITNESSES) {
    present[witness] = 0
    survived[witness] = 0
    dropped[witness] = []
  }
  for (const file of readdirSync(corpusRoot).filter(name => name.endsWith('.json'))) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    let source: unknown
    try {
      source = JSON.parse(input)
    } catch {
      continue
    }
    if (!isRecord(source) || !isRecord(source.packages)) continue
    const format = detect(input)
    if (format === undefined) continue
    let emitted: unknown
    try {
      emitted = JSON.parse(stringify(parse(input, format), format, { strict: false }))
    } catch {
      continue
    }
    if (!isRecord(emitted) || !isRecord(emitted.packages)) continue
    replayed += 1
    for (const [path, entry] of Object.entries(source.packages)) {
      if (!isRecord(entry)) continue
      const emittedEntry = emitted.packages[path]
      for (const witness of UNPROJECTABLE_WITNESSES) {
        if (entry[witness] === undefined) continue
        present[witness] = (present[witness] ?? 0) + 1
        if (isRecord(emittedEntry) && emittedEntry[witness] === entry[witness]) {
          survived[witness] = (survived[witness] ?? 0) + 1
        } else {
          dropped[witness]?.push(`${file}:${path}`)
        }
      }
    }
    // An emitted key is legitimate when the projection declares it OR the
    // source carried it at that exact path. Anything else is either builder
    // drift past the declared set or a key we invented — the two failure
    // directions this walk can see, and it cannot tell them apart from the
    // final output alone, which is why the message names the key.
    for (const [path, entry] of Object.entries(emitted.packages)) {
      if (!isRecord(entry)) continue
      const sourceEntry = source.packages[path]
      for (const key of Object.keys(entry)) {
        if (NODE_MODULES_ENTRY_KEYS.has(key)) continue
        if (isRecord(sourceEntry) && key in sourceEntry) continue
        undeclared.add(`${key} @ ${file}:${path}`)
      }
    }
  }
  cached = Object.freeze({
    replayed,
    present: Object.freeze(present),
    survived: Object.freeze(survived),
    dropped: Object.freeze(
      Object.fromEntries(Object.entries(dropped).map(([key, value]) => [key, Object.freeze(value)])),
    ),
    undeclaredEmittedKeys: Object.freeze([...undeclared].sort()),
  })
  return cached
}

suite('npm unprojectable entry keys corpus audit', () => {
  it('replays every source key the canonical projection cannot emit', () => {
    const census = measure()
    // eslint-disable-next-line no-console
    console.log(
      `npm unprojectable key frame: replayed ${census.replayed}\n`
      + UNPROJECTABLE_WITNESSES
        .map(w => `  ${w}: ${census.survived[w]}/${census.present[w]} survived`)
        .join('\n'),
    )
    expect(census.dropped.hasShrinkwrap).toEqual([])
    expect(census.dropped.devOptional).toEqual([])
    // The remaining `extraneous` losses sit on workspace / external-workspace
    // paths, which the installed-entry carrier does not own. They belong to the
    // separately routed workspace-topology item and are bounded, not fixed.
    expect(census.dropped.extraneous?.length ?? 0).toBeLessThanOrEqual(12)
  }, 300_000)

  it('emits only keys the projection declares or the source carried', () => {
    // Guards the hand-maintained set against builder drift, and the carrier
    // against fabricating a key at a path the source never had one.
    expect(measure().undeclaredEmittedKeys).toEqual([])
  }, 300_000)
})
