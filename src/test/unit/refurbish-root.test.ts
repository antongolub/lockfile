import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parse,
  refurbish,
  type NpmTarballSource,
  type RefurbishOptions,
  type RefurbishResult,
  type RefurbishSources,
  type TarballSource,
} from '../../main/ts/index.ts'

const here = dirname(fileURLToPath(import.meta.url))

describe('root refurbish repair seam', () => {
  it('adapts the public graph while preserving the primitive format-default cache key', async () => {
    const lock = readFileSync(
      resolve(here, '../resources/fixtures/lockfiles/simple/yarn-berry-v8.lock'),
      'utf8',
    ).replace(/^  checksum: 10c0\/d924[^\n]*\n/m, '')
    const graph = parse(lock, 'yarn-berry-v8')
    const tarballs: NpmTarballSource = {
      async tarball(name, version) {
        return name === 'ms' && version === '2.1.3'
          ? readFileSync(resolve(here, '../resources/fixtures/tarballs/ms-2.1.3.tgz'))
          : undefined
      },
    }
    const sources: RefurbishSources = { npmTarballs: tarballs }
    const options: RefurbishOptions = { seed: new Set(['ms@2.1.3']) }
    if (false) {
      // @ts-expect-error the repair format is a validated lockfile format, not an arbitrary string
      void refurbish(graph, 'nmp-3', sources, options)
    }
    const result: RefurbishResult = await refurbish(
      graph,
      'yarn-berry-v8',
      sources,
      options,
    )

    expect(result.enriched).toEqual(['ms@2.1.3'])
    expect(result.graph.tarballOf('ms@2.1.3')?.berryChecksumCacheKey).toBe('10c0')
    expect(result.unresolved.map(diagnostic => diagnostic.code))
      .toEqual(['ENRICH_FIELD_FILLED'])
  })

  it('keeps the historical combined TarballSource callable', async () => {
    const graph = parse('__metadata:\n  version: 8\n  cacheKey: 10c0\n', 'yarn-berry-v8')
    const source: TarballSource = {
      async tarball() { return undefined },
      async berryChecksum() { return undefined },
    }

    const result = await refurbish(graph, 'yarn-berry-v8', source)

    expect(result.enriched).toEqual([])
    expect([...result.graph.nodes()]).toEqual([])
  })
})
