import { describe, expect, it } from 'vitest'
import { parse } from '../../main/ts/index.ts'

describe('smoke', () => {
  it('resolves the public entry point', () => {
    expect(parse).toBeTypeOf('function')
  })
})
