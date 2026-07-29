import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/index.ts'

const ROOTLESS_CLASSIC = `# yarn lockfile v1
node-sass@^9.0.0:
  version "9.0.0"
  resolved "https://registry.npmjs.org/node-sass/-/node-sass-9.0.0.tgz"
  integrity sha512-yltEuuLrfH6M7fhxe80zKbXg9I9QKpYJKV8sR4EuOZdUMR7WQxO8TqjrQFHND7mJdnhyG2YV9lZPZKZ8aX9nNw==
`

const TARGETS = [
  'npm-1',
  'npm-2',
  'npm-3',
  'npm-4',
  'bun-text',
  'pnpm-v5',
  'pnpm-v6',
  'pnpm-v9',
] as const

const NODE_ID = 'node-sass@9.0.0'

describe('project-root authority', () => {
  for (const target of TARGETS) {
    it(`${target} does not promote a sole DAG root into the project root`, () => {
      const source = parse(ROOTLESS_CLASSIC, 'yarn-classic')
      const sourceTarball = source.tarballOf(NODE_ID)
      const output = stringify(source, target, { strict: false })
      const reparsed = parse(output, target)

      expect(source.getNode(NODE_ID)?.workspacePath).toBeUndefined()
      expect(reparsed.getNode(NODE_ID)).toBeDefined()
      expect(reparsed.getNode(NODE_ID)?.workspacePath).toBeUndefined()
      expect(reparsed.tarballOf(NODE_ID)?.integrity).toEqual(sourceTarball?.integrity)

      if (target !== 'bun-text') {
        expect(reparsed.tarballOf(NODE_ID)?.resolution).toEqual(sourceTarball?.resolution)
      }
    })
  }
})
