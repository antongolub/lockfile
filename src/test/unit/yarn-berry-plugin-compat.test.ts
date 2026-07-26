import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { serializeNodeId } from '../../main/ts/graph.ts'
import type { Packument, PackumentVersion, RegistryAdapter } from '../../main/ts/registry/types.ts'
import {
  materializeYarnBerryPluginCompat,
  supportsYarnBerryPluginCompat,
  yarnBerryPluginCompatRegistry,
} from '../../main/ts/enrich/yarn-berry-plugin-compat.ts'
import {
  yarnBerryBuiltinCompatIdentityOfResolution,
  yarnBerryFseventsCompatResolution,
} from '../../main/ts/recipe/yarn-berry-builtin-compat.ts'
import { parse as parseV8, stringify as stringifyV8 } from '../../main/ts/formats/yarn-berry-v8.ts'
import { enrich } from '../../main/ts/enrich/facade.ts'
import { addEdge, addPackage, graphOf } from './_modify-test-utils.ts'

const target = { format: 'yarn-berry-v8', managerVersion: '4.13.0' } as const

function seed() {
  return graphOf(builder => {
    const root = addPackage(builder, { name: 'root', version: '1.0.0', workspacePath: '' })
    const fsevents = addPackage(builder, {
      name: 'fsevents',
      version: '2.3.3',
      os: ['darwin'],
      integrity: 'sha512-ZnNldmVudHM=',
    })
    const nodeGyp = addPackage(builder, { name: 'node-gyp', version: '11.5.0' })
    addEdge(builder, root, fsevents, 'optional', 'npm:^2.3.3')
    addEdge(builder, fsevents, nodeGyp, 'dep', 'npm:latest')
  })
}

describe('Yarn Berry plugin-compat profile', () => {
  it('is keyed by pinned manager era, never by lockfile version alone', () => {
    expect(supportsYarnBerryPluginCompat(target)).toBe(true)
    expect(supportsYarnBerryPluginCompat({
      format: 'yarn-berry-v9',
      managerVersion: '4.14.1',
    })).toBe(true)
    expect(supportsYarnBerryPluginCompat({
      format: 'yarn-berry-v8',
      managerVersion: '4.12.0',
    })).toBe(false)
    expect(supportsYarnBerryPluginCompat({
      format: 'yarn-berry-v9',
      managerVersion: '4.13.0',
    })).toBe(false)
    expect(supportsYarnBerryPluginCompat({ format: 'yarn-berry-v8' })).toBe(false)
  })

})

describe('Yarn Berry plugin-compat registry view', () => {
  it('projects only fsevents@2.3.3 and keeps non-fsevents digest stable ×8', async () => {
    const fsevents: PackumentVersion = {
      name: 'fsevents',
      version: '2.3.3',
      dependencies: { existing: '^1.0.0' },
    }
    const ordinary: Packument = {
      name: 'ordinary',
      distTags: { latest: '1.0.0' },
      versions: { '1.0.0': { name: 'ordinary', version: '1.0.0' } },
    }
    const adapter: RegistryAdapter = {
      async packument(name) {
        if (name === 'fsevents') {
          return { name, distTags: { latest: '2.3.3' }, versions: { '2.3.3': fsevents } }
        }
        return name === 'ordinary' ? ordinary : undefined
      },
      async resolve(name) {
        return name === 'fsevents' ? fsevents : ordinary.versions['1.0.0']
      },
    }
    const view = yarnBerryPluginCompatRegistry(adapter, target)
    const projected = await view.resolve('fsevents', '^2.3.3')
    expect(projected?.dependencies).toEqual({
      existing: '^1.0.0',
      'node-gyp': 'npm:latest',
    })
    expect(fsevents.dependencies).toEqual({ existing: '^1.0.0' })
    expect(Object.isFrozen(projected)).toBe(true)
    expect(Object.isFrozen(projected?.dependencies)).toBe(true)

    const digest = (value: unknown): string =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex')
    const expected = digest(ordinary)
    for (let index = 0; index < 8; index++) {
      const observed = await view.packument('ordinary')
      expect(observed).toBe(ordinary)
      expect(digest(observed)).toBe(expected)
    }
  })
})

describe('Yarn Berry plugin-compat materializer', () => {
  it('creates the base/patch pair, rewires consumers, stays bare, and round-trips identity', () => {
    const graph = seed()
    const result = materializeYarnBerryPluginCompat(graph, target)
    const identity = yarnBerryBuiltinCompatIdentityOfResolution(
      yarnBerryFseventsCompatResolution(),
    )!
    const baseId = 'fsevents@2.3.3'
    const patchId = serializeNodeId('fsevents', '2.3.3', [], identity.patch)

    expect(result.added).toEqual([patchId])
    expect(result.graph.getNode(baseId)).toBeDefined()
    expect(result.graph.getNode(patchId)?.patch).toBe(identity.patch)
    expect(identity.patch).not.toBe('df0bf1')
    expect(result.graph.in(baseId)).toEqual([])
    expect(result.graph.in(patchId).map(edge => edge.src)).toEqual(['root@1.0.0'])
    expect(result.graph.out(baseId).map(edge => result.graph.getNode(edge.dst)?.name))
      .toContain('node-gyp')
    expect(result.graph.out(patchId).map(edge => result.graph.getNode(edge.dst)?.name))
      .toContain('node-gyp')
    expect(result.graph.tarballOf(baseId)?.integrity).toBeDefined()
    expect(result.graph.tarballOf(patchId)?.integrity).toBeUndefined()
    expect(result.graph.tarballOf(patchId)?.berryChecksumCacheKey).toBeUndefined()
    expect(result.graph.tarballOf(patchId)?.os).toEqual(['darwin'])

    const lock = stringifyV8(result.graph)
    expect(lock).toContain(
      '"fsevents@patch:fsevents@npm%3A^2.3.3#optional!builtin<compat/fsevents>":',
    )
    expect(lock).toContain(`resolution: "${yarnBerryFseventsCompatResolution()}"`)
    expect(lock).toContain('node-gyp: "npm:latest"')
    const reparsed = parseV8(lock)
    expect(reparsed.getNode(patchId)?.patch).toBe(identity.patch)
    expect(reparsed.getNode(baseId)).toBeDefined()
    expect(reparsed.out(baseId).map(edge => reparsed.getNode(edge.dst)?.name))
      .toContain('node-gyp')

    const second = materializeYarnBerryPluginCompat(result.graph, target)
    expect(second.graph).toBe(result.graph)
    expect(second.added).toEqual([])
  })

  it('fails closed when completion did not resolve node-gyp', () => {
    const graph = graphOf(builder => {
      const root = addPackage(builder, { name: 'root', version: '1.0.0', workspacePath: '' })
      const fsevents = addPackage(builder, {
        name: 'fsevents',
        version: '2.3.3',
        os: ['darwin'],
      })
      addEdge(builder, root, fsevents, 'optional', 'npm:^2.3.3')
    })
    const result = materializeYarnBerryPluginCompat(graph, target)
    expect(result.graph).toBe(graph)
    expect(result.added).toEqual([])
  })

  it('runs around ordinary completion in the enrichment facade', async () => {
    const source = graphOf(builder => {
      const root = addPackage(builder, { name: 'root', version: '1.0.0', workspacePath: '' })
      const fsevents = addPackage(builder, {
        name: 'fsevents',
        version: '2.3.3',
        os: ['darwin'],
      })
      addEdge(builder, root, fsevents, 'optional', 'npm:^2.3.3')
    })
    const input = parseV8(stringifyV8(source))
    const fsevents: PackumentVersion = {
      name: 'fsevents',
      version: '2.3.3',
      os: ['darwin'],
    }
    const nodeGyp: PackumentVersion = { name: 'node-gyp', version: '11.5.0' }
    const packs: Record<string, Packument> = {
      fsevents: {
        name: 'fsevents',
        distTags: { latest: '2.3.3' },
        versions: { '2.3.3': fsevents },
      },
      'node-gyp': {
        name: 'node-gyp',
        distTags: { latest: '11.5.0' },
        versions: { '11.5.0': nodeGyp },
      },
    }
    const registry: RegistryAdapter = {
      async packument(name) {
        return packs[name]
      },
      async resolve(name, range) {
        if (name === 'node-gyp' && range === 'npm:latest') return nodeGyp
        return undefined
      },
    }
    const result = await enrich(input, {
      manifests: {
        '': {
          name: 'root',
          version: '1.0.0',
          optionalDependencies: { fsevents: '^2.3.3' },
          overrides: [],
        },
      },
      registry,
    }, {
      target,
      contract: 'snapshot',
    })
    const identity = yarnBerryBuiltinCompatIdentityOfResolution(
      yarnBerryFseventsCompatResolution(),
    )!
    const patchId = serializeNodeId('fsevents', '2.3.3', [], identity.patch)
    expect(result.graph.getNode('node-gyp@11.5.0')).toBeDefined()
    expect(result.graph.getNode(patchId)).toBeDefined()
    expect(result.graph.out('fsevents@2.3.3').some(edge => edge.dst === 'node-gyp@11.5.0')).toBe(true)
    expect(result.graph.out(patchId).some(edge => edge.dst === 'node-gyp@11.5.0')).toBe(true)
    expect(stringifyV8(result.graph).match(/  conditions: os=darwin/g)?.length).toBe(2)
  })
})
