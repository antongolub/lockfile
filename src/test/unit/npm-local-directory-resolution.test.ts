import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parse,
  stringify,
  type Diagnostic,
  type FormatId,
} from '../../main/ts/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const realWorldFixture = (name: string): string =>
  readFileSync(resolve(here, `../resources/fixtures/real-world/${name}/yarn.lock`), 'utf8')

const NPM_TARGETS = ['npm-1', 'npm-2', 'npm-3', 'npm-4'] as const satisfies readonly FormatId[]
const LOCAL_CASES = [
  {
    fixture: 'hahazexia-scan2findimgs-localdep',
    facts: [
      {
        id: 'vendored-utils@0.0.0',
        resolved: 'link:./vendor/utils',
        path: './vendor/utils',
      },
    ],
  },
  {
    fixture: 'magento-pwa-studio-localdep',
    facts: [
      {
        id: '@magento/peregrine@0.0.0',
        resolved: 'link:packages/peregrine',
        path: 'packages/peregrine',
      },
      {
        id: '@magento/venia-ui@0.0.0',
        resolved: 'portal:packages/venia-ui',
        path: 'packages/venia-ui',
      },
    ],
  },
] as const

function emitNpmTarget(fixture: string, target: FormatId): string {
  const source = parse('yarn-classic', realWorldFixture(fixture))
  return stringify(target, source, { strict: false })
}

describe('npm local directory resolution — red-first semantic regressions', () => {
  for (const localCase of LOCAL_CASES) {
    it.each(NPM_TARGETS)(
      `${localCase.fixture} → %s reparses link:/portal: as directory without unknown diagnostics`,
      target => {
        const diagnostics: Diagnostic[] = []
        const output = emitNpmTarget(localCase.fixture, target)
        const reparsed = parse(target, output, {
          onDiagnostic: diagnostic => diagnostics.push(diagnostic),
        })

        for (const fact of localCase.facts) {
          expect(reparsed.tarballOf(fact.id)?.resolution).toEqual({
            type: 'directory',
            path: fact.path,
          })
        }
        expect(diagnostics.filter(diagnostic => diagnostic.code === 'RECIPE_RESOLUTION_UNKNOWN')).toEqual([])
      },
    )
  }
})

describe('npm local directory resolution — exact-spelling guards (green on base)', () => {
  for (const localCase of LOCAL_CASES) {
    it.each(NPM_TARGETS)(
      `${localCase.fixture} → %s keeps native link:/portal: spelling on second emit`,
      target => {
        const first = emitNpmTarget(localCase.fixture, target)
        const second = stringify(target, parse(target, first), { strict: false })

        for (const fact of localCase.facts) {
          expect(second).toContain(`"resolved": "${fact.resolved}"`)
        }
      },
    )
  }
})
