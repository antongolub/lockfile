import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LockfileError } from '../../main/ts/api/errors.ts'
import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

type UndetectedClass = 'legacy-shrinkwrap' | 'valid-npm-v2-gap' | 'malformed' | 'junk'

interface UndetectedInput {
  readonly file: string
  readonly input: string
  readonly kind: UndetectedClass
}

interface CorpusInput {
  readonly file: string
  readonly input: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some(item => hasKeyDeep(item, key))
  if (!isRecord(value)) return false
  if (Object.prototype.hasOwnProperty.call(value, key)) return true
  return Object.values(value).some(item => hasKeyDeep(item, key))
}

function classify(input: string): UndetectedClass {
  let value: unknown
  try { value = JSON.parse(input) } catch { return 'junk' }
  if (!isRecord(value)) return 'junk'

  const hasVersion = Object.prototype.hasOwnProperty.call(value, 'lockfileVersion')
  const dependencies = value.dependencies
  if (!hasVersion
    && isRecord(dependencies)
    && Object.keys(dependencies).length > 0
    && !hasKeyDeep(dependencies, 'integrity')) {
    return 'legacy-shrinkwrap'
  }

  const version = value.lockfileVersion
  const packages = value.packages
  const hasPackagesRoot = isRecord(packages)
    && Object.prototype.hasOwnProperty.call(packages, '')
  const hasOnlyPackagesRoot = hasPackagesRoot && Object.keys(packages).length === 1
  if (version === 2 && hasOnlyPackagesRoot
    && !Object.prototype.hasOwnProperty.call(value, 'dependencies')) {
    return 'valid-npm-v2-gap'
  }
  if ((version === 2 || version === 3) && !hasPackagesRoot) return 'malformed'
  return 'junk'
}

function parseError(input: string): LockfileError {
  let error: unknown
  try { parse(input) } catch (caught) { error = caught }
  expect(error).toBeInstanceOf(LockfileError)
  return error as LockfileError
}

const corpus: readonly CorpusInput[] = corpusAvailable
  ? readdirSync(corpusRoot).sort().map(file => ({
      file,
      input: readFileSync(resolve(corpusRoot, file), 'utf8'),
    }))
  : []
const undetected: readonly UndetectedInput[] = corpus.flatMap(item =>
  detect(item.input) === undefined ? [{ ...item, kind: classify(item.input) }] : [],
)
const dependencyFreeV2 = corpus.filter(item => classify(item.input) === 'valid-npm-v2-gap')
let measuredCoverage: Readonly<{ parsedEmitted: number; byteExact: number }> | undefined

function measureCoverage(): Readonly<{ parsedEmitted: number; byteExact: number }> {
  if (measuredCoverage !== undefined) return measuredCoverage
  let parsedEmitted = 0
  let byteExact = 0
  for (const item of corpus) {
    const format = detect(item.input)
    if (format === undefined) continue
    try {
      const output = stringify(parse(item.input, format), format, { strict: false })
      parsedEmitted += 1
      if (output === item.input) byteExact += 1
    } catch {
      // Existing known adapter defects remain outside Item B.
    }
  }
  measuredCoverage = Object.freeze({ parsedEmitted, byteExact })
  return measuredCoverage
}

suite(
  corpusAvailable
    ? 'npm undetected corpus classification'
    : 'npm undetected corpus classification [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('pins 16 undetected plus four producer-valid npm-v2 inputs', () => {
      expect(undetected).toHaveLength(16)
      expect(dependencyFreeV2).toHaveLength(4)
      expect(Object.fromEntries(
        (['legacy-shrinkwrap', 'valid-npm-v2-gap', 'malformed', 'junk'] as const)
          .map(kind => [kind, undetected.filter(item => item.kind === kind).length]),
      )).toEqual({
        'legacy-shrinkwrap': 8,
        'valid-npm-v2-gap': 0,
        malformed: 6,
        junk: 2,
      })
    })

    it('names all eight pre-npm-5 shrinkwrap refusals', () => {
      for (const item of undetected.filter(item => item.kind === 'legacy-shrinkwrap')) {
        const error = parseError(item.input)
        expect(error.code, item.file).toBe('FORMAT_DETECT_FAILED')
        expect(error.diagnostics, item.file).toEqual([
          expect.objectContaining({ code: 'NPM_SHRINKWRAP_PRE_LOCKFILE_VERSION' }),
        ])
      }
    })

    it('names only the six malformed declared npm lockfiles', () => {
      for (const item of undetected.filter(item => item.kind === 'malformed')) {
        const error = parseError(item.input)
        expect(error.code, item.file).toBe('FORMAT_DETECT_FAILED')
        expect(error.diagnostics, item.file).toEqual([
          expect.objectContaining({ code: 'NPM_LOCKFILE_STRUCTURE_MISSING' }),
        ])
      }
    })

    it('keeps the two junk inputs generic', () => {
      for (const item of undetected.filter(item => item.kind === 'junk')) {
        const error = parseError(item.input)
        expect(error.code, item.file).toBe('FORMAT_DETECT_FAILED')
        expect(error.diagnostics, item.file).toEqual([])
      }
    })

    it('detects, parses, and emits all four producer-valid npm-v2 inputs', () => {
      for (const item of dependencyFreeV2) {
        expect(detect(item.input), item.file).toBe('npm-2')
        const output = stringify(parse(item.input), 'npm-2')
        expect(JSON.parse(output).dependencies, item.file).toBeUndefined()
      }
    })

    it('pins zero producer-authored v2 locks with an explicit empty mirror', () => {
      const explicitEmptyMirrors = corpus.filter(item => {
        let value: unknown
        try { value = JSON.parse(item.input) } catch { return false }
        if (!isRecord(value) || value.lockfileVersion !== 2) return false
        return isRecord(value.dependencies) && Object.keys(value.dependencies).length === 0
      })
      expect(explicitEmptyMirrors).toEqual([])
    })

    it('never regresses the 1797-file parse+emit floor', () => {
      expect(measureCoverage().parsedEmitted).toBeGreaterThanOrEqual(1797)
    }, 180_000)

    it('never regresses the 395-file byte-exact floor', () => {
      expect(measureCoverage().byteExact).toBeGreaterThanOrEqual(395)
    }, 180_000)
  },
)
