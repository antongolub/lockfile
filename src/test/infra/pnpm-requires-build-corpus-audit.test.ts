import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/api/format-api.ts'
import { corpusBudget } from './_corpus-budget.ts'

const here = dirname(fileURLToPath(import.meta.url))
const corpusRoot = resolve(here, '../../../tmp/pnpm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

type Format = 'pnpm-v5' | 'pnpm-v6' | 'pnpm-v9'

function formatOf(source: string): Format {
  const version = source.match(/^lockfileVersion:\s*[^0-9]*([0-9.]+)/mu)?.[1]
  if (version === '5.4') return 'pnpm-v5'
  if (version === '6.0') return 'pnpm-v6'
  return 'pnpm-v9'
}

function cells(source: string, file: string): Set<string> {
  const found = new Set<string>()
  let section: string | undefined
  let entry: string | undefined
  for (const raw of source.split('\n')) {
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (indent === 0) {
      section = line.endsWith(':') ? line.slice(0, -1) : undefined
      entry = undefined
    } else if (section === 'packages' && indent === 2 && line.endsWith(':')) {
      entry = line.slice(0, -1)
    } else if (section === 'packages' && entry !== undefined && indent === 4 && line === 'requiresBuild: true') {
      found.add(`${file}\0${entry}`)
    }
  }
  return found
}

suite('pnpm requiresBuild corpus audit', () => {
  it('preserves all v5.4/v6 cells and proves the v9 carrier population is zero', () => {
    const files = readdirSync(corpusRoot).filter(file => file.endsWith('.pnpm-lock.yaml')).sort()
    let replayed = 0
    let sourceCells = 0
    let survived = 0
    let added = 0
    let v9SourceCells = 0
    let v9ReplayCells = 0

    for (const file of files) {
      const source = readFileSync(resolve(corpusRoot, file), 'utf8')
      const format = formatOf(source)
      const sourceSet = cells(source, file)
      const output = stringify(parse(source, format), format, { strict: false })
      const replaySet = cells(output, file)
      replayed += 1
      sourceCells += sourceSet.size
      survived += [...sourceSet].filter(cell => replaySet.has(cell)).length
      added += [...replaySet].filter(cell => !sourceSet.has(cell)).length
      if (format === 'pnpm-v9') {
        v9SourceCells += sourceSet.size
        v9ReplayCells += replaySet.size
      }
    }

    expect({ detected: files.length, replayed }).toEqual({ detected: 70, replayed: 70 })
    expect({ sourceCells, survived, added }).toEqual({ sourceCells: 174, survived: 174, added: 0 })
    expect({ v9SourceCells, v9ReplayCells }).toEqual({ v9SourceCells: 0, v9ReplayCells: 0 })
    // A corpus walk, so it carries its own budget rather than living under the
    // tight global default — the config keeps that global tight on purpose so a
    // hang in a fast case still surfaces. V8 coverage adds ~34% to a walk like
    // this, which is what pushed it over 30s in the coverage lane while the
    // plain lane clears it in under ten seconds.
  }, corpusBudget(30_000))
})
