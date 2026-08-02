# `npm-1` — npm `package-lock.json` (lockfileVersion 1)

> Status: stable (adapter + flat-family round-trip suite).
> Updated: 2026-08-02
> Provenance: **Official**.

## Compatibility

### Writers — PM semvers that *emit* this format

| PM | semver range | Default? | How to opt in |
|----|--------------|:--------:|---------------|
| npm | `>=5 <7` | ✓ | — (only format these versions know) |
| npm | `>=7 <9` | – | `npm install --lockfile-version=1` |
| npm | `>=9`    | – | writer dropped |

### Readers — PM semvers that *install* from this format

| PM | semver range | Notes |
|----|--------------|-------|
| npm | `>=5` | all npm; `>=7` auto-migrates lockfile to v2 / v3 on next install |

> Verified through **npm 12**: the v1 *writer* stays dropped (npm 9+); npm 7–12
> read v1 but auto-migrate it to v2 / v3 on the next `npm install`, so a v1 lock
> does **not** round-trip frozen-clean under modern npm — emit v3 for npm 9+
> readers.

## File

- **Filename:** `package-lock.json` (or `npm-shrinkwrap.json` for shipped libs)
- **Encoding:** UTF-8 JSON, two-space indented, trailing newline.
- **Sibling files:** none required.

## Sources

- [npm v6 docs — package-lock.json](https://docs.npmjs.com/cli/v6/configuring-npm/package-lock-json)
  — schema reference for v1.
- [`lib/install/deps.js` at npm v6.14.18](https://github.com/npm/cli/blob/v6.14.18/lib/install/deps.js)
  — install path that reads / writes lockfileVersion 1 directly
  (pre-Arborist).
- [`shrinkwrap.js` at npm v9.9.4](https://github.com/npm/cli/blob/v9.9.4/workspaces/arborist/lib/shrinkwrap.js#L478-L481)
  — Arborist's read-path branches: `lockfileVersion === 1 ? defaultLockfileVersion : …` (npm 7+ migrates v1 on read).

## Schema sketch

```json
{
  "name": "<root>",
  "version": "1.0.0",
  "lockfileVersion": 1,
  "requires": true,
  "dependencies": {
    "<name>": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/...",
      "integrity": "sha512-...",
      "dev": true,
      "optional": true,
      "requires": { "<dep>": "^1.0.0" },
      "dependencies": { /* nested in case of conflict */ }
    }
  }
}
```

## Capabilities

| Feature | Supported | Notes |
|---------|:---------:|-------|
| Workspaces (root + members)               | ✗ | conceptually pre-workspaces era |
| Workspace protocol                        | ✗ | |
| Peer-dep virtualization                   | ✗ | flat tree only |
| `npm:` alias                              | ~ | partial; needs `requires` rewriting |
| `git` / `github` protocols                | ~ | resolved URL stored in `version` |
| `file` / `link` / `portal`                | ~ | non-workspace `resolved` parses as a directory; native spelling replays exactly, canonical fallback uses `file:` |
| `patch:` protocol                         | ✗ | |
| Integrity hashes                          | ✓ | `sha512` (and legacy `sha1`) |
| `dev` / `optional` / `peer` separation    | ~ | per-entry flags, not separate buckets |
| Bundled deps                              | ✓ | `bundled: true` |
| Overrides / resolutions                   | ✗ | |

## Integrity

The model is the shared [`_common.md` §3 integrity model](./_common.md#3-integrity-model);
this is only how npm-1 *carries* it.

- Each dependency entry's `integrity` field is a Subresource-Integrity
  string parsed with `parseSri(…, 'sri')` and emitted with `emitSri`
  (shared `_npm-core.ts`). The hash is of the **tarball** bytes
  (`origin: 'sri'`).
- This is the **legacy** lockfile: modern entries carry `sha512-<base64>`,
  but older v1 locks commonly carry `sha1-<base64>` — both are preserved
  verbatim ([`_common.md` §3.0](./_common.md#30-algorithms-and-digest-encoding)).
- A space-joined multi-algorithm SRI is preserved in full as a multiset
  ([`_common.md` §3.5](./_common.md#35-the-multi-hash-case-and-the-equivalence-rule)).

## Conversion inputs

Mostly self-contained: the lockfile encodes the full hoisted tree.

| Operation | Option | Required? | Effect when omitted |
|-----------|--------|:---------:|---------------------|
| Parse     | —                | none     | lockfile is the complete input |
| Stringify | `manifests['']`  | optional | source of root `name` / `version`; otherwise a neutral root is emitted and ordinary packages remain installable, but project certification still requires the exact manifest |

## Quirks

> Model terms used below — *graph*, *node*, *edge*, *peer virtualization*,
> *workspace* — are defined in
> [`_common.md` §4](./_common.md#4-reserved-vocabulary).

- Tree shape is **layout, not graph**: nesting in `dependencies` reflects the
  hoisted `node_modules` shape, not parent-child semantic edges.
- A package can appear multiple times at different paths; entries differ.
- Project-root authority comes only from a parse-captured native root or an
  explicit node with `workspacePath: ""`. A sole DAG root is an ordinary
  dependency, not project identity; rootless input receives a neutral root.
- `requires: true` at the root is a marker, not a value.
- `optional: true` is *inherited* down the subtree without being re-emitted —
  detection is non-local.
- `"resolved": false` is npm 5/6's own marker for "no resolution URL known".
  It is written for the bundled dependencies of an optional package — the
  `fsevents` subtree is the usual carrier — and is the only non-string
  `resolved` shape observed across a 1828-lock real-world corpus. Parse treats
  it as absent, exactly as npm's reader does, and does not re-emit it; the
  entry's `integrity` beside it is retained. Any other non-string `resolved` is
  also treated as absent but reports `NPM_BAD_ENTRY` against the entry's
  install path.
- An entry in `requires` that cannot bind to any installed node is not an edge,
  but it is still a native declaration. Parse emits `NPM_UNRESOLVED_DEP` and
  retains the owner, dependency name, and range; stringify merges that fact
  back into the owner's `requires` block. Bound graph edges win on name
  collision. If a target output cannot retain the fact, its output reparse
  reports `COMPLETENESS_OUTPUT_UNRESOLVED_DECLARATION_DROPPED`; strict output
  rejects this as irreducible loss (there is no registry remedy for preserving
  an already-authored declaration).
- A `requires` or project-root edge takes its target identity from the selected
  installed entry, including that entry's own `resolved` source. It never
  inherits the consumer's source and never falls back to a bare
  `<name>@<version>` when the selected target is source-authored. Registry
  tarball identity is host-based: scheme, path, and query do not split one
  registry host, while the exact authored URL remains in `nativeResolution`
  and is replayed unchanged.
- Registry redirects are transport behaviour, not identity aliases. In
  particular, `registry.npm.taobao.org` and its successor
  `registry.npmmirror.com` remain distinct authored hosts: real locks carry
  both at once, including the same package/version in different installed
  scopes. The target entry binds each edge to the correct carrier without
  collapsing those nodes. The external npm corpus gate covers all 77 Chinese-
  mirror locks (77 parsed, zero mirror-specific seal failures), and a real
  taobao-authored npm-1 lock is round-tripped before npm verifies the emitted
  bytes with `npm ci`. This proves that npm accepts our emitted bytes, not that
  npm would author the same full file: the source lock omits neutral root fields
  that the emitter adds, so the oracle pins its authored dependency carrier and
  exact URLs rather than claiming full-file byte identity.
- **Emitted in `json-stringify-nice` key order** — the same serialiser arborist
  uses for v2/v3 (npm's `swKeyOrder` was designed to match npm 5/6's historical
  order), so a generated v1 lock is byte-identical to what npm 6 writes. See
  [npm-2 Quirks](./npm-2.md#quirks).

## Degradation rules

| Feature | Action |
|---------|--------|
| Workspaces | **fail** — emitting npm-1 from a workspace graph is unsafe |
| Peer virtualization | **flatten** — keep one instance, warn |
| Patches | **strip** with diagnostic |

For an npm-4 source, the native raw-SRI / path patch carrier and manifest
extension fingerprints / applied provenance have no npm-1 carrier. Non-strict
conversion reports both losses (while retaining representable effective graph
edges); strict projection rejects.

For a yarn-berry-v10 source, npm-1 also cannot retain Berry patch,
peer-virtual, condition, workspace, or deeply hoisted edge semantics. Its SRI
field cannot reuse a Berry zip checksum; output omits that digest and reports
the structured projection loss. The reverse direction synthesizes the v10
preamble but requires artifact bytes for a target-native Berry checksum.

The complete matrix applies the same calibrated boundary to yarn-berry-v4
through v8: Berry → npm-1 loses some nested-tree edges, canonical resolution
URLs, tarball payload metadata, and patch slots; npm-1 → Berry preserves the
representable graph, synthesizes the destination preamble, and omits SRI rather
than relabelling it as a Berry checksum. The npm-1 ↔ pnpm-v{5,6} cells are also
pinned: npm-1 → pnpm rekeys the root workspace id, while pnpm → npm-1 loses
unrepresentable edges, peer virtualization, tarball metadata, and any patch
slot the source graph carries.

## Fixtures

See the test-bench fixtures under [`src/test/resources/fixtures/`](../../../src/test/resources/fixtures) — `lockfiles/<case>/<format>.lock` for canonical per-case locks (`npm run build:fixtures`), `real-world/` for whole-project samples.

## Open questions

> **Open:** how do we round-trip `git+ssh://` URLs whose hash isn't in the
> npm registry — store the git ref or the resolved tarball URL?

## Unknown top-level extension keys

Pinned npm 6.14.18 accepts and byte-preserves producer-extension values at the
project root. The adapter therefore deep-clones unmodelled top-level values,
replays them only for `npm-1`, and preserves their source key placement; modeled
fields always win on collision. A detached-state or cross-format loss names
each key as `top-level:<key>` and strict conversion fails closed.
