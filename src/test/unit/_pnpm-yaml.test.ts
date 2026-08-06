import { describe, expect, it } from 'vitest'

import {
  readYaml,
  emitYaml,
  flowMap,
  quoted,
} from '../../main/ts/formats/_pnpm-yaml.ts'

describe('readYaml', () => {
  it('reads a block scalar (`key: |`) as an empty string and skips its body lines', () => {
    // The literal-block body is consumed but not preserved — the value collapses to ''.
    const y = readYaml('key: |\n  line one\n  line two\nother: 5\n')
    // A bare decimal token is a YAML number; only a quoted one is a string.
    expect(y).toEqual({ key: '', other: 5 })
  })

  it('reads a folded block scalar (`key: >`) the same way (empty string, body skipped)', () => {
    const y = readYaml('folded: >\n  wrapped text here\nnext: tail\n')
    expect(y).toEqual({ folded: '', next: 'tail' })
  })

  it('strips a trailing ` # comment` from an inline scalar value', () => {
    const y = readYaml('key: value # a trailing comment\n')
    expect(y).toEqual({ key: 'value' })
  })

  it('keeps a `#` that is inside a quoted scalar (not treated as a comment)', () => {
    const y = readYaml(`key: 'a # b'\n`)
    expect(y).toEqual({ key: 'a # b' })
  })

  it('parses a flow item that has no colon by dropping it', () => {
    // A flow map whose second item lacks a `:` is skipped; the valid one survives.
    const y = readYaml('m: {a: 1, bogus}\n')
    expect(y).toEqual({ m: { a: 1 } })
  })

  it('reads an explicit key (`? <key>` / `: <value>`) whose value mapping starts on the `:` line', () => {
    // The shape pnpm's emitter produces: the value mapping's FIRST entry rides
    // the `:` line, the remaining entries sit at the value's own indent.
    const y = readYaml(
      'snapshots:\n' +
        "  ? 'pkg@1.0.0(peer@2.0.0)'\n" +
        '  : dependencies:\n' +
        '      left-pad: 1.3.0\n' +
        '    optionalDependencies:\n' +
        '      fsevents: 2.3.3\n',
    )
    expect(y).toEqual({
      snapshots: {
        'pkg@1.0.0(peer@2.0.0)': {
          dependencies: { 'left-pad': '1.3.0' },
          optionalDependencies: { fsevents: '2.3.3' },
        },
      },
    })
  })

  it('reads an explicit key whose value block starts on the line after `:`', () => {
    const y = readYaml('m:\n  ? long-key\n  :\n    a: 1\n')
    expect(y).toEqual({ m: { 'long-key': { a: 1 } } })
  })

  it('reads an explicit key with an inline empty-map value (`: {}`)', () => {
    const y = readYaml("m:\n  ? 'pkg@1.0.0'\n  : {}\n  after: tail\n")
    expect(y).toEqual({ m: { 'pkg@1.0.0': {}, after: 'tail' } })
  })

  it('keeps siblings after an explicit-key entry at the same indent', () => {
    const y = readYaml(
      'm:\n' +
        "  before: 1\n" +
        "  ? 'pkg@1.0.0'\n" +
        '  : dependencies:\n' +
        '      left-pad: 1.3.0\n' +
        '  after: 2\n',
    )
    expect(Object.keys(y.m as Record<string, unknown>)).toEqual(['before', 'pkg@1.0.0', 'after'])
  })

  it('flattens `---`-separated documents into one map, last document winning per top-level key', () => {
    // Multi-document locks exist in the wild (withastro/astro ships two). The
    // reader has no document concept: a `---` line carries no key colon and is
    // skipped, so later documents overwrite earlier top-level keys. Pinned as a
    // regression guard for the entry loop, not endorsed as document support.
    const y = readYaml('---\na: 1\nm:\n  x: first\n---\nb: 2\nm:\n  y: second\n')
    expect(y).toEqual({ a: 1, b: 2, m: { y: 'second' } })
  })

  it('reads an explicit key longer than YAML\'s 1024-character implicit-key limit verbatim', () => {
    const key = `pkg@1.0.0(${'x'.repeat(1100)})`
    const y = readYaml(`snapshots:\n  ? '${key}'\n  : dependencies:\n      left-pad: 1.3.0\n`)
    expect(Object.keys(y.snapshots as Record<string, unknown>)).toEqual([key])
  })
})

describe('emitYaml', () => {
  it('emits a top-level flow map, array, empty array, boolean and quoted scalar', () => {
    const out = emitYaml(
      { fm: flowMap({ a: '1', b: '2' }), arr: ['x', 'y'], empt: [], flag: true, q: quoted('9.0') },
      { topLevelOrder: ['fm', 'arr', 'empt', 'flag', 'q'] },
    )
    expect(out).toBe(
      // The map was built with STRINGS, so they emit quoted — a numeric-looking
      // string must not come back as a number.
      'fm: {a: \'1\', b: \'2\'}\n\narr:\n- x\n- y\n\nempt: []\n\nflag: true\n\nq: \'9.0\'\n',
    )
  })

  it('emits nested block-map values: null, quoted, empty array, nested object, empty flow map', () => {
    const out = emitYaml(
      { parent: { nul: null, q: quoted("x'y"), arr: [], nested: { deep: 'v' }, fm: flowMap({}) } },
      { topLevelOrder: ['parent'] },
    )
    expect(out).toBe(
      'parent:\n' +
        '  nul:\n' +
        "  q: 'x''y'\n" +
        '  arr: []\n' +
        '  nested:\n' +
        '    deep: v\n' +
        '  fm: {}\n',
    )
  })

  it('quotes a scalar carrying `: `, which a plain scalar may not contain', () => {
    // pnpm writes `specifier: 'workspace: *'`; emitting it bare makes pnpm
    // reject the whole file with ERR_PNPM_BROKEN_LOCKFILE (verified on
    // pnpm 9.15.9: "bad indentation of a mapping entry").
    const out = emitYaml({ parent: { specifier: 'workspace: *' } }, { topLevelOrder: ['parent'] })
    expect(out).toBe("parent:\n  specifier: 'workspace: *'\n")
  })

  it('quotes a scalar ending in `:` and leaves an interior `:` bare', () => {
    const out = emitYaml(
      { parent: { trailing: 'workspace:', interior: 'link:packages/a' } },
      { topLevelOrder: ['parent'] },
    )
    expect(out).toBe("parent:\n  trailing: 'workspace:'\n  interior: link:packages/a\n")
  })

  it('emits a flow map whose values are a nested object and an array (recursion)', () => {
    const out = emitYaml(
      { r: flowMap({ inner: { a: 'b' } as unknown, list: ['p', 'q'] as unknown } as Record<string, unknown>) },
      { topLevelOrder: ['r'] },
    )
    expect(out).toBe('r: {inner: {a: b}, list: [p, q]}\n')
  })

  it('emits a key longer than 1024 emitted characters in explicit (`? ` / `: `) form', () => {
    const key = `pkg@1.0.0(${'x'.repeat(1100)})`
    const out = emitYaml(
      { snapshots: { [key]: { dependencies: { 'left-pad': '1.3.0' }, optionalDependencies: { fsevents: '2.3.3' } } } },
      { topLevelOrder: ['snapshots'] },
    )
    expect(out).toBe(
      'snapshots:\n' +
        `  ? ${key}\n` +
        '  : dependencies:\n' +
        '      left-pad: 1.3.0\n' +
        '    optionalDependencies:\n' +
        '      fsevents: 2.3.3\n',
    )
  })

  it('emits a key of exactly 1024 emitted characters in ordinary implicit form', () => {
    // YAML 1.2 caps an IMPLICIT key at 1024 characters; only a longer one needs
    // the explicit form, so the boundary itself must stay implicit.
    const key = 'k'.repeat(1024)
    const out = emitYaml({ m: { [key]: { a: 'b' } } }, { topLevelOrder: ['m'] })
    expect(out).toBe(`m:\n  ${key}:\n    a: b\n`)
  })

  it('emits an over-long key whose value is an empty map inline after `: `', () => {
    const key = 'k'.repeat(1025)
    const out = emitYaml({ m: { [key]: {} } }, { topLevelOrder: ['m'] })
    expect(out).toBe(`m:\n  ? ${key}\n  : {}\n`)
  })

  it('quotes an over-long key that needs quoting, and counts the quotes toward the limit', () => {
    // `'` + 1023 chars + `'` = 1025 emitted characters — over the limit only
    // because of the quotes the `@` lead forces.
    const key = `@${'k'.repeat(1022)}`
    const out = emitYaml({ m: { [key]: { a: 'b' } } }, { topLevelOrder: ['m'] })
    expect(out).toBe(`m:\n  ? '${key}'\n  : a: b\n`)
  })

  it('round-trips an explicit-key entry through emit → read unchanged', () => {
    const key = `pkg@1.0.0(${'x'.repeat(1100)})`
    const tree = { snapshots: { [key]: { dependencies: { 'left-pad': '1.3.0' } } } }
    expect(readYaml(emitYaml(tree, { topLevelOrder: ['snapshots'] }))).toEqual(tree)
  })
})
