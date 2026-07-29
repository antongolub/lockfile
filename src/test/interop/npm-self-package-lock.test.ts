import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parse } from '../../main/ts/formats/npm-3.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(here, '../../..')

describe('interop: repository package-lock', () => {
  it('parses the npm-3 lock and preserves @isaacs/cliui alias identities', () => {
    const input = readFileSync(resolve(repositoryRoot, 'package-lock.json'), 'utf8')
    const graph = parse(input)
    const aliases = graph
      .out('@isaacs/cliui@8.0.2', 'dep')
      .flatMap(edge => edge.attrs?.alias === undefined ? [] : [edge.attrs.alias])
      .sort()

    expect(aliases).toEqual([
      'string-width-cjs',
      'strip-ansi-cjs',
      'wrap-ansi-cjs',
    ])
  })
})
