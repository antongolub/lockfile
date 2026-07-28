# `pnpm-v6` — pnpm `pnpm-lock.yaml` (lockfileVersion 6.x)

> Status: stable (adapter + pnpm-flat round-trip suite; collapsed-root + `@`-id grammar covered).
> Updated: 2026-06-16
> Provenance: **Source-only**.

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| pnpm | `>=7 <9` | ✓ | bumps `6.0`, `6.1` inside this window |

### Readers — PM semvers that *install* from this format

| PM | semver range | Notes |
|----|--------------|-------|
| pnpm | `>=7` | older pnpm cannot read the new `name@ver` package-id grammar |

## File

Same as [pnpm-v5](./pnpm-v5.md#file).

## Sources

- [`pnpm/spec/lockfile/6.0.md`](https://github.com/pnpm/spec/blob/master/lockfile/6.0.md)
  — official schema spec for 6.0; primary evidence for the package-id
  grammar shift (`/foo@1.0.0` instead of `/foo/1.0.0`).
- See also [pnpm-v5 sources](./pnpm-v5.md#sources) for shared
  references (types, lockfile package, migration converters).

## Schema sketch

```yaml
lockfileVersion: '6.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:
  .:
    dependencies:
      foo:
        specifier: ^1.0.0
        version: 1.0.3

packages:
  /foo@1.0.3:                     # NOTE: '@' separator, not '/'
    resolution: { integrity: ... }
```

## Capabilities

Same matrix as [pnpm-v5](./pnpm-v5.md#capabilities). Schema cleanup, not
expressiveness change.

## Integrity

Identical to [pnpm-v5](./pnpm-v5.md#integrity): each `packages` entry carries
`resolution: { integrity: sha512-… }` (`origin: 'sri'`, tarball digest),
parsed/emitted via the shared `_pnpm-flat-core.ts` (`parseSri` / `emitSri`)
under the [`_common.md` §3 model](./_common.md#3-integrity-model).

## Conversion inputs

Same as [pnpm-v5](./pnpm-v5.md#conversion-inputs).

## Quirks

Compared to v5:

- Package ids switch from `/<name>/<ver>` to `/<name>@<ver>` (and
  `/<name>@<ver>(peer@x)` for virtualised). Easier to read; trivial to migrate.
- `importers.<path>.dependencies.<name>` is now an object `{specifier, version}`
  instead of a plain version string.
- New top-level `settings` block reflecting `pnpm` config that affects resolution.
- `time` block deprecated.
- A top-level `packageExtensionsChecksum:` scalar (pnpm's frozen-compared digest of
  the effective `packageExtensions` config) is preserved verbatim via the shared
  `_pnpm-flat-core.ts` — see the [pnpm-v9 note](./pnpm-v9.md#packageextensionschecksum-frozen-compare-digest)
  for why dropping it breaks `--frozen-lockfile`. Emitted after `overrides:`.
- A top-level `patchedDependencies:` block (`name@version → {hash, path}`) is likewise
  preserved verbatim via the shared core — see the
  [pnpm-v9 note](./pnpm-v9.md#patcheddependencies-patch-file-declarations). Emitted
  after `packageExtensionsChecksum:`.

## Degradation rules

Same as [pnpm-v5](./pnpm-v5.md#degradation-rules).

For an npm-4 source, the native raw-SRI / path patch carrier is not a pnpm
patch declaration, and npm manifest-extension fingerprints / applied provenance
have no pnpm-v6 carrier. Non-strict conversion reports both losses (while
retaining representable effective graph edges); strict projection rejects.

For yarn-berry-v10 interchange, pnpm-v6 re-encodes peer virtualization but
uses a different workspace identity convention and a tarball-SRI integrity
origin. The calibrated v10 cell records workspace rekeying and tarball payload
loss; the reverse cell records peer-virtual and tarball payload loss. Missing
target integrity is reported and never fabricated.

The complete matrix pins the same directional profile for yarn-berry-v4
through v8: Berry → pnpm-v6 rekeys workspace ids and loses cross-sidecar
tarball metadata; pnpm-v6 → Berry flattens peer-virtual ids, loses tarball
metadata, and synthesizes the destination preamble. The npm-{1,2} cells are
also contract-backed. npm-1 → pnpm-v6 rekeys the root workspace id; the reverse
loses nested-tree edges, peer virtualization, tarball metadata, and patch
slots. npm-2 → pnpm-v6 rekeys workspace ids and loses tarball metadata; the
reverse flattens peer-virtual ids. Integrity remains tarball SRI across
npm/pnpm.

## Fixtures

> **TBD:** generate.

## Open questions

> **Open:** is `settings.autoInstallPeers` resolution-affecting (it changes
> what gets installed)? If yes, parsing without it loses information.

## Unknown top-level extension keys

Pinned pnpm 8.15.9 accepts and byte-preserves producer-extension values at the
project root. The adapter deep-clones such values, replays them only for
`pnpm-v6`, and preserves their source key placement; modeled fields always win
on collision. Detached-state and cross-format losses name every
`top-level:<key>` and strict conversion fails closed.
