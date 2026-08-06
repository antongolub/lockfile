import { expect, it } from 'vitest'

import { parse, stringify } from '../../main/ts/api/format-api.ts'

function replay(lock: Record<string, unknown>): Record<string, any> {
  return JSON.parse(stringify(parse(`${JSON.stringify(lock, null, 2)}\n`, 'npm-3'), 'npm-3', { strict: false }))
}

it('retains a source link alias whose target is the root manifest', () => {
  const alias = { resolved: '', link: true }
  const lock = {
    name: 'project', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'project', version: '1.0.0' },
      'node_modules/project-alias': alias,
    },
  }
  expect(replay(lock).packages['node_modules/project-alias']).toEqual(alias)
})

it('retains the authored alias path to a workspace without fabricating its canonical link', () => {
  const alias = { resolved: 'packages/tool', link: true }
  const lock = {
    name: 'project', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'project', version: '1.0.0', workspaces: ['packages/*'] },
      'packages/tool': { name: 'tool', version: '1.0.0' },
      'node_modules/tool-alias': alias,
    },
  }
  const packages = replay(lock).packages
  expect(packages['node_modules/tool-alias']).toEqual(alias)
  expect(packages['node_modules/tool']).toBeUndefined()
})

it('does not fabricate a root link alias absent from source', () => {
  const lock = {
    name: 'project', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'project', version: '1.0.0' } },
  }
  expect(replay(lock).packages['node_modules/project']).toBeUndefined()
})
