import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convert } from '../../main/ts/convert/orchestrator.ts'
import type { Diagnostic } from '../../main/ts/graph.ts'
import { CONTRACTS } from './_matrix.ts'
import type { FormatId } from './_types.ts'
import { runIntraFamily } from './intra-family/_runner.ts'

const here = dirname(fileURLToPath(import.meta.url))

const OTHER_FORMATS: FormatId[] = [
  'yarn-berry-v4',
  'yarn-berry-v5',
  'yarn-berry-v6',
  'yarn-berry-v7',
  'yarn-berry-v8',
  'yarn-berry-v9',
  'yarn-classic',
  'npm-1',
  'npm-2',
  'npm-3',
  'pnpm-v5',
  'pnpm-v6',
  'pnpm-v9',
  'bun-text',
]

const incidentContracts = CONTRACTS.filter(contract =>
  (contract.from === 'npm-4' || contract.to === 'npm-4')
    && contract.from !== contract.to
    && contract.from !== 'yarn-berry-v10'
    && contract.to !== 'yarn-berry-v10')

runIntraFamily('interop: npm-4 incident pairs', incidentContracts)

const npm4MatrixFixture = (): string =>
  readFileSync(resolve(here, '../resources/fixtures/lockfiles/simple/npm-4.lock'), 'utf8')

function npm4NativeFixture(name: 'patch' | 'npm-extension'): {
  source: string
  workspaceRoot: string
} {
  const workspaceRoot = resolve(here, '../resources/fixtures/npm-v4', name)
  return {
    source: readFileSync(resolve(workspaceRoot, 'package-lock.json'), 'utf8'),
    workspaceRoot,
  }
}

describe('interop: npm-4 incident-pair coverage', () => {
  it('registers all 28 ordered incident pairs exactly once', () => {
    expect(incidentContracts).toHaveLength(28)
    expect(new Set(incidentContracts.map(contract =>
      `${contract.from} -> ${contract.to}`))).toHaveLength(28)
  })

  it.each(OTHER_FORMATS)(
    'npm-4 native patch -> %s either reports accepted loss or strict-rejects it',
    async to => {
      const { source, workspaceRoot } = npm4NativeFixture('patch')
      const diagnostics: Diagnostic[] = []

      await expect(convert(source, {
        from: 'npm-4',
        to,
        workspaceRoot,
        strict: false,
        onDiagnostic: diagnostic => diagnostics.push(diagnostic),
      })).resolves.toEqual(expect.any(String))
      expect(diagnostics).toContainEqual(expect.objectContaining({
        code: 'PROJECTION_LOSS',
        data: expect.objectContaining({
          feature: 'patch',
          target: to,
        }),
      }))

      await expect(convert(source, {
        from: 'npm-4',
        to,
        workspaceRoot,
      })).rejects.toMatchObject({ code: 'IRREDUCIBLE_LOSS' })
    },
  )

  it.each(OTHER_FORMATS)(
    'npm-4 manifest-extension provenance -> %s is reported and strict-rejected',
    async to => {
      const { source, workspaceRoot } = npm4NativeFixture('npm-extension')
      const diagnostics: Diagnostic[] = []

      await expect(convert(source, {
        from: 'npm-4',
        to,
        workspaceRoot,
        strict: false,
        onDiagnostic: diagnostic => diagnostics.push(diagnostic),
      })).resolves.toEqual(expect.any(String))
      expect(diagnostics).toContainEqual(expect.objectContaining({
        code: 'PROJECTION_LOSS',
        data: expect.objectContaining({
          class: 'inherent-meaningful',
          feature: 'manifest-extension-provenance',
          target: to,
        }),
      }))

      await expect(convert(source, {
        from: 'npm-4',
        to,
        workspaceRoot,
      })).rejects.toMatchObject({ code: 'IRREDUCIBLE_LOSS' })
    },
  )

  it('reports npm-4 -> bun root-version and multi-version edge degradation', async () => {
    const diagnostics: Diagnostic[] = []

    await expect(convert(npm4MatrixFixture(), {
      from: 'npm-4',
      to: 'bun-text',
      strict: false,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    })).resolves.toEqual(expect.any(String))
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'PROJECTION_LOSS',
        data: expect.objectContaining({
          feature: 'workspace-root-version',
          target: 'bun-text',
        }),
      }),
      expect.objectContaining({
        code: 'PROJECTION_LOSS',
        data: expect.objectContaining({
          feature: 'bun-package-key-resolution',
          target: 'bun-text',
        }),
      }),
    ]))

    await expect(convert(npm4MatrixFixture(), {
      from: 'npm-4',
      to: 'bun-text',
    })).rejects.toMatchObject({ code: 'IRREDUCIBLE_LOSS' })
  })
})
