import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { check, parse, stringify } from '../../main/ts/formats/deno.ts'

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

      for (const file of strictJsonFiles) {
        const input = readFileSync(resolve(corpusRoot, file), 'utf8')
        expect(check(input), file).toBe(true)
        expect(stringify(parse(input)), file).toBe(input)
      }
    })
  },
)
