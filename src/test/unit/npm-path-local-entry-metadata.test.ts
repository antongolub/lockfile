import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  adapterStateSubjects,
  rebindAdapterState,
} from '../../main/ts/formats/_npm-core.ts'
import { parse, stringify } from '../../main/ts/formats/npm-3.ts'
import { sri } from '../_integrity-fixtures.ts'

const leftPath = 'node_modules/left-parent/node_modules/shared'
const rightPath = 'node_modules/right-parent/node_modules/shared'
const oldResolved = 'https://registry.npmjs.org/shared/-/shared-1.0.0.tgz'
const newResolved = 'https://mirror.example.test/shared/-/shared-1.0.0.tgz'
const digest = (algorithm: 'sha1' | 'sha512', value: string): string =>
  `${algorithm}-${createHash(algorithm).update(value).digest('base64')}`
const oldIntegrity = digest('sha512', 'left')
const newIntegrity = digest('sha512', 'new-canonical')
const workspacePath = 'packages/workspace-with-native-metadata'
const cleanWorkspacePath = 'packages/workspace-without-native-metadata'

const leftEntry = {
  version: '1.0.0',
  resolved: oldResolved,
  integrity: oldIntegrity,
  license: 'MIT',
  dev: true,
  peer: true,
  inBundle: true,
  engines: { node: '>=18' },
  futurePathField: { owner: 'left', values: [1, 2] },
}

const rightEntry = {
  version: '1.0.0',
  resolved: 'https://registry.yarnpkg.com/shared/-/shared-1.0.0.tgz',
  integrity: digest('sha1', 'right'),
  license: 'ISC',
  engines: { node: '>=18' },
  futurePathField: { owner: 'right', values: [3] },
}

function source(): string {
  return `${JSON.stringify({
    name: 'npm-path-local-entry-metadata',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'npm-path-local-entry-metadata',
        version: '1.0.0',
        dependencies: {
          'left-parent': '1.0.0',
          'right-parent': '1.0.0',
        },
      },
      'node_modules/left-parent': {
        version: '1.0.0',
        dependencies: { shared: '1.0.0' },
      },
      [leftPath]: leftEntry,
      'node_modules/right-parent': {
        version: '1.0.0',
        dependencies: { shared: '1.0.0' },
      },
      [rightPath]: rightEntry,
    },
  }, null, 2)}\n`
}

function replay(graph = parse(source())): Record<string, Record<string, unknown>> {
  return (JSON.parse(stringify(graph)) as {
    packages: Record<string, Record<string, unknown>>
  }).packages
}

function workspaceSource(): string {
  return `${JSON.stringify({
    name: 'npm-workspace-entry-metadata',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'npm-workspace-entry-metadata',
        version: '1.0.0',
        workspaces: ['packages/*'],
        rootFutureField: { carrier: 'root-meta-only' },
      },
      [workspacePath]: {
        name: '@fixture/native-metadata',
        version: '1.0.0',
        engines: ['node >=18'],
        hasInstallScript: true,
        extraneous: true,
        futureWorkspaceField: { carrier: 'workspace-path' },
      },
      [cleanWorkspacePath]: {
        name: '@fixture/clean-workspace',
        version: '1.0.0',
      },
    },
  }, null, 2)}\n`
}

function replayWorkspace(graph = parse(workspaceSource())): Record<string, Record<string, unknown>> {
  return (JSON.parse(stringify(graph)) as {
    packages: Record<string, Record<string, unknown>>
  }).packages
}

describe('npm package-entry metadata is install-path-local', () => {
  it('replays each whole source entry at its exact install path', () => {
    const packages = replay()
    expect(packages[leftPath]).toEqual(leftEntry)
    expect(packages[rightPath]).toEqual(rightEntry)
  })

  it('derives strict subjects from native keys, including unknown future metadata', () => {
    const subjects = adapterStateSubjects(parse(source()))
    expect(subjects).toContain(`package-entry:${leftPath}:futurePathField`)
    expect(subjects).toContain(`package-entry:${rightPath}:futurePathField`)
    expect(subjects).toContain(`package-entry:${leftPath}:dev`)
    expect(subjects).toContain(`package-entry:${leftPath}:peer`)
    expect(subjects).toContain(`package-entry:${leftPath}:inBundle`)
    expect(subjects).not.toContain(`package-entry:${leftPath}:version`)
    expect(subjects).not.toContain(`package-entry:${rightPath}:version`)
  })

  it('lets a same-NodeId tarball mutation replace stale native integrity and resolved values', () => {
    const graph = parse(source())
    const current = graph.tarballOf('shared@1.0.0')!
    const mutated = graph.mutate(mutator => {
      mutator.setTarball({ name: 'shared', version: '1.0.0' }, {
        ...current,
        integrity: sri(newIntegrity),
        nativeResolution: newResolved,
        resolution: { type: 'tarball', url: newResolved },
      })
    }).graph
    const rebound = rebindAdapterState(graph, mutated).graph

    for (const path of [leftPath, rightPath]) {
      expect(replay(rebound)[path]).toMatchObject({
        integrity: newIntegrity,
        resolved: newResolved,
      })
    }
  })

  it('invalidates the old native record when a version bump changes the NodeId', () => {
    const graph = parse(source())
    const current = graph.getNode('shared@1.0.0')!
    const bumpedId = 'shared@1.0.1'
    const bumpedResolved = 'https://registry.npmjs.org/shared/-/shared-1.0.1.tgz'
    const bumpedIntegrity = digest('sha512', 'bumped')
    const mutated = graph.mutate(mutator => {
      mutator.replaceNode(current.id, { ...current, id: bumpedId, version: '1.0.1' })
      mutator.setTarball({ name: 'shared', version: '1.0.1' }, {
        integrity: sri(bumpedIntegrity),
        nativeResolution: bumpedResolved,
        resolution: { type: 'tarball', url: bumpedResolved },
      })
      mutator.removeTarball({ name: 'shared', version: '1.0.0' })
    }).graph
    const rebound = rebindAdapterState(graph, mutated).graph
    const entries = Object.values(replay(rebound))
      .filter(entry => entry.version === '1.0.1')

    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry).toMatchObject({
        integrity: bumpedIntegrity,
        resolved: bumpedResolved,
        version: '1.0.1',
      })
      expect(entry.integrity).not.toBe(oldIntegrity)
      expect(entry.resolved).not.toBe(oldResolved)
    }
  })

  it('replays a whole source-authored workspace entry at its exact bare path', () => {
    expect(replayWorkspace()[workspacePath]).toEqual({
      name: '@fixture/native-metadata',
      version: '1.0.0',
      engines: ['node >=18'],
      hasInstallScript: true,
      extraneous: true,
      futureWorkspaceField: { carrier: 'workspace-path' },
    })
  })

  it('does not fabricate native workspace keys and keeps the root on NpmRootMeta', () => {
    const graph = parse(workspaceSource())
    const packages = replayWorkspace(graph)
    for (const key of ['engines', 'hasInstallScript', 'extraneous', 'futureWorkspaceField']) {
      expect(Object.hasOwn(packages[cleanWorkspacePath]!, key)).toBe(false)
    }
    const subjects = adapterStateSubjects(graph)
    expect(subjects).toContain('root-entry:rootFutureField')
    expect(subjects.some(subject => subject.startsWith('package-entry::'))).toBe(false)
  })

  it('invalidates workspace-native state when the same node moves to another workspacePath', () => {
    const graph = parse(workspaceSource())
    const workspace = graph.getNode('@fixture/native-metadata@1.0.0')!
    const moved = graph.mutate(mutator => {
      mutator.replaceNode(workspace.id, { ...workspace, workspacePath: 'packages/moved' })
    }).graph
    const rebound = rebindAdapterState(graph, moved).graph

    expect(adapterStateSubjects(rebound)
      .filter(subject => subject.startsWith(`package-entry:${workspacePath}:`)))
      .toEqual([])
    expect(replayWorkspace(rebound)['packages/moved']).toEqual({
      name: '@fixture/native-metadata',
      version: '1.0.0',
    })
  })
})
