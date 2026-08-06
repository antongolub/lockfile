import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detect, parse, stringify } from '../../main/ts/index.ts'

// A source-authored QUOTED decimal is a string that merely looks numeric —
// a dependency range like `babel-loader: '8'`. Emitting it bare turns it into a
// YAML number, and pnpm's manifest comparison then refuses the lock as out of
// date. The inverse rule matters just as much: a genuine bare number must not
// come back quoted, or we trade one type defect for its mirror.

const here = dirname(fileURLToPath(import.meta.url))
const corpusRoot = resolve(here, '../../../tmp/pnpm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

const QUOTED_NUMERIC = /^(\s*)([^:\n]+): '(-?\d+(?:\.\d+)?)'$/
const BARE_NUMERIC = /^(\s*)([^:\n]+): (-?\d+(?:\.\d+)?)$/

type Census = {
  readonly replayed: number
  readonly quoted: number
  readonly quotedLost: readonly string[]
  readonly bare: number
  readonly bareLost: readonly string[]
}

let cached: Census | undefined

function measure(): Census {
  if (cached !== undefined) return cached
  let replayed = 0
  let quoted = 0
  let bare = 0
  const quotedLost: string[] = []
  const bareLost: string[] = []
  for (const file of readdirSync(corpusRoot).filter(name => name.endsWith('.yaml'))) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    const format = detect(input)
    if (format === undefined) continue
    let output: string
    try {
      output = stringify(parse(input, format), format, { strict: false })
    } catch {
      continue
    }
    replayed += 1
    const emitted = new Set(output.split('\n').map(line => line.trim()))
    for (const line of input.split('\n')) {
      const trimmed = line.trim()
      if (QUOTED_NUMERIC.test(line)) {
        quoted += 1
        if (!emitted.has(trimmed)) quotedLost.push(`${file}: ${trimmed}`)
        continue
      }
      if (BARE_NUMERIC.test(line)) {
        bare += 1
        if (!emitted.has(trimmed)) bareLost.push(`${file}: ${trimmed}`)
      }
    }
  }
  cached = Object.freeze({
    replayed,
    quoted,
    bare,
    quotedLost: Object.freeze(quotedLost),
    bareLost: Object.freeze(bareLost),
  })
  return cached
}

suite('pnpm numeric scalar corpus audit', () => {
  it('preserves the type of every source-authored numeric-looking scalar', () => {
    const census = measure()
    // eslint-disable-next-line no-console
    console.log(
      `pnpm numeric scalar frame: replayed ${census.replayed}`
      + ` | quoted ${census.quoted} (lost ${census.quotedLost.length})`
      + ` | bare ${census.bare} (lost ${census.bareLost.length})`,
    )
    expect(census.quotedLost).toEqual([])
    expect(census.bareLost).toEqual([])
  }, 180_000)
})
