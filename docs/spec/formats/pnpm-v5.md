# `pnpm-v5` — pnpm `pnpm-lock.yaml` (lockfileVersion 5.x)

> Status: stable (adapter + pnpm-flat round-trip suite; pnpm 7 default-5.4 verified).
> Updated: 2026-07-29
> Provenance: **Source-only**.

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| pnpm | `>=3 <8` | ✓ | minor bumps `5.0` … `5.4` inside this window; pnpm 7 still defaults to `5.4` (verified empirically — pm-pnpm-7 produces `lockfileVersion: 5.4`) |

### Readers — PM semvers that *install* from this format

| PM | semver range | Notes |
|----|--------------|-------|
| pnpm | `>=3` | newer pnpm auto-migrates on install |

## File

- **Filename:** `pnpm-lock.yaml`
- **Encoding:** UTF-8 YAML.
- **Sibling files:**
  - `node_modules/.modules.yaml` — install state
  - `node_modules/.pnpm/` — content-addressable instance directories
  - `.pnpmfile.cjs` — optional resolve hooks

## Sources

- [`pnpm/spec/lockfile/5.md`](https://github.com/pnpm/spec/blob/master/lockfile/5.md)
  — official schema spec for the 5.x family.
- [`pnpm/spec/lockfile/5.2.md`](https://github.com/pnpm/spec/blob/master/lockfile/5.2.md)
  — minor-version spec capturing the 5.0 → 5.2 deltas.
- [`pnpm/pnpm` types](https://github.com/pnpm/pnpm/blob/main/lockfile/types/src/index.ts)
  — TypeScript surface of the lockfile object (current main).
- [`pnpm/pnpm` lockfile package](https://github.com/pnpm/pnpm/tree/main/lockfile)
  — types / file / utils / migration code.

## Schema sketch

```yaml
lockfileVersion: 5.4

overrides:
  foo: 1.0.3

importers:
  .:
    specifiers:
      foo: ^1.0.0
    dependencies:
      foo: 1.0.3
  packages/app:
    specifiers: {...}
    dependencies: {...}

packages:
  /foo/1.0.3:
    resolution: { integrity: sha512-... }
    dependencies:
      bar: 2.0.0
  /react/18.0.0_some-peer-hash:
    resolution: { integrity: ... }
    peerDependencies:
      react: '*'
```

## Capabilities

| Feature | Supported | Notes |
|---------|:---------:|-------|
| Workspaces                                | ✓ | one `importers` entry per workspace |
| Workspace protocol                        | ✓ | `link:` resolution |
| Peer-dep virtualization                   | ✓ | encoded as `_peer-hash` suffix in package id |
| `npm:` alias                              | ✓ | |
| `git` / `github` protocols                | ✓ | |
| `file` / `link` / `portal`                | ✓ | first-class |
| `patch:` protocol                         | ✓ | via `pnpm.patchedDependencies` in package.json + lock entry |
| Integrity hashes                          | ✓ | `resolution.integrity` |
| `dev` / `optional` / `peer` separation    | ✓ | per-importer keyed buckets + `dev: true` flag |
| Bundled deps                              | ~ | rare; respected if present |
| Overrides / resolutions                   | ✓ | top-level `overrides:` block (after `lockfileVersion`), captured verbatim + re-emitted; pnpm 6–7 frozen-compare it against config |

## Integrity

The model is the shared [`_common.md` §3 integrity model](./_common.md#3-integrity-model);
this is only how pnpm *carries* it.

- Integrity lives under each `packages` entry as
  `resolution: { integrity: sha512-<base64> }` — a Subresource-Integrity
  string parsed with `parseSri(…, 'sri')` and emitted with `emitSri`
  (shared `_pnpm-flat-core.ts`). The hash is of the **tarball** bytes
  (`origin: 'sri'`).
- An `integrity`-only `resolution` block implies the **registry** tarball
  whose URL is derived by convention from `name@version` (no explicit
  `tarball:` URL is needed or emitted for the npm-registry default).
- A space-joined multi-algorithm SRI is preserved in full as a multiset
  ([`_common.md` §3.5](./_common.md#35-the-multi-hash-case-and-the-equivalence-rule)).
  This carry shape is identical across pnpm-v5 / v6 / v9.

## Conversion inputs

| Operation | Option       | Required? | Effect when omitted |
|-----------|--------------|:---------:|---------------------|
| Parse     | —            | none      | `importers` block enumerates workspaces by path |
| Stringify | `manifests`  | optional  | enriches per-package metadata; pnpm consumers may rely on `engines` for skip decisions |

## Quirks

- Package id grammar: `/<name>/<version>` for plain, `/<name>/<version>_<peerHash>`
  for peer-virtualised, `/<name>/<version>_<peerHash><sub>` for chained.
  This is **the** reference for "how pnpm encodes peerContext" — the model's
  [NodeId](./_common.md#41-nodeid) / `peerContext` vocabulary is borrowed
  verbatim from this pnpm package-id form.
- `specifiers` block in each importer mirrors the manifest's range section —
  used for upgrade detection.
- Project-root authority comes only from a parse-captured native root importer
  or an explicit node with `workspacePath: ""`. A sole DAG root remains a
  package entry; rootless input receives the native neutral importer.
- `lockfileVersion` is a **string**, not a number (`'5.4'`).
- Top-level `overrides:` block (pnpm 6–7): pnpm's frozen install
  (`--frozen-lockfile`) DEEP-COMPARES it against current config
  (`getOutdatedLockfileSetting`) and rejects with `LockfileConfigMismatchError`
  on mismatch — so an override-using project whose lock omits the block is NOT
  frozen-clean. lockgraph captures + re-emits it verbatim (after `lockfileVersion`).
- Top-level `time` block (optional) records first-seen timestamps.
- Importer `dep` / `dev` / `optional` declarations and package-entry
  `dep` / `optional` declarations can exist even when their version or
  `link:` value binds to no package/workspace node. Parse emits
  `PNPM_UNRESOLVED_DEP` and retains owner, kind, name, specifier, resolved
  value, and native channel (`importer` or `package`). Stringify restores the
  declaration to that channel; graph-derived bound edges win on collision. If
  output reparse loses it, strict output rejects
  `COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED` as irreducible, with no
  registry remedy.

## Degradation rules

| Feature | Action |
|---------|--------|
| Patches → npm-* / yarn-classic | **strip** |
| Peer virtualization → npm-* / yarn-classic | **flatten** |

For an npm-4 source, the native raw-SRI / path patch carrier is not a pnpm
patch declaration, and npm manifest-extension fingerprints / applied provenance
have no pnpm-v5 carrier. Non-strict conversion reports both losses (while
retaining representable effective graph edges); strict projection rejects.

For yarn-berry-v10 interchange, pnpm-v5 re-encodes peer virtualization but
uses a different workspace identity convention and a tarball-SRI integrity
origin. The calibrated v10 cell records workspace rekeying and tarball payload
loss; the reverse cell records peer-virtual and tarball payload loss. Missing
target integrity is reported and never fabricated.

The complete matrix pins the same directional profile for yarn-berry-v4
through v8: Berry → pnpm-v5 rekeys workspace ids and loses cross-sidecar
tarball metadata; pnpm-v5 → Berry flattens peer-virtual ids, loses tarball
metadata, and synthesizes the destination preamble. The npm-{1,2} cells are
also contract-backed. npm-1 → pnpm-v5 rekeys the root workspace id; the reverse
loses nested-tree edges, peer virtualization, and tarball metadata. npm-2 →
pnpm-v5 rekeys workspace ids and loses tarball metadata; the reverse flattens
peer-virtual ids. Integrity remains tarball SRI across npm/pnpm.

## Fixtures

> **TBD:** no pnpm fixtures carried over yet; generated via the test bench.

## Open questions

> **Open:** exact 5.0 → 5.4 differences. Some are tolerated by all 5.x
> readers, others not. Need a compat matrix.

## Unknown top-level extension keys

Pinned pnpm 7.33.7 accepts and byte-preserves producer-extension values at the
project root. The adapter deep-clones such values, replays them only for
`pnpm-v5`, and preserves their source key placement; modeled fields always win
on collision. Detached-state and cross-format losses name every
`top-level:<key>` and strict conversion fails closed.
