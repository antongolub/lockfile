# `npm-2` — npm `package-lock.json` (lockfileVersion 2)

> Status: stable (adapter + flat-family round-trip suite; dual-mode drift covered).
> Updated: 2026-07-29
> Provenance: **Official**.

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| npm | `>=7 <9` | ✓ | introduced workspaces, `packages` field |
| npm | `>=9`    | – | `npm install --lockfile-version=2` |

### Readers — PM semvers that *install* from this format

| PM | semver range | Notes |
|----|--------------|-------|
| npm | `>=7` | npm 5 / 6 cannot read `lockfileVersion: 2` |

> Verified through **npm 12**: npm 7–12 read v2; npm 9–12 still emit it under
> `--lockfile-version=2` (their default output is v3).

## File

- **Filename:** `package-lock.json`
- **Encoding:** UTF-8 JSON.
- **Sibling files:** none required.

## Sources

- [npm v8 docs — package-lock.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-lock-json)
  — schema reference for v2.
- [npm v7 series blog — beta release & semver-major changes](https://blog.npmjs.org/post/626173315965468672/npm-v7-series-beta-release-and-semver-major.html)
  — narrative for the v2 introduction (`packages` block, workspaces).
- [`shrinkwrap.js` at npm v8.19.4](https://github.com/npm/cli/blob/v8.19.4/workspaces/arborist/lib/shrinkwrap.js)
  — Arborist's writer for v2 (carries the legacy v1 mirror unless `lockfileVersion=3`).

## Schema sketch

```json
{
  "name": "<root>",
  "version": "1.0.0",
  "lockfileVersion": 2,
  "requires": true,
  "packages": {
    "":                       { "name": "<root>", "workspaces": ["packages/*"] },
    "node_modules/<name>":    { "version": "1.2.3", "resolved": "...", "integrity": "...", "engines": {...} },
    "packages/<workspace>":   { "name": "@scope/ws", "version": "1.0.0" }
  },
  "dependencies": { /* legacy mirror of v1 shape, kept for back-compat */ }
}
```

## Capabilities

| Feature | Supported | Notes |
|---------|:---------:|-------|
| Workspaces (root + members)               | ✓ | keys are paths |
| Workspace protocol                        | ~ | as `*` resolution + `link: true` |
| Peer-dep virtualization                   | ✗ | still flat |
| `npm:` alias                              | ✓ | `name@npm:<other>@…` shape |
| `git` / `github` protocols                | ✓ | `resolved` carries git URL |
| `file` / `link` / `portal`                | ~ | workspace symlinks use `link: true`; a non-link `resolved` local spec parses as a directory and retains its native spelling |
| `patch:` protocol                         | ✗ | |
| Integrity hashes                          | ✓ | sha512 |
| `dev` / `optional` / `peer` separation    | ✓ | per-entry flags + `peerDependencies` block |
| Bundled deps                              | ✓ | `inBundle: true` |
| Overrides / resolutions                   | ~ | overrides applied at resolve time, not annotated |

## Integrity

The model is the shared [`_common.md` §3 integrity model](./_common.md#3-integrity-model);
this is only how npm-2 *carries* it.

- Each `packages` entry's `integrity` field is a Subresource-Integrity
  string parsed with `parseSri(…, 'sri')` and emitted with `emitSri`
  (shared `_npm-core.ts`). The hash is of the **tarball** bytes
  (`origin: 'sri'`), normally `sha512-<base64>`; legacy `sha1` entries are
  accepted and preserved verbatim.
- A space-joined multi-algorithm SRI is preserved in full as a multiset
  ([`_common.md` §3.5](./_common.md#35-the-multi-hash-case-and-the-equivalence-rule)).

## Conversion inputs

| Operation | Option       | Required? | Effect when omitted |
|-----------|--------------|:---------:|---------------------|
| Parse     | —            | none      | `packages` block names workspaces by path; lockfile is complete |
| Stringify | `manifests`  | optional  | populates per-entry `engines`, `funding`, `license`, `bin`. Without them the lockfile is emit-valid but npm 7+ may not skip incompatible installs |

## Quirks

> Model terms used below — *graph*, *layout*, *peer virtualization*,
> *workspace* — are defined in
> [`_common.md` §4](./_common.md#4-reserved-vocabulary).

- Two parallel sections: `packages` (path-keyed, layout) and `dependencies`
  (legacy v1 shape). They must stay consistent or older tooling breaks. We
  parse `packages`; we may emit both.
- The empty-string key `""` is the *root project itself*, not a workspace.
- Project-root authority comes only from a parse-captured native root or an
  explicit node with `workspacePath: ""`. DAG reachability is never project
  identity: a rootless source gets a neutral `packages[""]`, while every
  ordinary package remains installable under `node_modules`.
- `engines`, `funding`, `license` are present per entry — they're load-bearing
  for npm to skip optional/incompatible installs.
- Workspaces appear under their on-disk path (`packages/foo`) **and** as
  symlinks at `node_modules/<name>` with `link: true, resolved: "packages/foo"`.
- A non-link package entry whose `resolved` field is `file:`, `link:`, or
  `portal:` is a local directory dependency, not workspace identity. Parse
  stores the directory canonical and retains the exact protocol spelling for
  same-format replay; only `link: true` plus the bare path denotes the
  workspace-link shape above.
- A local workspace edge whose retained `workspaceRange.specifier` is empty is
  an inferred binding, not authored `workspace:` syntax. It requires workspace
  support only. A non-empty `workspace:` specifier requires the separate
  workspace-protocol capability and remains a strict projection loss for npm-2.
- **Serialization key order is `json-stringify-nice`, not `JSON.stringify`.** npm
  (via arborist's `lib/shrinkwrap.js`) orders every object's keys so scalar/array
  values precede nested objects, with a fixed
  `name, version, lockfileVersion, resolved, integrity, requires, packages,
  dependencies` prefix and the remainder alphabetical by `localeCompare('en')` —
  the `packages`/`dependencies` MAP keys included. The emitter reproduces this
  exactly, so a generated lock is byte-identical to npm's own and a MUTABLE
  `npm install` (not only the order-insensitive `npm ci`) leaves it unrewritten.
- `peerDependenciesMeta` (optional-peer markers) and `hasInstallScript` are
  preserved verbatim per entry — manifest-derived metadata npm re-adds on install
  if absent, which would otherwise force a rewrite.
- A declared `dependencies`, `devDependencies`, or `optionalDependencies`
  member that cannot bind to an installed package remains load-bearing even
  though no graph edge can represent it. Parse emits `NPM_UNRESOLVED_DEP` and
  retains the owner, edge kind, name, and range. Stringify merges only those
  retained gaps into the corresponding package-entry block, with bound graph
  edges authoritative on collision. This includes mixed blocks where one
  optional dependency binds and another does not. If output reparse loses a
  retained declaration, strict output rejects
  `COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED` as irreducible; registry
  evidence is not a remedy for preserving authored bytes.

## Degradation rules

| Feature | Action |
|---------|--------|
| Peer virtualization | **flatten** with warning |
| Patches | **strip** |

For an npm-4 source, the native raw-SRI / path patch carrier and manifest
extension fingerprints / applied provenance have no npm-2 carrier. Non-strict
conversion reports both losses (while retaining representable effective graph
edges); strict projection rejects.

For yarn-berry-v10 interchange, npm-2 inherits the Berry cross-origin boundary:
a Berry zip checksum is not emitted as tarball SRI, and npm SRI is not emitted
as a Berry checksum. The calibrated v10 → npm-2 cell also records native
resolution degradation; npm-2 → v10 records target tarball-payload loss and
synthesizes only the v10 preamble. Strict projection requires the reported
remedies rather than fabricating either digest.

The complete matrix pins the same boundary for yarn-berry-v4 through v8:
Berry → npm-2 loses the canonical resolution URL; npm-2 → Berry loses tarball
payload metadata and synthesizes the destination preamble. It also closes
npm-2 ↔ pnpm-v{5,6}: npm-2 → pnpm rekeys workspace ids and loses cross-sidecar
tarball metadata, while pnpm → npm-2 flattens peer-virtual ids. Tarball SRI
remains native and is preserved within the npm/pnpm SRI origin class.

## Fixtures

See the test-bench fixtures under [`src/test/resources/fixtures/`](../../../src/test/resources/fixtures) — `lockfiles/<case>/<format>.lock` for canonical per-case locks (`npm run build:fixtures`), `real-world/` for whole-project samples.

## Open questions

> **Open:** is `engines`/`funding`/`license` data we can reasonably *not*
> store, or is it required for emitting valid npm-2 lockfiles? Likely the
> latter — nominate `meta` as an opt-in `parse({manifests})` source.

## Unknown top-level extension keys

Pinned npm 8.19.4 accepts and byte-preserves producer-extension values at the
project root. The adapter therefore deep-clones unmodelled top-level values,
replays them only for `npm-2`, and preserves their source key placement; modeled
fields always win on collision. A detached-state or cross-format loss names
each key as `top-level:<key>` and strict conversion fails closed.
