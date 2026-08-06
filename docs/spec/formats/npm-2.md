# `npm-2` — npm `package-lock.json` (lockfileVersion 2)

> Status: stable (adapter + flat-family round-trip suite; dual-mode drift covered).
> Updated: 2026-08-06
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

For a dependency-free project npm may omit the top-level `dependencies` key;
in that producer shape `packages` contains exactly the `""` root entry. The
adapter accepts that narrow packages-only v2 form. A packages map containing
any installed or workspace entry still requires the legacy mirror.

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
  parse `packages`; any output containing installed or workspace entries emits
  the mirror key even when its reconstructed map is empty. npm omits the mirror
  only for a dependency-free root-only lock, and minted, cross-format, or
  rebound output follows that producer rule. An explicit source-authored empty mirror is
  nevertheless replayed by the original parsed Graph; source layout is
  authoritative for an unmodified same-format replay.
- The empty-string key `""` is the *root project itself*, not a workspace.
- The whole source-authored `packages[""]` object is a native replay carrier
  shared by npm-2 and npm-3. This preserves root manifest metadata such as `license`,
  `engines`, `bin`, `funding`, `hasInstallScript`, `peerDependenciesMeta`,
  explicit empty dependency blocks, and future producer keys. Canonical Graph
  fields overlay a cloned carrier on emit; graph rebinding retains it, and the
  whole record travels across npm-2 ↔ npm-3. Minted and foreign-PM output
  fabricates none of it.
- Every installed `packages[path]` record has the corresponding path-local
  replay contract. npm can write different metadata presence or values for two
  physical paths that resolve to the same package name and version; those
  records are not interchangeable. Same-family replay therefore retains the
  whole source entry at its exact install path, including producer-extension
  keys, while canonical graph identity and dependency topology overlay the
  retained record after a mutation. Minted or foreign-PM output is generated
  from canonical package metadata and does not fabricate source-path state.
- An installed entry may carry a key the canonical package projection has no way
  to produce — `hasShrinkwrap`, `devOptional`, `extraneous`, and any key npm adds
  that this model does not represent. Such a key has exactly one carrier, the
  exact-path source record, and it needs no disagreeing sibling to be lost: there
  is simply nothing to regenerate it from. Same-family replay therefore retains
  the source record whenever it carries such a key.

  `hasShrinkwrap` shows why a key's population says nothing about its severity.
  It marks a package that ships its own `npm-shrinkwrap.json`, which npm must
  honour over the parent lock.

  > **Measured** · npm 8.19.4 and npm 11.18.0 · `npm ci` offline against a cache
  > primed only by the source install · a lock keeping
  > `packages["node_modules/ganache-core"].hasShrinkwrap` installs; a clone
  > differing only by that key's deletion fails `ENOTCACHED`.
- Physical installed placements remain authoritative even when their package
  identity equals the root project or a workspace manifest node. Same-format
  replay emits exactly the source-authored placements for those manifest
  nodes: it neither drops an authored `packages[path]` entry nor synthesizes an
  absent one. Dropping a non-link self placement can make offline npm fetch its
  `resolved` tarball and fail with `ENOTCACHED`; dropping a link placement can
  instead make npm reject the frozen lock as `Missing: ... from lock file`.
- A `link: true` entry retains its exact source key, including aliases whose
  `node_modules/<alias>` segment differs from the target package name. Its
  `resolved` value follows the current root, workspace, or external installed
  target after graph rebinding. Same-format replay does not replace an authored
  alias with a conventional `node_modules/<target-name>` link, and it does not
  create a link at either spelling when the source carried none.
- `resolved` and `integrity` are part of that path-local contract. A URL from a
  sibling installation must not replace the path's authored registry or mirror
  origin. Likewise, an authored checksum must neither disappear nor be copied
  to a source-absent path. Replacing sha1 with sha512 for the same package
  version may still verify the same tarball, but it is not exact replay;
  removing the checksum eliminates verification entirely.
- The `optional` flag belongs to the physical package entry, not merely to the
  package identity. A source-authored `optional: true` is replayed only at that
  path, and absence is not copied from another installation. This distinction
  is correctness-bearing: marking a required entry optional can make npm omit
  the reverse-dependent subtree and exit successfully instead of failing the
  required install.
- The `dev`, `peer`, and `inBundle` flags are likewise not copied from one
  physical path to a same-identity sibling. Real one-field offline controls
  show all three spreads are install-inert, including `peer` under both default
  resolution and `--legacy-peer-deps`, so this is a replay-fidelity rule. The
  mechanism alone does not predict severity: the analogous `optional` spread
  can instead omit a reverse-dependent project subtree and still exit zero.
  Separately routed source-present `dev` losses remain unclassified and are
  bounded against growth rather than folded into this sibling-spread rule.
- An installed package's native `bundleDependencies` array is retained on the
  package entry that carries it. It names dependencies shipped inside that
  package tarball; dropping the carrier can make npm externalize those contents
  and attempt registry or cache resolution that the source lock did not need.
  Canonical bundled-dependency metadata remains available for generated and
  cross-format output.
- The family boundary is producer-measured, not inferred from a general npm
  classification. The real corpus exposes the identical fourteen-key root
  vocabulary in npm-2 and npm-3, and pinned npm 8.19.4 `npm ci` returns
  `frozen-verified` for an npm-2 lock carrying an unknown `futureRootField`.
  npm-4 remains outside this carrier: the audited corpus has zero v4 locks with
  a root entry, so evidence currently stops at v3.
- Pinned npm 8.19.4 `npm ci` accepts the exact native-oracle lock after its root
  `engines` field is stripped. Root native-field replay is therefore a
  **byte-fidelity defect, not a frozen-install correctness defect**: npm does
  not need those fields for that install, but lockgraph still replays them
  because certification requires byte identity.
- Project-root authority comes only from a parse-captured native root or an
  explicit node with `workspacePath: ""`. DAG reachability is never project
  identity: a rootless source gets a neutral `packages[""]`, while every
  ordinary package remains installable under `node_modules`.
- `engines`, `funding`, `license` are present per entry — they're load-bearing
  for npm to skip optional/incompatible installs.
- Workspaces appear under their on-disk path (`packages/foo`) **and** as
  symlinks at `node_modules/<name>` with `link: true, resolved: "packages/foo"`.
- The root entry's `workspaces` field has **two** legitimate spellings, because
  npm copies it out of the root manifest verbatim and `@npmcli/map-workspaces`
  reads either: the array form `["packages/*"]`, and the object form
  `{ "packages": ["packages/*"], "nohoist": [...] }`. npm's own arborist test
  fixtures use both. Whichever is present is carried and replayed as written —
  normalising the object form to its `packages` array would emit a root entry
  that differs from the one npm writes. Neither form is what names workspace
  members in the lock; that is the `link: true` entries above. A `workspaces`
  value that is neither an array nor an object is dropped with
  `NPM_BAD_ROOT_WORKSPACES`, reported against the root package name (the root
  entry's own key is the empty string).
- An ordinary registry package installed under an npm-alias path
  (`node_modules/<alias>`) keeps its canonical package identity in the entry's
  `name` field. The emitter derives that requirement from the actual planned
  install paths, not only from an npm parse sidecar: if any path tail differs
  from the canonical node name, the shared package entry carries
  `name: <canonical>`. The same entry may therefore retain `name` at an
  additional own-name path; this is intentional and is byte-stable under npm.
- The legacy top-level `dependencies` mirror keeps the alias **install slot**
  and npm-qualified version independently from that canonical identity. For
  example, a `node_modules/pm-x` entry whose package name is
  `@yarnpkg/cli-dist` mirrors as `dependencies.pm-x.version =
  "npm:@yarnpkg/cli-dist@<version>"`; keying the mirror by the canonical name
  instead leaves npm to repopulate the alias entry on its next writing run.
- A scoped legacy-mirror slot such as `@scope/pkg` is one immediate child even
  though its package name contains `/`. A package below that scoped child is
  emitted in the scoped entry's own `dependencies` map rather than flattened
  into the scoped entry's parent. When the corresponding source
  `packages[path]` entry has `inBundle: true`, its legacy-mirror entry carries
  `bundled: true`. The legacy mirror is npm 6's install input rather than a
  derived display, so its `resolved` and `integrity` values retain the same
  per-path source fidelity while the canonical baseline remains unchanged.
- npm may write a different range spelling into the legacy mirror than into
  the authoritative `packages` entry when an override was applied. The flat
  package declaration retains the authored range (for example `^1.2.5`), while
  the matching legacy `requires` slot carries the applied exact pin (for
  example `1.2.8`). The adapter preserves that npm-2-native mirror spelling on
  the corresponding unchanged graph edge; it does not reinterpret the exact
  pin as a new graph declaration or as an npm lockfile override policy.
- Both rules are tested with a two-phase producer oracle. `npm ci` proves only
  that npm accepts the emitted lock; a subsequent write-enabled npm 11.18.0 run
  must also leave its bytes unchanged. Before these carriers were retained,
  frozen mode passed but the writer repaired the alias entry and override pin.
- Dependency-free v2 has a separate exact producer oracle: the 212-byte
  `Templarian/MaterialDesign-SVG` lock at SHA-256
  `02f1f77bdd6ccac2bd802e20aa4c7e7871b06bf295843e99a6d7fdbdf54e8d98`
  omits the mirror and carries a root `license`. It shows that a v2 lock with no
  dependencies legitimately has no `dependencies` mirror, and pinned npm 8.19.4
  accepts it under `npm ci`.
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

Per-case locks and whole-project samples, as described in [Evidence](./README.md#evidence). A claim resting on a real-world lock cites it by upstream identity at the point it is made.

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
