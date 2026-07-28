import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect, parse, stringify } from '../../main/ts/index.ts'
import type { DenoFormatId } from '../../main/ts/api/format-contract.ts'

const corpusRoot = resolve('tmp/deno-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

suite(
  corpusAvailable
    ? 'deno external corpus audit'
    : 'deno external corpus audit [skipped: gitignored tmp/deno-corpus/raw is absent]',
  () => {
    it('parses and byte-replays all 190 real strict-JSON v2-v5 lockfiles', () => {
      const realFiles = readdirSync(corpusRoot)
        .filter(file => !file.startsWith('denoland__deno__'))
        .sort()
      const strictJsonFiles = realFiles.filter(file => {
        try {
          JSON.parse(readFileSync(resolve(corpusRoot, file), 'utf8'))
          return true
        } catch {
          return false
        }
      })

      expect(realFiles).toHaveLength(191)
      expect(strictJsonFiles).toHaveLength(190)

      const detectedCounts = new Map<DenoFormatId, number>()
      for (const file of strictJsonFiles) {
        const input = readFileSync(resolve(corpusRoot, file), 'utf8')
        const format = detect(input)
        expect(format, file).toMatch(/^deno-v[2345]$/)
        const denoFormat = format as DenoFormatId
        detectedCounts.set(denoFormat, (detectedCounts.get(denoFormat) ?? 0) + 1)
        expect(stringify(denoFormat, parse(denoFormat, input)), file).toBe(input)
      }
      expect(Object.fromEntries([...detectedCounts].sort())).toEqual({
        'deno-v2': 7,
        'deno-v3': 25,
        'deno-v4': 31,
        'deno-v5': 127,
      })
    })
  },
)
