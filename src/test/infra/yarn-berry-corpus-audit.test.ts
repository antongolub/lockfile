import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  detect,
  parse,
  stringify,
} from '../../main/ts/api/format-api.ts'
import type { FormatId } from '../../main/ts/api/format-contract.ts'
import type { ProjectionLoss } from '../../main/ts/api/errors.ts'
import type { Graph } from '../../main/ts/graph.ts'

const corpusRoot = resolve('tmp/yarn-corpus/raw')
const corpusAvailable = existsSync(corpusRoot)
const suite = corpusAvailable ? describe : describe.skip
const knownBuiltinPatchRefusal =
  'v7--madjam002__yarnpnp2nix__test_workspace_yarn.lock@8512577'

const classify = (losses: readonly ProjectionLoss[]): string | undefined => {
  if (losses.some(loss => loss.class === 'berry-checksum')) return 'berry-checksum'
  return undefined
}

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

suite(
  corpusAvailable
    ? 'Yarn Berry external corpus audit'
    : 'Yarn Berry external corpus audit [skipped: gitignored tmp/yarn-corpus/raw is absent]',
  () => {
    it('focuses the known strict-refusal and invalid Berry risk shapes', () => {
      const refused = new Map<string, number>()
      const unexpected: string[] = []
      let selected = 0
      let invalid = 0

      for (const file of readdirSync(corpusRoot).sort()) {
        const input = readFileSync(resolve(corpusRoot, file), 'utf8')
        if (file !== knownBuiltinPatchRefusal && !/^<{7} /m.test(input)) continue
        const candidate = detect(input)
        if (candidate === undefined || !candidate.startsWith('yarn-berry-')) continue
        const format = candidate as FormatId
        selected += 1
        let graph: Graph | undefined
        try {
          graph = parse(input, format)
          stringify(graph, format)
          continue
        } catch (error) {
          if (graph === undefined && /expected ':' after key/.test(String((error as Error)?.message))) {
            invalid += 1
            continue
          }
          if (graph === undefined) {
            unexpected.push(`${file}: ${String((error as Error)?.message).slice(0, 180)}`)
            continue
          }
          const losses = (error as { losses?: readonly ProjectionLoss[] }).losses ?? []
          const reason = classify(losses)
          if (reason !== 'berry-checksum' || !isKnownBuiltinPatchRefusal(graph, losses)) {
            unexpected.push(`${file}: ${String((error as Error)?.message).slice(0, 180)}`)
            continue
          }
          refused.set(reason, (refused.get(reason) ?? 0) + 1)
        }
      }

      const gaps = [...refused].sort().map(([reason, count]) => `${reason}=${count}`).join(' ')
      // The declaration-protocol audit owns the full strict-replay boundary;
      // this raw prefilter keeps only the known refusal and invalidity risks.
      console.log(`berry risk prefilter: ${selected} | refused ${gaps} | invalid ${invalid}`)
      expect(unexpected, 'refusals outside the known set').toEqual([])
      expect(refused.get('berry-checksum'), 'required builtin patch stays fail-closed').toBe(1)
      expect(invalid).toBe(2)
    }, 60_000)
  },
)
