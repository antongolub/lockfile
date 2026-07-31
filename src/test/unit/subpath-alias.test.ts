import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { FormatId } from '../../main/ts/api/format-contract.ts'
import {
  checkFormat,
  detectFormat,
  parseFormat,
  stringifyFormat,
} from '../../main/ts/api/format-registry.ts'
import { newBuilder } from '../../main/ts/graph.ts'
import * as root from '../../main/ts/index.ts'
import type {
  AuditOptions as RootAuditOptions,
  RawAdvisory as RootRawAdvisory,
  ResolveRegistryOptions as RootResolveRegistryOptions,
} from '../../main/ts/index.ts'
import * as registry from '../../main/ts/registry/index.ts'
import type {
  AuditOptions as RegistryAuditOptions,
  RawAdvisory as RegistryRawAdvisory,
  ResolveRegistryOptions as RegistryResolveRegistryOptions,
} from '../../main/ts/registry/index.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')
const registryIndex = resolve(here, '../../main/ts/registry/index.ts')
const packageJson = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as {
  readonly exports: Readonly<Record<string, unknown>>
  readonly typesVersions: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

const retainedRegistryValues = [
  ['defaultFetch', root.defaultFetch, registry.defaultFetch],
  ['frozenRegistry', root.frozenRegistry, registry.frozenRegistry],
  ['liveRegistry', root.liveRegistry, registry.liveRegistry],
  ['npmCache', root.npmCache, registry.npmCache],
  ['pnpmCache', root.pnpmCache, registry.pnpmCache],
  ['resolveRegistry', root.resolveRegistry, registry.resolveRegistry],
  ['withYarnCacheChecksums', root.withYarnCacheChecksums, registry.withYarnCacheChecksums],
  ['yarnBerryCache', root.yarnBerryCache, registry.yarnBerryCache],
] as const

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

describe('registry subpath — root alias', () => {
  it.each(retainedRegistryValues)(
    'already shares %s with the root by identity',
    (_name, rootValue, subpathValue) => {
      expect(subpathValue).toBe(rootValue)
    },
  )

  it('resolves root and registry to the same module namespace and keeps a one-line source alias', () => {
    const probe = nodeProbe(`
      const [root, registry] = await Promise.all([
        import('lockgraph'),
        import('lockgraph/registry'),
      ])
      if (root !== registry) process.exit(1)
    `)

    expect(probe.status, probe.stderr).toBe(0)
    expect(readFileSync(registryIndex, 'utf8').trim()).toBe("export * from '../index.ts'")
  })

  it('does not publish the internal default registry constant', () => {
    expect('DEFAULT_REGISTRY' in root).toBe(false)
    expect('DEFAULT_REGISTRY' in registry).toBe(false)
  })

  it('types registry configuration and audit seams entirely from the root alias', () => {
    const resolveOptions: RootResolveRegistryOptions = {
      ecosystem: 'npm',
      env: {},
    }
    const auditOptions: RootAuditOptions = { chunkSize: 25 }
    const advisory: RootRawAdvisory = { id: 1 }

    expectTypeOf<RootResolveRegistryOptions>()
      .toEqualTypeOf<RegistryResolveRegistryOptions>()
    expectTypeOf<RootAuditOptions>().toEqualTypeOf<RegistryAuditOptions>()
    expectTypeOf<RootRawAdvisory>().toEqualTypeOf<RegistryRawAdvisory>()
    expect(resolveOptions.ecosystem).toBe('npm')
    expect(auditOptions.chunkSize).toBe(25)
    expect(advisory.id).toBe(1)
  })
})

describe('format package boundary — root replacement', () => {
  it('does not publish the format wildcard through package exports', () => {
    expect(packageJson.exports).not.toHaveProperty('./formats/*')
    expect(packageJson.exports).not.toHaveProperty('./formats/_*')
  })

  it('does not publish the format wildcard through typesVersions', () => {
    expect(packageJson.typesVersions['*']).not.toHaveProperty('formats/*')
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
