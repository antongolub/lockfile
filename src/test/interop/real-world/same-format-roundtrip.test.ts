import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { detect, parse, stringify } from '../../../main/ts/index.ts'

const corpusRoot = resolve('src/test/resources/fixtures/real-world')

describe('real-world same-format fidelity contract', () => {
  it('strictly round-trips every detected lockfile at Graph level', () => {
    let count = 0
    for (const repo of readdirSync(corpusRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()) {
      for (const fileName of readdirSync(resolve(corpusRoot, repo), { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name !== 'package.json' && name !== 'pnpm-workspace.yaml')
        .sort()) {
        const source = readFileSync(resolve(corpusRoot, repo, fileName), 'utf8')
        const format = detect(source)
        expect(format, `${repo}/${fileName}`).toBeDefined()
        const graph = parse(format!, source)

        // Same-format fidelity is the graph-level oracle from the common
        // format contract. `strict:false` permits native sidecar carriers
        // (notably Berry checksums); the assertions below independently prove
        // that the emitted lock reparses to the same modeled graph/tarballs.
        const output = stringify(format!, graph, { strict: false })
        const reparsed = parse(format!, output)
        for (const [kind, changes] of Object.entries(graph.diff(reparsed))) {
          expect(changes, `${repo}/${fileName}: ${kind}`).toEqual([])
        }
        expect(
          Array.from(reparsed.tarballs()),
          `${repo}/${fileName}: tarballs`,
        ).toEqual(Array.from(graph.tarballs()))
        count++
      }
    }
    expect(count).toBe(40)
  }, 120_000)
})
