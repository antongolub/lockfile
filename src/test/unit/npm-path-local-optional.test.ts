import { describe, expect, it } from 'vitest'

import { adapterStateSubjects } from '../../main/ts/formats/_npm-core.ts'
import { parse, stringify } from '../../main/ts/formats/npm-3.ts'

const leftPath = 'node_modules/left-parent/node_modules/shared'
const rightPath = 'node_modules/right-parent/node_modules/shared'

function lockWithOptionalAt(...optionalPaths: readonly string[]): string {
  const packages: Record<string, Record<string, unknown>> = {
    '': {
      name: 'npm-path-local-optional',
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
    [leftPath]: { version: '1.0.0' },
    'node_modules/right-parent': {
      version: '1.0.0',
      dependencies: { shared: '1.0.0' },
    },
    [rightPath]: { version: '1.0.0' },
  }
  for (const path of optionalPaths) packages[path]!.optional = true
  return `${JSON.stringify({
    name: 'npm-path-local-optional',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages,
  }, null, 2)}\n`
}

function replayOptionalPaths(source: string): readonly string[] {
  const replay = JSON.parse(stringify(parse(source))) as {
    packages: Record<string, { optional?: boolean }>
  }
  return [leftPath, rightPath].filter(path => replay.packages[path]?.optional === true)
}

describe('npm package-entry optional is install-path-local', () => {
  it('does not fabricate optional when neither install path carries it', () => {
    expect(replayOptionalPaths(lockWithOptionalAt())).toEqual([])
  })

  it('retains optional when both install paths carry it', () => {
    expect(replayOptionalPaths(lockWithOptionalAt(leftPath, rightPath)))
      .toEqual([leftPath, rightPath])
  })

  it('preserves optional only on the left path of one collapsed package identity', () => {
    expect(replayOptionalPaths(lockWithOptionalAt(leftPath))).toEqual([leftPath])
  })

  it('preserves optional only on the right path of one collapsed package identity', () => {
    expect(replayOptionalPaths(lockWithOptionalAt(rightPath))).toEqual([rightPath])
  })

  it('names the exact path-local carrier for strict loss accounting', () => {
    expect(adapterStateSubjects(parse(lockWithOptionalAt(leftPath))))
      .toEqual([`package-entry:${leftPath}:optional`])
  })

})
