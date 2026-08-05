# `yarn-berry-v5` — yarn berry `yarn.lock` (`__metadata.version: 5`)

> Status: preview (adapter + round-trip tested; read-side completion only; frozen certification contract available).
> Updated: 2026-07-13
> Provenance: **Source-only**.
> Frozen certification: `prepareFrozen` / `certifyFrozen`; this schema has no bundled calibrated producer, so certification requires an external native-PM oracle receipt from the exact target manager version.

The version-invariant emit contract — the *Graph-level roundtrip*
property, canonical form, field schedule, SYML quoting, line endings,
and `__metadata.cacheKey` threading — is shared across the yarn-berry
family and lives in [`_common.md` §1](./_common.md#1-yarn-berry-emit-invariants-version-invariant);
this spec inherits it and records only the v5-specific deltas inline.
The completion phases (modify / enrich / optimize) are read-side-only
in this preview (Source-only provenance — no producer yet); those are library
phases rather than properties of this file format, specified outside this
document and not needed to read or write the lock.

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| yarn | `=3.1.0` | ✓ | one-minor window only; yarn 3.0.x still wrote v4, yarn 3.2.0 jumped to v6 |

### Readers — PM semvers that *install* from this format

| PM | semver range | Notes |
|----|--------------|-------|
| yarn | `>=3.1` | |

## File

Same as [yarn-berry-v4](./yarn-berry-v4.md#file).

## Sources

- [`Project.ts` at yarn 3.1.0](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/3.1.0/packages/yarnpkg-core/sources/Project.ts)
  — `const LOCKFILE_VERSION = 5;` (the only stable yarn release with v5
  default).
- [`Project.ts` at yarn 3.0.2 (pre-bump)](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/3.0.2/packages/yarnpkg-core/sources/Project.ts)
  and [3.2.0 (post-bump)](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/3.2.0/packages/yarnpkg-core/sources/Project.ts)
  — bracket the one-minor v5 window.
  — empirical walk that surfaced the narrow window.

## Schema sketch

Same shape as v4 with `conditions` support added, while retaining bare
inner-block dependency ranges and raw sha512-hex `checksum` values (no
`<cacheKey>/` prefix).

## Capabilities

Parse / stringify / graph-level mutate roundtrip / enrich / optimize
implemented against the fixture matrix at
the per-case `yarn-berry-v5` locks.

## Conversion inputs

Same as [yarn-berry-v4](./yarn-berry-v4.md#conversion-inputs).

## Emit

Emit (`stringify(graph, options?)`) is governed by the shared,
version-invariant yarn-berry emit contract in
[`_common.md` §1](./_common.md#1-yarn-berry-emit-invariants-version-invariant)
(canonical form, block ordering, field schedule, the SYML quoting
predicate at [`_common.md` §1.5](./_common.md#15-quoting-the-syml-quoting-predicate),
line endings, and `__metadata.cacheKey` threading) — evaluated against
the v5 fixture set per the acceptance gate at
[`_common.md` §1.9](./_common.md#19-acceptance-gate). The v5-specific
deltas on top of that shared contract are:

- `__metadata.version` emits the literal `5`.
- `__metadata.cacheKey` defaults to absent; when present (caller-supplied
  via `options.cacheKey` or sidecar-preserved from parse) it emits as
  a bare numeric literal (`cacheKey: 8` empirically) — pre-v8 form, no
  string quoting.
- Inner `dependencies` / `optionalDependencies` emit the bare form
  (for example `lodash: 4.17.21`), not v8/v9's quoted protocol. Pinned Yarn
  3.1.1 accepts and write-stabilises a source-authored explicit plain
  `npm:<range>`, so unchanged replay preserves that prefix; a bare manifest
  still mints bare, and mutation/rebind/conversion does not inherit the source
  spelling. Structural `npm:<target>@<range>` aliases are never shortened.
- `checksum` values round-trip whatever was parsed (the integrity model,
  [`_common.md` §3](./_common.md#3-integrity-model)): the current fixtures
  carry a bare sha512 hex (no `<cacheKey>/` prefix) and stay bare, but a
  parsed `<cacheKey>/<hex>` prefix is preserved per-node
  (`TarballPayload.berryChecksumCacheKey`) — same uniform rule as v4 (F1).
- `conditions` are supported and round-trip as a **scalar** token via
  sidecar preservation (emitted bare) — v5 is the FIRST version with
  this field (v4 lacks it).
- `compressionLevel` is not present in the v5 corpus.

## Quirks

- `__metadata.cacheKey` is empirically `8` across the current v5 fixtures.
- Inner `dependencies` / `optionalDependencies` emit bare ranges
  (`lodash: 4.17.21`), unlike v8/v9's quoted protocol form.
- Source-authored explicit plain `npm:<range>` is a same-generation fidelity
  carrier, not the minted default. Pinned Yarn 3.1.1 proves both sides: explicit
  source output is immutable/write-stable, while a bare manifest mints bare.
- `checksum` values are raw sha512 hex, not `cacheKey/hash`.
- `conditions` first appears in v5; it is a **scalar** token (e.g.
  `os=linux`), NOT a nested block. The current shipped fixture set does
  not exercise it, but parse/stringify coverage preserves the scalar
  verbatim (emitted bare) in the adapter contract. (An earlier draft of
  this spec wrongly claimed a nested-block shape; the scalar form is the
  corrected contract.)
- **Conditional-checksum policy — `conditions ∩ optionalBuilds`, version-independent.**
  A `conditions:`-bearing locator is bare iff it stays in `optionalBuilds`: reachable
  only through optional paths **and** not a resolver source. A conditioned locator on a
  required path, or a patch source (`fsevents` is always builtin-patched, so its base
  `npm:` locator is hashed even when every parent edge is optional), carries a checksum
  and enrich fills a fresh one; `@esbuild/*` (exclusively-optional, no patch) stays bare.
  Lock v5 applies yarn's 3.1.x **first-visit** `optionalBuilds` tie-break when a locator
  is reached through both an optional and a required path. See
  [`_common.md` §1.7.2](./_common.md#172-structural-checksum-gaps--entries-yarn-never-hashes).

## Degradation rules

Inherits v4.

For an npm-4 source, the native raw-SRI / path patch carrier is not a
yarn-berry patch locator, and npm manifest-extension fingerprints / applied
provenance have no v5 carrier. Non-strict conversion reports both losses (while
retaining representable effective graph edges); strict projection rejects.

The yarn-berry-v10 pair is graph-lossless across the calibrated corpus:
conditions pass through, `compressionLevel` is producer-faithfully removed,
and the canonical Berry zip digest is re-encoded from v5's raw checksum syntax
to v10's cacheKey-prefixed syntax (and back) without changing checksum bytes.

The complete pair matrix also pins v5 ↔ npm-{1,2} and v5 ↔ pnpm-v{5,6}.
On v5 → npm-1 the nested-tree target loses some edges, canonical resolution
URLs, tarball payload metadata, and patch slots; v5 → npm-2 loses the canonical
resolution URL. The reverse npm-1 path preserves the representable graph and
synthesizes only the v5 preamble, while npm-2 → v5 also loses target tarball
payload metadata. Across pnpm, v5 → pnpm rekeys workspace identities and loses
tarball metadata; pnpm → v5 flattens peer-virtual ids, loses tarball metadata,
and synthesizes the v5 preamble. Cross-origin integrity is omitted rather than
relabelled between tarball SRI and Berry zip checksums.

## Fixtures

Per-case locks and whole-project samples, as described in [Evidence](./README.md#evidence). A claim resting on a real-world lock cites it by upstream identity at the point it is made.

## Open questions

> None at preview. Fixture verification matched the documented deltas on
> all observed points: handshake `5`, cacheKey `8`, bare inner dep
> ranges, raw checksum form, and no `compressionLevel` in the current
> fixture corpus.

## Unknown `__metadata` keys

Pinned Yarn 3.1.1 removes an unrecognised `__metadata` subkey during a mutable
install. The same unstripped lock is rejected by `--immutable`, while the
repaired lock is accepted. Accordingly non-strict emit removes the key and
reports `YARN_BERRY_V5_UNKNOWN_METADATA_DROPPED` with the full
`__metadata.<key>` path; strict emit fails closed. This producer-faithful repair
can improve an input that was already invalid for immutable CI. `version` and
`cacheKey` are the recognized metadata fields; the pinned producer also removes
the legacy-looking `compressionLevel` subkey.
