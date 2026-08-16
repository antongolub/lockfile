import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/api/format-api.ts'
import { fixture } from './_pnpm-flat-test-utils.ts'

function withRequiresBuild(source: string): string {
  return source.replace(
    '    dev: false',
    '    requiresBuild: true\n    dev: false',
  )
}

function replay(source: string, format: 'pnpm-v5' | 'pnpm-v6' | 'pnpm-v9'): string {
  return stringify(parse(source, format), format, { strict: false })
}

describe('pnpm requiresBuild carrier', () => {
  it('preserves a v5.4 packages-entry requiresBuild bit', () => {
    const source = withRequiresBuild(fixture('simple/pnpm-v5.lock'))
    expect(replay(source, 'pnpm-v5')).toContain('requiresBuild: true')
  })

  it('preserves a v6 packages-entry requiresBuild bit', () => {
    const source = withRequiresBuild(fixture('simple/pnpm-v6.lock'))
    expect(replay(source, 'pnpm-v6')).toContain('requiresBuild: true')
  })

  it('does not fabricate requiresBuild when a v5.4/v6 source entry omits it', () => {
    for (const [format, path] of [
      ['pnpm-v5', 'simple/pnpm-v5.lock'],
      ['pnpm-v6', 'simple/pnpm-v6.lock'],
    ] as const) {
      const source = fixture(path)
      expect(source).not.toContain('requiresBuild:')
      expect(replay(source, format)).not.toContain('requiresBuild:')
    }
  })

  it('does not fabricate a requiresBuild carrier in v9 packages or snapshots', () => {
    const source = fixture('simple/pnpm-v9.lock')
    expect(source).not.toContain('requiresBuild:')
    expect(replay(source, 'pnpm-v9')).not.toContain('requiresBuild:')
  })
})
