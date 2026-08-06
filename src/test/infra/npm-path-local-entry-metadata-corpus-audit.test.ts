import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip
const fields = ['integrity', 'resolved', 'license', 'dev', 'peer', 'inBundle'] as const
type Field = typeof fields[number]

interface FieldMeasurement {
  readonly added: number
  readonly changed: number
  readonly dropped: number
  readonly siblingTransfer: number
  readonly unrelated: number
}

interface Measurement {
  readonly candidates: number
  readonly missingLinkPaths: number
  readonly missingNonLinkPaths: number
  readonly replayed: number
  readonly fields: Readonly<Record<Field, FieldMeasurement>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function packageName(installPath: string, entry: Record<string, unknown>): string | undefined {
  if (typeof entry.name === 'string') return entry.name
  return (`/${installPath}`).split('/node_modules/').filter(Boolean).at(-1)
}

function valueKey(value: unknown): string {
  return value === undefined ? '<absent>' : JSON.stringify(value)
}

let cached: Measurement | undefined

function measure(): Measurement {
  if (cached !== undefined) return cached
  let candidates = 0
  let missingLinkPaths = 0
  let missingNonLinkPaths = 0
  let replayed = 0
  const mutable = Object.fromEntries(fields.map(field => [field, {
    added: 0,
    changed: 0,
    dropped: 0,
    siblingTransfer: 0,
    unrelated: 0,
  }])) as Record<Field, {
    added: number
    changed: number
    dropped: number
    siblingTransfer: number
    unrelated: number
  }>

  for (const file of readdirSync(corpusRoot).sort()) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    let source: unknown
    try { source = JSON.parse(input) } catch { continue }
    if (!isRecord(source) || (source.lockfileVersion !== 2 && source.lockfileVersion !== 3)) continue
    if (!isRecord(source.packages)) continue
    candidates += 1
    const expectedFormat = `npm-${source.lockfileVersion}`
    const format = detect(input)
    if (format !== expectedFormat) continue
    let emitted: unknown
    try {
      emitted = JSON.parse(stringify(parse(input, format), format, { strict: false }))
    } catch {
      continue
    }
    if (!isRecord(emitted) || !isRecord(emitted.packages)) continue
    replayed += 1

    const sourcePackages = source.packages as Record<string, unknown>
    const emittedPackages = emitted.packages as Record<string, unknown>
    const groups = new Map<string, Array<readonly [string, Record<string, unknown>]>>()
    for (const [path, rawEntry] of Object.entries(sourcePackages)) {
      if (path === '' || !isRecord(rawEntry) || typeof rawEntry.version !== 'string') continue
      const name = packageName(path, rawEntry)
      if (name === undefined) continue
      const key = `${name}@${rawEntry.version}`
      const entries = groups.get(key) ?? []
      entries.push([path, rawEntry])
      groups.set(key, entries)
    }

    for (const [path, rawSourceEntry] of Object.entries(sourcePackages)) {
      if (path === '' || !isRecord(rawSourceEntry)) continue
      const emittedEntry = emittedPackages[path]
      if (!isRecord(emittedEntry)) {
        if (rawSourceEntry.link === true) missingLinkPaths += 1
        else missingNonLinkPaths += 1
      }
      const name = packageName(path, rawSourceEntry)
      const identity = typeof rawSourceEntry.version === 'string' && name !== undefined
        ? `${name}@${rawSourceEntry.version}`
        : undefined
      const siblings = identity === undefined ? [] : (groups.get(identity) ?? [])

      for (const field of fields) {
        const before = rawSourceEntry[field]
        const after = isRecord(emittedEntry) ? emittedEntry[field] : undefined
        if (valueKey(before) === valueKey(after)) continue
        const kind = before === undefined ? 'added' : after === undefined ? 'dropped' : 'changed'
        mutable[field][kind] += 1
        const transferred = siblings.some(([siblingPath, sibling]) =>
          siblingPath !== path
          && valueKey(sibling[field]) === valueKey(after)
          && valueKey(sibling[field]) !== valueKey(before))
        if (transferred) mutable[field].siblingTransfer += 1
        else mutable[field].unrelated += 1
      }
    }
  }

  cached = Object.freeze({
    candidates,
    missingLinkPaths,
    missingNonLinkPaths,
    replayed,
    fields: Object.freeze(Object.fromEntries(fields.map(field => [
      field,
      Object.freeze({ ...mutable[field] }),
    ])) as Record<Field, FieldMeasurement>),
  })
  return cached
}

suite(
  corpusAvailable
    ? 'npm path-local package-entry metadata corpus audit'
    : 'npm path-local package-entry metadata corpus audit [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('reports the replayable npm-v2/v3 population without pinning corpus size', () => {
      const { candidates, replayed } = measure()
      console.info('npm path-local entry corpus frame', { candidates, replayed })
      expect(replayed).toBeLessThanOrEqual(candidates)
    }, 180_000)

    it('retains every non-link package path while keeping link losses separate', () => {
      expect({
        link: measure().missingLinkPaths,
        nonLink: measure().missingNonLinkPaths,
      }).toEqual({ link: 0, nonLink: 0 })
    }, 180_000)

    it('preserves every integrity value and absence at its source install path', () => {
      expect(measure().fields.integrity).toMatchObject({
        added: 0,
        changed: 0,
        dropped: 0,
        siblingTransfer: 0,
        unrelated: 0,
      })
    }, 180_000)

    it('preserves every resolved value and absence at its source install path', () => {
      const { fields: { resolved } } = measure()
      expect(resolved).toMatchObject({
        added: 0,
        changed: 0,
        dropped: 0,
        siblingTransfer: 0,
        unrelated: 0,
      })
    }, 180_000)

    it('closes sibling license transfers while keeping unrelated drops separately visible', () => {
      const { siblingTransfer, unrelated } = measure().fields.license
      console.info('npm path-local entry unrelated license divergences', { unrelated })
      expect(siblingTransfer).toBe(0)
    }, 180_000)

    it('never spreads NodeId-local flags to a sibling install path', () => {
      const { dev, peer, inBundle } = measure().fields
      const flagFields = { dev, peer, inBundle }
      console.info('npm path-local flag divergences', flagFields)
      for (const field of ['dev', 'peer', 'inBundle'] as const) {
        expect(flagFields[field]).toMatchObject({
          added: 0,
          changed: 0,
          siblingTransfer: 0,
        })
      }
      expect(flagFields.dev.dropped).toBeLessThanOrEqual(7)
      expect(flagFields.dev.unrelated).toBeLessThanOrEqual(7)
      expect(flagFields.peer).toMatchObject({ dropped: 0, unrelated: 0 })
      expect(flagFields.inBundle).toMatchObject({ dropped: 0, unrelated: 0 })
    }, 180_000)
  },
)
