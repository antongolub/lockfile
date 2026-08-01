import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect, parse, stringify } from '../../main/ts/index.ts'
import type { DenoFormatId } from '../../main/ts/api/format-contract.ts'

const corpusRoot = resolve('tmp/deno-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip

// The corpus is gitignored scratch scraped from public repositories, and it grows
// whenever someone scrapes again. An exact file count makes the gate a function of
// who last ran the scraper, so it asserts the PROPERTY instead — a real, versioned,
// strict-JSON lock either replays byte-for-byte or is refused for a KNOWN reason —
// with a floor so the gate cannot quietly become vacuous.
const REPLAYABLE_FLOOR = 190

// Refusals we have measured and understand. A refusal outside this set is a new
// defect and fails the gate. Shrinking one of these is progress; the counts are
// printed on every run so the gaps stay visible instead of being absorbed.
// `collapse-onto-canonical-id` used to sit here at 14 files: Deno unrolls a
// mutual peer cycle to arbitrary depth, and every unrolling of one base projected
// onto one canonical NodeId. Those unrollings were measured to carry identical
// integrity in 513 of 513 corpus groups, so they now collapse onto one node and
// all 14 replay. It is deliberately NOT listed as a known refusal any more: the
// surviving refusal — two ids that collapse while carrying DIFFERENT integrity —
// has never been observed, and must fail this gate loudly if it ever is.
// `seal-failed-peer-edges` likewise used to cover 15 v5 locks where an aliased
// optional peer appeared both as a declaration and as its native suffix target.
// The alias declaration now owns that one peer projection, so the entire class
// replays and must fail this gate loudly if it returns.
// `entry-without-integrity` covered five v5 workspace-linked patch packages.
// Their source-authoritative absence is now recognized without permitting
// mutation-time synthesis, so that refusal class is also closed.
const KNOWN_REFUSALS = {
  'dangling-specifier': /references missing npm package/,
  'integrity-not-canonical': /integrity must be canonical/,
  'jsr-integrity-not-sha256-hex': /integrity must be lowercase SHA-256 hex/,
} as const

const isUpstreamFixture = (file: string) => file.startsWith('denoland__deno__')

const classifyRefusal = (message: string): string | undefined =>
  Object.entries(KNOWN_REFUSALS).find(([, pattern]) => pattern.test(message))?.[0]

suite(
  corpusAvailable
    ? 'deno external corpus audit'
    : 'deno external corpus audit [skipped: gitignored tmp/deno-corpus/raw is absent]',
  () => {
    // This case parses, seals and re-emits EVERY corpus file, so its runtime
    // tracks corpus size — the corpus grew from 277 to 3581 files, which alone
    // pushed it past the 30s suite default, and it grows again on every scrape.
    // Closing a refusal gap costs more still: a file that used to throw early now
    // does the full round trip, and the peer-cycle collapse alone promoted a 2 MB
    // lock carrying 357 native ids for one package pair. Measured on 3581 files
    // after that collapse: 19.0s alone, 29.3s under the full integration suite,
    // 43.8s under the suite while a second vitest run shared the machine. Budget
    // it here rather than globally, so no other test's ceiling moves; grow this
    // number when the corpus grows, and re-measure under the full suite on a
    // loaded machine — running alone understates it by half.
    it('byte-replays every real versioned lockfile, or refuses it for a known reason', () => {
      const realFiles = readdirSync(corpusRoot).filter(file => !isUpstreamFixture(file)).sort()
      const detected = new Map<DenoFormatId, number>()
      const refused = new Map<string, number>()
      const unexpected: string[] = []
      let replayed = 0
      let notJson = 0
      let unversioned = 0

      for (const file of realFiles) {
        const input = readFileSync(resolve(corpusRoot, file), 'utf8')
        let document: unknown
        try {
          document = JSON.parse(input)
        } catch {
          notJson += 1
          continue
        }
        const version = (document as { version?: unknown } | null)?.version
        // The pre-v2 format is a flat URL-to-hash map with no `version` key at all.
        if (typeof version !== 'string' || !/^[2345]$/.test(version)) {
          unversioned += 1
          continue
        }

        const format = detect(input)
        expect(format, file).toMatch(/^deno-v[2345]$/)
        const denoFormat = format as DenoFormatId
        detected.set(denoFormat, (detected.get(denoFormat) ?? 0) + 1)
        try {
          expect(stringify(parse(input, denoFormat), denoFormat), file).toBe(input)
          replayed += 1
        } catch (error) {
          const reason = classifyRefusal(String((error as Error)?.message))
          if (reason === undefined) unexpected.push(`${file}: ${String((error as Error)?.message).slice(0, 120)}`)
          else refused.set(reason, (refused.get(reason) ?? 0) + 1)
        }
      }

      const spread = [...detected].sort().map(([format, n]) => `${format}=${n}`).join(' ')
      const gaps = [...refused].sort().map(([reason, n]) => `${reason}=${n}`).join(' ')
      console.log(
        `deno corpus: ${realFiles.length} files | replayed ${replayed} (${spread})`
        + ` | refused ${[...refused.values()].reduce((a, b) => a + b, 0)} [${gaps}]`
        + ` | not-JSON ${notJson} | unversioned ${unversioned}`,
      )

      expect(unexpected, 'refusals outside the known set').toEqual([])
      expect(replayed).toBeGreaterThanOrEqual(REPLAYABLE_FLOOR)
      // Every generation we claim to support must be represented, or the replay
      // proves less than it appears to.
      expect([...detected.keys()].sort()).toEqual(['deno-v2', 'deno-v3', 'deno-v4', 'deno-v5'])
    }, 60_000)
  },
)
