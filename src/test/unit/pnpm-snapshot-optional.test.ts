import { describe, expect, it } from 'vitest'
import { parse, stringify } from '../../main/ts/api/format-api.ts'

// `optional` is captured from the generation's AUTHORITATIVE resolved-tree
// entry: `snapshots[key]` on v9, `packages[key]` on v6. It is not derivable
// from the platform gates, and it is not carried on the v9 `packages[bareKey]`
// metadata baseline.

const V9_WITH_OPTIONAL = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    optionalDependencies:
      gated:
        specifier: 1.0.0
        version: 1.0.0

packages:

  gated@1.0.0:
    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}
    cpu: [arm64]
    os: [android]

snapshots:

  gated@1.0.0:
    optional: true
`

const V9_WITHOUT_OPTIONAL = V9_WITH_OPTIONAL.replace('\n    optional: true\n', '\n')

const V6_WITH_OPTIONAL = `lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

dependencies:
  gated:
    specifier: 1.0.0
    version: 1.0.0

packages:

  /gated@1.0.0:
    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}
    cpu: [arm64]
    os: [android]
    requiresBuild: true
    dev: false
    optional: true
`

const V6_WITHOUT_OPTIONAL = V6_WITH_OPTIONAL.replace('\n    optional: true\n', '\n')

function replay(input: string, format: 'pnpm-v6' | 'pnpm-v9'): string {
  return stringify(parse(input, format), format, { strict: false })
}

describe('buildSnapshotEntry', () => {
  it('replays a source-authored snapshot optional bit', () => {
    const emitted = replay(V9_WITH_OPTIONAL, 'pnpm-v9')
    const snapshots = emitted.slice(emitted.indexOf('\nsnapshots:'))
    expect(snapshots).toContain('optional: true')
  })

  it('leaves the packages metadata baseline free of the bit', () => {
    // v9 keeps `optional` in `snapshots` only; no corpus producer writes it
    // into `packages`, so emitting it in both would fabricate a key.
    const emitted = replay(V9_WITH_OPTIONAL, 'pnpm-v9')
    const packages = emitted.slice(emitted.indexOf('\npackages:'), emitted.indexOf('\nsnapshots:'))
    expect(packages).not.toContain('optional: true')
  })

  it('does not invent an optional bit the source never carried', () => {
    expect(replay(V9_WITHOUT_OPTIONAL, 'pnpm-v9')).not.toContain('optional: true')
  })

  it('keeps the platform gates independent of the optional bit', () => {
    // The gates say the package is ineligible here; they never imply the bit.
    const emitted = replay(V9_WITHOUT_OPTIONAL, 'pnpm-v9')
    expect(emitted).toContain('os:')
    expect(emitted).toContain('cpu:')
    expect(emitted).not.toContain('optional: true')
  })
})

describe('buildPackageEntry', () => {
  it('replays a source-authored inline optional bit', () => {
    expect(replay(V6_WITH_OPTIONAL, 'pnpm-v6')).toContain('optional: true')
  })

  it('does not invent an inline optional bit the source never carried', () => {
    expect(replay(V6_WITHOUT_OPTIONAL, 'pnpm-v6')).not.toContain('optional: true')
  })
})
