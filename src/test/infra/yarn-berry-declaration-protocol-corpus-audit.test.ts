import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  detect,
  parse,
  stringify,
  type FormatId,
} from '../../main/ts/index.ts'
import type { ProjectionLoss } from '../../main/ts/api/errors.ts'
import {
  parse as parseSyml,
  type SymlMap,
} from '../../main/ts/formats/_yarn-syml.ts'
import type { Graph } from '../../main/ts/graph.ts'

type BerryFormat = Extract<FormatId, `yarn-berry-v${number}`>
type ProtocolKind = 'alias' | 'plain'

const corpusRoot = resolve('tmp/yarn-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip
const DECLARATION_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

interface Entry {
  readonly key: string
  readonly value: SymlMap
  readonly resolution?: string
}

interface ProtocolStats {
  source: number
  survived: number
  selfSource: number
  selfSurvived: number
  ordinarySource: number
  ordinarySurvived: number
  readonly files: Set<string>
  readonly mismatchedFiles: Set<string>
}

interface GenerationStats {
  detected: number
  replayed: number
  invalid: number
  readonly plain: ProtocolStats
  readonly alias: ProtocolStats
}

function protocolStats(): ProtocolStats {
  return {
    source: 0,
    survived: 0,
    selfSource: 0,
    selfSurvived: 0,
    ordinarySource: 0,
    ordinarySurvived: 0,
    files: new Set(),
    mismatchedFiles: new Set(),
  }
}

function generationStats(): GenerationStats {
  return {
    detected: 0,
    replayed: 0,
    invalid: 0,
    plain: protocolStats(),
    alias: protocolStats(),
  }
}

function isMap(value: unknown): value is SymlMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function entries(document: SymlMap): Entry[] {
  return Object.entries(document).flatMap(([key, value]) => {
    if (key === '__metadata' || !isMap(value)) return []
    return [{
      key,
      value,
      resolution: typeof value.resolution === 'string' ? value.resolution : undefined,
    }]
  })
}

function aliasTarget(value: string): string | undefined {
  const rest = value.slice('npm:'.length)
  if (rest.startsWith('@')) {
    const slash = rest.indexOf('/')
    const separator = rest.indexOf('@', slash + 1)
    return slash > 1 && separator > slash + 1 ? rest.slice(0, separator) : undefined
  }
  const separator = rest.indexOf('@')
  return separator > 0 ? rest.slice(0, separator) : undefined
}

function kindOf(value: string): ProtocolKind {
  return aliasTarget(value) === undefined ? 'plain' : 'alias'
}

function combine(into: ProtocolStats, from: ProtocolStats): void {
  into.source += from.source
  into.survived += from.survived
  into.selfSource += from.selfSource
  into.selfSurvived += from.selfSurvived
  into.ordinarySource += from.ordinarySource
  into.ordinarySurvived += from.ordinarySurvived
  for (const file of from.files) into.files.add(file)
  for (const file of from.mismatchedFiles) into.mismatchedFiles.add(file)
}

const generations = new Map<BerryFormat, GenerationStats>()
const total = generationStats()
const invalidFiles: string[] = []
const strictRefused = new Map<string, number>()
const strictUnexpected: string[] = []
let strictReplayed = 0
let byteExact = 0

function isKnownBuiltinPatchRefusal(
  graph: Graph,
  losses: readonly ProjectionLoss[],
): boolean {
  return losses.length > 0 && losses.every(loss => {
    if (loss.class !== 'berry-checksum' || typeof loss.subject !== 'string') return false
    const native = graph.tarballOf(loss.subject)?.nativeResolution
    if (native === undefined || !native.includes('builtin<compat/fsevents>')) return false
    return graph.in(loss.subject).some(edge =>
      edge.kind !== 'optional' && edge.attrs?.optional !== true)
  })
}

function statsFor(format: BerryFormat): GenerationStats {
  const existing = generations.get(format)
  if (existing !== undefined) return existing
  const created = generationStats()
  generations.set(format, created)
  return created
}

beforeAll(() => {
  for (const file of readdirSync(corpusRoot).sort()) {
    const input = readFileSync(resolve(corpusRoot, file), 'utf8')
    const detected = detect(input)
    if (detected === undefined || !detected.startsWith('yarn-berry-')) continue
    const format = detected as BerryFormat
    const generation = statsFor(format)
    generation.detected += 1
    total.detected += 1

    let graph: Graph
    try {
      graph = parse(format, input)
    } catch {
      generation.invalid += 1
      total.invalid += 1
      invalidFiles.push(file)
      continue
    }

    let output: string
    try {
      output = stringify(format, graph)
      strictReplayed += 1
    } catch (error) {
      const losses = (error as { losses?: readonly ProjectionLoss[] }).losses ?? []
      if (isKnownBuiltinPatchRefusal(graph, losses)) {
        strictRefused.set('berry-checksum', (strictRefused.get('berry-checksum') ?? 0) + 1)
      } else {
        strictUnexpected.push(`${file}: ${String((error as Error)?.message).slice(0, 180)}`)
      }
      output = stringify(format, graph, { strict: false })
    }
    generation.replayed += 1
    total.replayed += 1
    if (output === input) byteExact += 1

    const sourceEntries = entries(parseSyml(input))
    const outputEntries = entries(parseSyml(output))
    const outputByResolution = new Map<string, Entry[]>()
    for (const entry of outputEntries) {
      if (entry.resolution === undefined) continue
      const values = outputByResolution.get(entry.resolution) ?? []
      values.push(entry)
      outputByResolution.set(entry.resolution, values)
    }

    for (const sourceEntry of sourceEntries) {
      let outputEntry = outputEntries.find(candidate => candidate.key === sourceEntry.key)
      if (outputEntry === undefined && sourceEntry.resolution !== undefined) {
        const matches = outputByResolution.get(sourceEntry.resolution) ?? []
        if (matches.length === 1) outputEntry = matches[0]
      }
      if (outputEntry === undefined) continue

      for (const block of DECLARATION_BLOCKS) {
        const sourceBlock = sourceEntry.value[block]
        if (!isMap(sourceBlock)) continue
        const outputBlock = outputEntry.value[block]
        for (const [name, sourceValue] of Object.entries(sourceBlock)) {
          if (typeof sourceValue !== 'string' || !sourceValue.startsWith('npm:')) continue
          const stats = generation[kindOf(sourceValue)]
          const observed = isMap(outputBlock) ? outputBlock[name] : undefined
          const survived = observed === sourceValue
          const self = aliasTarget(sourceValue) === name
          stats.source += 1
          stats.files.add(file)
          if (survived) stats.survived += 1
          else stats.mismatchedFiles.add(file)
          if (self) {
            stats.selfSource += 1
            if (survived) stats.selfSurvived += 1
          } else if (kindOf(sourceValue) === 'alias') {
            stats.ordinarySource += 1
            if (survived) stats.ordinarySurvived += 1
          }
        }
      }
    }
  }

  for (const generation of generations.values()) {
    combine(total.plain, generation.plain)
    combine(total.alias, generation.alias)
  }
}, 120_000)

suite(
  corpusAvailable
    ? 'Yarn Berry declaration protocol corpus audit'
    : 'Yarn Berry declaration protocol corpus audit [skipped: corpus absent]',
  () => {
    it('pins the complete detected/replayed corpus boundary', () => {
      process.stdout.write(`berry declaration corpus: byte-exact ${byteExact}/${total.replayed}\n`)
      expect({
        detected: total.detected,
        replayed: total.replayed,
        invalid: total.invalid,
      }).toEqual({ detected: 387, replayed: 385, invalid: 2 })
      expect(invalidFiles).toHaveLength(2)
      for (const file of invalidFiles) {
        expect(readFileSync(resolve(corpusRoot, file), 'utf8')).toMatch(/^<{7} /m)
      }
      // This is the authoritative full-corpus strict-replay boundary. The focused
      // risk audit must not grow a second adapter pass over the full population.
      expect({
        replayed: strictReplayed,
        refused: strictRefused.get('berry-checksum'),
        unexpected: strictUnexpected,
      }).toEqual({ replayed: 384, refused: 1, unexpected: [] })
    })

    it('preserves every explicit alias-form declaration value', () => {
      expect(total.alias.survived).toBe(total.alias.source)
      expect(total.alias.source).toBe(725)
    })

    it('preserves both observed self-alias declarations', () => {
      expect(total.alias.selfSource).toBe(2)
      expect(total.alias.selfSurvived).toBe(2)
    })

    it('preserves all 43 explicit-plain v4 declaration values', () => {
      const stats = generations.get('yarn-berry-v4')!.plain
      expect(stats.source).toBe(43)
      expect(stats.survived).toBe(43)
    })

    it('leaves no v4 source file with an explicit-plain mismatch', () => {
      const stats = generations.get('yarn-berry-v4')!.plain
      expect(stats.files.size).toBe(3)
      expect(stats.mismatchedFiles).toEqual(new Set())
    })

    it('preserves all 6,377 explicit-plain v6 declaration values', () => {
      const stats = generations.get('yarn-berry-v6')!.plain
      expect(stats.source).toBe(6_377)
      expect(stats.survived).toBe(6_377)
    })

    it('keeps all 723 ordinary renamed aliases byte-exact', () => {
      expect({
        source: total.alias.ordinarySource,
        survived: total.alias.ordinarySurvived,
      }).toEqual({ source: 723, survived: 723 })
    })

    it('keeps the non-root v7 self-alias byte-exact', () => {
      const stats = generations.get('yarn-berry-v7')!.alias
      expect({ source: stats.selfSource, survived: stats.selfSurvived })
        .toEqual({ source: 1, survived: 1 })
    })

    it('pins the explicit-plain generation distribution', () => {
      expect({
        v4: {
          values: generations.get('yarn-berry-v4')!.plain.source,
          files: generations.get('yarn-berry-v4')!.plain.files.size,
        },
        v5: {
          values: generations.get('yarn-berry-v5')!.plain.source,
          files: generations.get('yarn-berry-v5')!.plain.files.size,
        },
        v6: {
          values: generations.get('yarn-berry-v6')!.plain.source,
          files: generations.get('yarn-berry-v6')!.plain.files.size,
        },
      }).toEqual({
        v4: { values: 43, files: 3 },
        v5: { values: 0, files: 0 },
        v6: { values: 6_377, files: 3 },
      })
    })
  },
)
