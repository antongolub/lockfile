import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { detect, parse, stringify } from '../../main/ts/api/format-api.ts'
import { corpusBudget } from './_corpus-budget.ts'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sourceToken(entry: Readonly<Record<string, unknown>>): string {
  if (typeof entry.resolved === 'string') return entry.resolved
  return typeof entry.version === 'string' ? entry.version : '<absent>'
}

function isDefaultRegistryUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === 'registry.npmjs.org' || host === 'registry.yarnpkg.com'
  } catch {
    return false
  }
}

function hasV1SourceRisk(value: unknown): boolean {
  if (!isRecord(value) || value.lockfileVersion !== 1 || !isRecord(value.dependencies)) return false
  const sourcesByIdentity = new Map<string, Set<string>>()
  let nonDefaultSource = false
  const visit = (dependencies: Readonly<Record<string, unknown>>): void => {
    for (const [name, rawEntry] of Object.entries(dependencies)) {
      if (!isRecord(rawEntry)) continue
      const sources = sourcesByIdentity.get(`${name}@${String(rawEntry.version)}`) ?? new Set<string>()
      sources.add(sourceToken(rawEntry))
      sourcesByIdentity.set(`${name}@${String(rawEntry.version)}`, sources)
      if (typeof rawEntry.resolved === 'string' && !isDefaultRegistryUrl(rawEntry.resolved)) {
        nonDefaultSource = true
      } else if (rawEntry.resolved === undefined
        && typeof rawEntry.version === 'string'
        && /^(?:file:|git(?:\+|:)|github:|https?:)/.test(rawEntry.version)) {
        nonDefaultSource = true
      }
      if (isRecord(rawEntry.dependencies)) visit(rawEntry.dependencies)
    }
  }
  visit(value.dependencies)
  return nonDefaultSource || [...sourcesByIdentity.values()].some(sources => sources.size > 1)
}

suite(
  corpusAvailable
    ? 'npm external corpus source-target audit'
    : 'npm external corpus source-target audit [skipped: gitignored tmp/npm-corpus/raw is absent]',
  () => {
    it('parses every source-risk npm-1 and Chinese-mirror lock without seal regressions', () => {
      const unexpected: string[] = []
      const sourceTargetSealFailures: string[] = []
      let selected = 0
      let mirrorTotal = 0
      let mirrorParsed = 0
      let mirrorSeal = 0

      for (const file of readdirSync(corpusRoot).sort()) {
        const input = readFileSync(resolve(corpusRoot, file), 'utf8')
        const hasChineseMirror = chineseMirrorHosts.some(host => input.includes(host))
        if (hasChineseMirror) mirrorTotal += 1
        let value: unknown
        try { value = JSON.parse(input) } catch { continue }
        if (!hasChineseMirror && !hasV1SourceRisk(value)) continue
        selected += 1
        const format = detect(input)
        if (format === undefined) {
          unexpected.push(`${file}: selected source-risk input was not detected`)
          continue
        }
        try {
          stringify(parse(input, format), format, { strict: false })
          if (hasChineseMirror) mirrorParsed += 1
        } catch (error) {
          const message = String((error as Error).message)
          if (message.includes('edge target missing from node table')) {
            sourceTargetSealFailures.push(file)
            if (hasChineseMirror) mirrorSeal += 1
          } else if (!knownOtherFailures.has(file)) {
            unexpected.push(`${file}: ${message.slice(0, 180)}`)
          }
        }
      }

      console.log(
        `npm source-target prefilter: selected ${selected}`
        + ` | source-target seal ${sourceTargetSealFailures.length}`
        + ` | mirror ${mirrorParsed}/${mirrorTotal} parsed, ${mirrorSeal} seal`,
      )
      expect(unexpected).toEqual([])
      expect(sourceTargetSealFailures).toEqual([])
      expect({ mirrorTotal, mirrorParsed, mirrorSeal }).toEqual({
        mirrorTotal: 77,
        mirrorParsed: 77,
        mirrorSeal: 0,
      })
      // Full-corpus parse/byte floors and the authoritative zero source-target
      // seal are owned by npm-undetected-corpus-audit.test.ts. This focused
      // audit keeps the source-risk and Chinese-mirror oracles inexpensive.
    }, corpusBudget(120_000))
  },
)
