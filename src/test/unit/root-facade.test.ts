import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  completeTransitives,
  defaultFetch,
  engines,
  license,
  liveRegistry,
  pruneOrphans,
  refurbish,
  registryPackages,
  replaceVersion,
  resolveRegistry,
  selectConstrained,
  type Condition,
  type ConditionContext,
  type Ecosystem,
  type Limiter,
  type RegistryAdapter,
  type RegistryConfig,
} from '../../main/ts/index.ts'
import { completeTransitives as completeTransitivesAuthority } from '../../main/ts/complete/tree-complete.ts'
import {
  engines as enginesAuthority,
  license as licenseAuthority,
  selectConstrained as selectConstrainedAuthority,
} from '../../main/ts/complete/constraints.ts'
import { refurbish as refurbishAuthority } from '../../main/ts/enrich/refurbish.ts'
import { replaceVersion as replaceVersionAuthority } from '../../main/ts/modify/replace-version.ts'
import { pruneOrphans as pruneOrphansAuthority } from '../../main/ts/optimize/prune.ts'
import { registryPackages as registryPackagesAuthority } from '../../main/ts/optimize/registry-packages.ts'
import { resolveRegistry as resolveRegistryAuthority } from '../../main/ts/registry/config.ts'
import { fetch as defaultFetchAuthority } from 'node-fetch-native'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const downstreamFloor = [
  ['completeTransitives', completeTransitives, completeTransitivesAuthority],
  ['defaultFetch', defaultFetch, defaultFetchAuthority],
  ['engines', engines, enginesAuthority],
  ['license', license, licenseAuthority],
  ['pruneOrphans', pruneOrphans, pruneOrphansAuthority],
  ['refurbish', refurbish, refurbishAuthority],
  ['registryPackages', registryPackages, registryPackagesAuthority],
  ['replaceVersion', replaceVersion, replaceVersionAuthority],
  ['resolveRegistry', resolveRegistry, resolveRegistryAuthority],
  ['selectConstrained', selectConstrained, selectConstrainedAuthority],
] as const

describe('root facade — downstream floor', () => {
  it.each(downstreamFloor)(
    'exports %s as the owning subpath value, without a wrapper',
    (_name, rootValue, authority) => {
      expect(rootValue).toBe(authority)
    },
  )

  it('lets an external condition share an external limiter and registry through root types', async () => {
    const limiter: Limiter = task => task()
    const adapter: RegistryAdapter = {
      async packument(name) {
        return {
          name,
          distTags: {},
          versions: {
            '1.0.0': { name, version: '1.0.0' },
          },
        }
      },
      async resolve(name) {
        return { name, version: '1.0.0' }
      },
      limit: limiter,
    }
    const contexts: ConditionContext[] = []
    const condition: Condition = {
      kind: 'external-root-condition',
      evaluate(context) {
        contexts.push(context)
        return { ok: true }
      },
    }

    const result = await selectConstrained(
      adapter,
      'pkg',
      '1.0.0',
      [condition],
      'reject',
    )

    expect(result.selected).toMatchObject({ name: 'pkg', version: '1.0.0' })
    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.registry).toBe(adapter)
    expect(contexts[0]?.registry.limit).toBe(limiter)
  })

  it('lets root registry types configure routing and injectable transport without network access', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'lockgraph-root-facade-'))
    temporaryRoots.push(root)
    const ecosystem: Ecosystem = 'npm'
    const config: RegistryConfig = resolveRegistry(root, {
      ecosystem,
      env: {},
      home: root,
    })
    const limiter: Limiter = task => task()
    const wrappedFetch: typeof fetch = (...args) => defaultFetch(...args)
    const adapter = liveRegistry({ fetch: wrappedFetch, limit: limiter })

    expect(config.registryFor('pkg')).toBe('https://registry.npmjs.org')
    expect(config.authHeaderFor('https://registry.npmjs.org')).toBeUndefined()
    expect(adapter.limit).toBe(limiter)
    expect(adapter.artifactRoute('pkg')?.fetch).toBe(wrappedFetch)
  })
})
