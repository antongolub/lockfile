import { describe, expect, it } from 'vitest'
import {
  parse,
  stringify,
  type FormatId,
} from '../../main/ts/index.ts'
import {
  parse as parseSyml,
  type SymlMap,
} from '../../main/ts/formats/_yarn-syml.ts'
import { rebindFormatAdapterState } from '../../main/ts/api/format-registry.ts'

type BerryFormat = Extract<FormatId, `yarn-berry-v${number}`>

const BARE_GENERATIONS = [
  ['yarn-berry-v4', 4],
  ['yarn-berry-v5', 5],
  ['yarn-berry-v6', 6],
] as const satisfies readonly (readonly [BerryFormat, number])[]

function berryLock(
  version: number,
  declaration: string,
  value: string,
  target: string,
  targetVersion: string,
  descriptor = `${target}@npm:${targetVersion}`,
): string {
  return `__metadata:\n  version: ${version}\n\n`
    + `"app@workspace:.":\n`
    + `  version: 0.0.0-use.local\n`
    + `  resolution: "app@workspace:."\n`
    + `  dependencies:\n`
    + `    ${declaration}: ${JSON.stringify(value)}\n`
    + `  languageName: unknown\n`
    + `  linkType: soft\n\n`
    + `"${descriptor}":\n`
    + `  version: ${targetVersion}\n`
    + `  resolution: "${target}@npm:${targetVersion}"\n`
    + `  languageName: node\n`
    + `  linkType: hard\n`
}

function isMap(value: unknown): value is SymlMap {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rootDependency(lockfile: string, name: string): string | undefined {
  for (const value of Object.values(parseSyml(lockfile))) {
    if (!isMap(value) || typeof value.resolution !== 'string') continue
    if (!value.resolution.endsWith('@workspace:.')) continue
    const dependencies = value.dependencies
    if (!isMap(dependencies)) return undefined
    const declaration = dependencies[name]
    return typeof declaration === 'string' ? declaration : undefined
  }
  return undefined
}

function replay(format: BerryFormat, input: string): string {
  return stringify(format, parse(format, input), { strict: false })
}

function harmlessMutation(format: BerryFormat, input: string): string {
  const graph = parse(format, input).mutate(mutator => {
    mutator.diagnostic({
      code: 'TEST_MUTATION',
      severity: 'info',
      message: 'detach source-only declaration spelling',
    })
  }).graph
  return stringify(format, graph, { strict: false })
}

describe('Yarn Berry declaration npm: protocol fidelity', () => {
  it('preserves a structural v4 self-alias instead of shortening it as a plain range', () => {
    const input = berryLock(
      4,
      'react-dropzone',
      'npm:react-dropzone@^10.2.2',
      'react-dropzone',
      '10.2.2',
      'react-dropzone@npm:react-dropzone@^10.2.2',
    )
    expect(rootDependency(replay('yarn-berry-v4', input), 'react-dropzone'))
      .toBe('npm:react-dropzone@^10.2.2')
  })

  it.each(BARE_GENERATIONS)(
    '%s preserves source-authored explicit npm: on an otherwise plain range',
    (format, version) => {
      const input = berryLock(version, 'ms', 'npm:2.1.3', 'ms', '2.1.3')
      expect(rootDependency(replay(format, input), 'ms')).toBe('npm:2.1.3')
    },
  )

  it('keeps the already-correct v7 self-alias behavior', () => {
    const input = berryLock(
      7,
      'react-dropzone',
      'npm:react-dropzone@^10.2.2',
      'react-dropzone',
      '10.2.2',
      'react-dropzone@npm:react-dropzone@^10.2.2',
    )
    expect(rootDependency(replay('yarn-berry-v7', input), 'react-dropzone'))
      .toBe('npm:react-dropzone@^10.2.2')
  })

  it('keeps an ordinary renamed alias distinct from a self-alias', () => {
    const input = berryLock(
      4,
      'dropzone-alias',
      'npm:react-dropzone@^10.2.2',
      'react-dropzone',
      '10.2.2',
      'react-dropzone@npm:react-dropzone@^10.2.2',
    )
    expect(rootDependency(replay('yarn-berry-v4', input), 'dropzone-alias'))
      .toBe('npm:react-dropzone@^10.2.2')
  })

  it.each(BARE_GENERATIONS)(
    '%s leaves a source-authored bare plain range bare',
    (format, version) => {
      const input = berryLock(version, 'ms', '2.1.3', 'ms', '2.1.3')
      expect(rootDependency(replay(format, input), 'ms')).toBe('2.1.3')
    },
  )

  it.each(BARE_GENERATIONS)(
    '%s clears source-only explicit spelling across public mutation and rebind',
    (format, version) => {
      const input = berryLock(version, 'ms', 'npm:2.1.3', 'ms', '2.1.3')
      expect(rootDependency(harmlessMutation(format, input), 'ms')).toBe('2.1.3')
      const source = parse(format, input)
      const detached = source.subgraph([...source.roots()])
      const rebound = rebindFormatAdapterState(format, source, detached).graph
      expect(rootDependency(stringify(format, rebound, { strict: false }), 'ms')).toBe('2.1.3')
    },
  )

  it.each(BARE_GENERATIONS)(
    '%s does not inherit explicit-plain spelling from another Berry generation',
    (target, version) => {
      const sourceFormat = target === 'yarn-berry-v6' ? 'yarn-berry-v5' : 'yarn-berry-v6'
      const sourceVersion = sourceFormat === 'yarn-berry-v5' ? 5 : 6
      const source = berryLock(sourceVersion, 'ms', 'npm:2.1.3', 'ms', '2.1.3')
      const output = stringify(target, parse(sourceFormat, source), { strict: false })
      expect(rootDependency(output, 'ms'), `target metadata version ${version}`).toBe('2.1.3')
    },
  )
})
