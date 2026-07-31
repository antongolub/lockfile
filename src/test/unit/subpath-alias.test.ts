import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FormatId } from '../../main/ts/api/format-contract.ts'
import {
  checkFormat,
  detectFormat,
  parseFormat,
  stringifyFormat,
} from '../../main/ts/api/format-registry.ts'
import { newBuilder } from '../../main/ts/graph.ts'
import * as root from '../../main/ts/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')
const packageJson = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as {
  readonly exports: Readonly<Record<string, unknown>>
}

const FORMATS = [
  'bun-text',
  'deno-v2',
  'deno-v3',
  'deno-v4',
  'deno-v5',
  'lockgraph',
  'npm-1',
  'npm-2',
  'npm-3',
  'npm-4',
  'pnpm-v5',
  'pnpm-v6',
  'pnpm-v9',
  'yarn-berry-v10',
  'yarn-berry-v4',
  'yarn-berry-v5',
  'yarn-berry-v6',
  'yarn-berry-v7',
  'yarn-berry-v8',
  'yarn-berry-v9',
  'yarn-classic',
] as const satisfies readonly FormatId[]

const fixture = (file: string): string => readFileSync(
  resolve(here, '../resources/fixtures/lockfiles/simple', file),
  'utf8',
)

function inputFor(format: FormatId): string {
  if (format === 'lockgraph') return stringifyFormat(format, newBuilder().seal())
  if (format === 'yarn-berry-v10') {
    return fixture('yarn-berry-v9.lock')
      .replace(/(^__metadata:\s*\n\s+version:\s*)9(\s)/m, '$110$2')
  }
  if (format === 'deno-v5') return fixture('deno.lock')
  return fixture(`${format}.lock`)
}

function nodeProbe(source: string) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  )
}

describe('package boundary — root only', () => {
  it('publishes exactly the root entry', () => {
    expect(Object.keys(packageJson.exports)).toEqual(['.'])
    expect(packageJson).not.toHaveProperty('typesVersions')
  })

  it.each(['modify', 'complete', 'optimize', 'registry', 'enrich'])(
    'rejects the former %s package subpath',
    subpath => {
      const probe = nodeProbe(`
        try {
          await import('lockgraph/${subpath}')
          process.exit(1)
        } catch (error) {
          if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') process.exit(2)
        }
      `)
      expect(probe.status, probe.stderr).toBe(0)
    },
  )
})

describe('format package boundary — root replacement', () => {
  it('does not publish the format wildcard through package exports', () => {
    expect(packageJson.exports).not.toHaveProperty('./formats/*')
    expect(packageJson.exports).not.toHaveProperty('./formats/_*')
  })

  it('rejects a format-adapter package self-import', () => {
    const probe = nodeProbe(`
      try {
        await import('lockgraph/formats/npm-3')
        process.exit(1)
      } catch (error) {
        if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
          console.error(error)
          process.exit(2)
        }
      }
    `)

    expect(probe.status, probe.stderr).toBe(0)
  })

  it.each(FORMATS)('replaces direct %s access through the root facade', format => {
    const input = inputFor(format)
    expect(root.check(input, format)).toBe(checkFormat(format, input))
    expect(root.detect(input)).toBe(detectFormat(input))

    const rootGraph = root.parse(input, format)
    const registryGraph = parseFormat(format, input)
    expect(root.stringify(rootGraph, format, { strict: false }))
      .toBe(stringifyFormat(format, registryGraph))
  })
})
