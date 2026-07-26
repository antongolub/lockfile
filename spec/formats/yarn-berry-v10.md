# `yarn-berry-v10` — yarn berry `yarn.lock` (`__metadata.version: 10`)

> Status: stable schema target (adapter + round-trip tested; frozen certification contract available; emitted by stable Yarn 4.17.1).
> Updated: 2026-07-26
> Provenance: **Source-only** (Yarn 4.17.1 producer source).
> Frozen certification: `prepareFrozen` / `certifyFrozen`; this schema has no bundled calibrated producer, so certification requires an external native-PM oracle receipt from the exact target manager version.

The completeness contract — stringify, modify, enrich, optimize —
inherits from [yarn-berry-v9](./yarn-berry-v9.md): the shared,
version-invariant yarn-berry emit contract lives in
[`_common.md` §1](./_common.md#1-yarn-berry-emit-invariants-version-invariant),
and the completion phases (modify / enrich / optimize) reference
published [ADR-0023](../decisions/0023-graph-modification-and-completion.md)
(modify / enrich) and [ADR-0024](../decisions/0024-optimize-phase.md)
(optimize). This spec records only the read-side capabilities and the
single on-disk delta from v9 (`__metadata.version: 10`).

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| yarn | `>=4.17.1` | ✓ | stable Yarn 4.17.1 bumped the marker to 10 |

Originally spotted in yarnpkg/berry's self-hosted lockfile and prettier;
stable Yarn 4.17.1 now pins the producer boundary.

### Readers — PM semvers that *install* from this format

| PM | semver range | Notes |
|----|--------------|-------|
| yarn | `>=4.17.1` | older berry refuses; the schema-version handshake is strict |

## File

Same as [yarn-berry-v4](./yarn-berry-v4.md#file).

## Sources

- [`Project.ts` at yarn 4.17.1](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/4.17.1/packages/yarnpkg-core/sources/Project.ts)
  — stable `LOCKFILE_VERSION = 10` constant.
- [`Project.ts` at yarn 4.14.1 (v9 baseline)](https://github.com/yarnpkg/berry/blob/@yarnpkg/cli/4.14.1/packages/yarnpkg-core/sources/Project.ts)
  for diff anchor.

## Conversion inputs

Same as [yarn-berry-v9](./yarn-berry-v9.md#conversion-inputs). The
patch-slot fingerprint recipe (file-backed and `~builtin<…>`),
sentinel input shape, and path-confinement rule carry over verbatim
— v10 inherits v9's rules without re-statement. The workspace
`link:` / `portal:` `::locator=…` locator-disambiguator (sister-session
canary bug #2; see `_yarn-berry-core.ts` `isLinkOrPortalResolution`)
also applies uniformly across v4–v10.

## Emit

Emit (`stringify(graph, options?)`) inherits v9's emit contract
verbatim — the shared, version-invariant yarn-berry emit contract in
[`_common.md` §1](./_common.md#1-yarn-berry-emit-invariants-version-invariant);
see [yarn-berry-v9](./yarn-berry-v9.md#emit). The only on-disk delta
from v9 is the `__metadata.version: 10` field.

## Schema sketch

Identical to v9 in the supported corpus. The bump is mechanical (a
`version: N` field). The family config remains separately owned so a future
v10 structural delta cannot alter v9 identity.

## Capabilities

Inherits v9.

## Quirks

- Brand-new in stable Yarn 4.17.1 — much of the ecosystem still writes v9.
- The bump itself is mechanical; historical evidence (yarn 4 → 6
  introduced cacheKey, yarn 4 → 8 added `compressionLevel`) suggests
  v10 could still pair with a structural change in a later producer. Keep the
  version-specific family config isolated.
- Real-world canary first observed at: yarnpkg/berry repo self-host,
  prettier upstream.
- **Conditional-checksum policy — `conditions ∩ optionalBuilds`, version-independent.**
  A `conditions:`-bearing locator is bare iff it stays in `optionalBuilds`: reachable
  only through optional paths **and** not a resolver source (patch source, or the
  npm-backed `@jsr/*` inner locator from `JsrResolver`). A conditioned locator on a
  required path, or a patch source (`fsevents` is always builtin-patched, so its base
  `npm:` locator is hashed even when every parent edge is optional), carries a checksum
  and enrich fills a fresh one; `@esbuild/*` (exclusively-optional, no patch) stays bare.
  Verify against each pinned native producer. See
  [`_common.md` §1.7.2](./_common.md#172-structural-checksum-gaps--entries-yarn-never-hashes).

## Degradation rules

Inherits v9.

## Fixtures

> **TBD:** stable Yarn 4.17.1 is not yet bundled in the calibrated fixture
> matrix. When wired, it is the canonical v10 writer. Synthetic fixtures derived
> from v9 by bumping the `version: 10` marker (per
> [yarn-berry-v7](./yarn-berry-v7.md) precedent) are admissible for
> round-trip regression coverage until a producer is wired up.

## Open questions

> **Open native-corpus audit.** Stable 4.17.1 confirms the v10 marker; retain a
> whole-lock corpus diff against 4.14.x to pin whether any field beyond
> `__metadata.version` changed. The shared canonical
> form in [`_common.md` §1](./_common.md#1-yarn-berry-emit-invariants-version-invariant)
> is *our* canonical form; byte-identity to stable Yarn output is a bonus, not
> a contract.
