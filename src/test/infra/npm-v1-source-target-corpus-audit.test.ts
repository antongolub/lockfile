import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'

const corpusRoot = resolve('tmp/npm-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip
const chineseMirrorHosts = [
  'registry.npm.taobao.org',
  'registry.npmmirror.com',
  'mirrors.tencent.com',
  'r.cnpmjs.org',
  'registry.m.jd.com',
] as const

const knownOtherFailures = new Set([
  'MED-CARE__MED-N-CARE__package-lock.json',
  'microsoft__vscode__extensions_microsoft-authentication_package-lock.json',
  'npm__cli__workspaces_arborist_test_fixtures_dep-missing-resolved_package-lock.json',
  'npm__cli__workspaces_arborist_test_fixtures_external-link-dep_package-lock.json',
  'npm__cli__workspaces_arborist_test_fixtures_external-link_root_package-lock.json',
  'npm__cli__workspaces_arborist_test_fixtures_minimist-git-metadep_package-lock.json',
  'npm__cli__workspaces_arborist_test_fixtures_pnpm_package-lock.json',
  'npm__cli__workspaces_arborist_test_fixtures_workspaces-need-update_package-lock.json',
  'oven-sh__bun__test_cli_install_migration_complex-workspace_package-lock.json',
  'poanetwork__posdao-contracts__package-lock.json',
  'pouchlabs__fasteejs__package-lock.json',
])

suite(
  corpusAvailable
    ? 'npm external corpus source-target audit'
    : 'npm external corpus source-target audit [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('parses every source-target npm-1 lock without regressing the existing corpus', () => {
      const unexpected: string[] = []
      const sourceTargetSealFailures: string[] = []
      let total = 0
      let parsedEmitted = 0
      let byteExact = 0
      let notDetected = 0
      let notJson = 0
      let knownOther = 0
      let mirrorTotal = 0
      let mirrorParsed = 0
      let mirrorSeal = 0

      for (const file of readdirSync(corpusRoot).sort()) {
        total += 1
        const input = readFileSync(resolve(corpusRoot, file), 'utf8')
        const hasChineseMirror = chineseMirrorHosts.some(host => input.includes(host))
        if (hasChineseMirror) mirrorTotal += 1
        try {
          JSON.parse(input)
        } catch {
          notJson += 1
          continue
        }
        const format = detect(input)
        if (format === undefined) {
          notDetected += 1
          continue
        }
        try {
          const output = stringify(parse(input, format), format, { strict: false })
          parsedEmitted += 1
          if (hasChineseMirror) mirrorParsed += 1
          if (output === input) byteExact += 1
        } catch (error) {
          const message = String((error as Error).message)
          if (message.includes('edge target missing from node table')) {
            sourceTargetSealFailures.push(file)
            if (hasChineseMirror) mirrorSeal += 1
          } else if (knownOtherFailures.has(file)) {
            knownOther += 1
          } else {
            unexpected.push(`${file}: ${message.slice(0, 180)}`)
          }
        }
      }

      console.log(
        `npm corpus: total ${total} | parsed+emitted ${parsedEmitted} | byte-exact ${byteExact}`
        + ` | source-target seal ${sourceTargetSealFailures.length} | not-detected ${notDetected}`
        + ` | not-json ${notJson} | known-other ${knownOther}`
        + ` | mirror ${mirrorParsed}/${mirrorTotal} parsed, ${mirrorSeal} seal`,
      )
      expect(unexpected).toEqual([])
      expect(sourceTargetSealFailures).toEqual([])
      expect({ mirrorTotal, mirrorParsed, mirrorSeal }).toEqual({
        mirrorTotal: 77,
        mirrorParsed: 77,
        mirrorSeal: 0,
      })
      // Exact pins are right for code properties (seal failures must remain
      // zero; the mirror class must remain complete) but not corpus-size
      // measurements. Population can grow; only regressions in direction fail.
      expect(parsedEmitted).toBeGreaterThanOrEqual(1797)
      expect(byteExact).toBeGreaterThanOrEqual(395)
      expect(notDetected).toBeLessThanOrEqual(15)
      expect(notJson).toBeLessThanOrEqual(5)
      expect(knownOther).toBeLessThanOrEqual(11)
    }, 120_000)
  },
)
