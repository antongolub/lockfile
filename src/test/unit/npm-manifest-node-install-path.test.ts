import { expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/api/format-api.ts'

function replay(lock: Record<string, unknown>, format: 'npm-2' | 'npm-3'): Record<string, any> {
  return JSON.parse(stringify(parse(`${JSON.stringify(lock, null, 2)}\n`, format), format, { strict: false }))
}

const installed = {
  version: '1.0.0',
  resolved: 'https://registry.npmjs.org/tool/-/tool-1.0.0.tgz',
  integrity: 'sha512-eW91dA==',
}

it('retains an installed placement that collapses onto the root manifest node', () => {
  const lock = {
    name: 'tool', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'tool', version: '1.0.0', dependencies: { tool: '1.0.0' } },
      'node_modules/tool': installed,
    },
  }
  expect(replay(lock, 'npm-3').packages['node_modules/tool']).toEqual(installed)
})

it('retains an installed placement that collapses onto a workspace manifest node', () => {
  const lock = {
    name: 'project', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'project', version: '1.0.0', workspaces: ['apps/*', 'packages/*'] },
      'apps/app': { name: 'app', version: '1.0.0', dependencies: { tool: '1.0.0' } },
      'packages/tool': { name: 'tool', version: '1.0.0' },
      'apps/app/node_modules/tool': installed,
    },
  }
  expect(replay(lock, 'npm-3').packages['apps/app/node_modules/tool']).toEqual(installed)
})

it('does not fabricate root or workspace installed placements absent from source', () => {
  const rootOnly = {
    name: 'tool', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'tool', version: '1.0.0' } },
  }
  expect(replay(rootOnly, 'npm-3').packages['node_modules/tool']).toBeUndefined()

  const unlinkedWorkspace = {
    name: 'project', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'project', version: '1.0.0', workspaces: ['packages/*'] },
      'packages/tool': { name: 'tool', version: '1.0.0' },
    },
  }
  expect(replay(unlinkedWorkspace, 'npm-3').packages['node_modules/tool']).toBeUndefined()
})
