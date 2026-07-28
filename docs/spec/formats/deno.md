# `deno.lock` — Deno's native lockfile

> Status: implemented preview adapter; same-format npm-section mutation and
> manifest-backed npm-subgraph projection to all 16 Node-family formats.
> Updated: 2026-07-28.
> Provenance: **External** — emitted and frozen-verified by pinned Deno binaries.

The adapter reads `deno.lock` versions 2 through 5. It projects the native npm
resolution section into the canonical graph and keeps JSR, remote modules,
redirects, and workspace data in a same-format native sidecar. An unchanged
graph replays the original bytes exactly. A graph mutation is emitted as
canonical two-space JSON while preserving the input lockfile version.

This deliberately is not a general Deno ecosystem conversion surface. The
interop matrix supports all 16 `deno` → Node-family directions for the npm
resolution subgraph when a sibling manifest is supplied. The 16 reverse
directions remain explicitly unsupported and fail closed with
`CAPABILITY_LACK`. The supported operations are:

```text
deno.lock v2-v5 → npm subgraph audit/fix → same deno.lock version
deno.lock v2-v5 + sibling manifest → npm subgraph → Node-family lock
```

This is a lockfile-layer boundary, not an ecosystem dead end. Deno's official
[`denoland/dnt`](https://github.com/denoland/dnt) performs a source-level
Deno-to-Node transformation: it rewrites module specifiers, can localise remote
modules that have no npm mapping, and emits an npm package with `package.json`.
That output can enter Lockgraph's normal npm-family pipeline. This adapter does
not invoke `dnt`, and no composed `dnt` → Lockgraph round trip is certified here.

## Compatibility and producer oracles

| Lock version | Evidence | Frozen oracle |
| --- | --- | --- |
| v2 | structurally valid fixture plus corpus parse/replay | no separately pinned producer |
| v3 | emitted by Deno 1.44.4 | clean/restored exit 0; cold-cache tamper exit 10 |
| v4 | emitted by Deno 2.2.8 | clean/restored exit 0; cold-cache tamper exit 10 |
| v5 | emitted by Deno 2.9.4 | clean/restored exit 0; cold-cache tamper exit 1 |

Deno v1 is unsupported. The format detector and parser reject it rather than
guessing an obsolete schema.

The frozen oracle uses `deno install --frozen`, the relevant project config,
and an isolated `DENO_DIR`. The tamper leg has a fresh empty cache and must
match both the pinned exit code and the integrity/cache-failure diagnostic.
Reusing the cache from the clean leg is invalid evidence: a warm Deno cache can
mask a deliberately corrupted npm integrity value. For Deno 2.9.4,
`--lockfile-only --frozen` is also insufficient; the full install is the
verification boundary.

Clean and restored runs additionally require byte identity of `deno.lock`.
All oracle binaries are version-pinned beside the repository in ignored
scratch space; the user's global Deno installation is not changed.

## Versioned layout

The file is strict UTF-8 JSON with a string-valued top-level `version`.

| Version | Requested specifiers | JSR / npm packages | Other native sections |
| --- | --- | --- | --- |
| v2 | `npm.specifiers` | `npm.packages` | top-level `remote` |
| v3 | `packages.specifiers` | `packages.jsr`, `packages.npm` | top-level `remote`, `workspace` |
| v4 | top-level `specifiers` | top-level `jsr`, `npm` | `remote`, `redirects`, `workspace` |
| v5 | top-level `specifiers` | top-level `jsr`, `npm` | `remote`, `redirects`, `workspace` |

The exact set is sparse: a valid file need not contain every section. For v4
and v5, npm dependency references are normally compact string arrays. V2 and
v3 npm dependency references are name-to-native-id maps.

### What changes between versions

Three transitions, each a different kind of change:

| transition | change |
| --- | --- |
| v2 → v3 | sections move under a `packages` container; a `jsr` section appears for the first time; `workspace` appears |
| v3 → v4 | sections hoist back to the top level; `redirects` appears; npm dependency references change from name-to-id maps to compact string arrays |
| v4 → v5 | section layout is unchanged; the **npm entry gains eight fields** |

**v4 → v5 is the only transition that adds package metadata rather than moving
it.** Measured across the corpus, an npm entry carries:

| versions | npm entry fields |
| --- | --- |
| v2, v3, v4 | `dependencies`, `integrity` |
| v5 | the same, plus `bin`, `cpu`, `deprecated`, `optionalDependencies`, `optionalPeers`, `os`, `scripts`, `tarball` |

Two consequences follow directly.

**An upgrade to v5 cannot be performed offline.** Those eight fields do not
exist anywhere in a v4 file; they describe the package, not the resolution, and
must come from the registry. Deno's own `transform4_to_5` takes a package-info
provider for this reason, and Deno does not silently upgrade a lockfile it
reads — a v3 file loaded by a current Deno stays v3 and does not fail `--frozen`
merely for its version. Lockgraph matches that behaviour: it writes back the
version it read.

**A downgrade from v5 loses metadata that no other section carries.** Platform
constraints (`os`, `cpu`), executables (`bin`), lifecycle scripts (`scripts`)
and deprecation notices have no representation in v2–v4.

### Producers and prevalence

| lockfile version | written by | third-party corpus files |
| --- | --- | ---: |
| v2 | Deno 1.x (early) | 7 |
| v3 | Deno 1.44.4 | 25 |
| v4 | Deno 2.2.8 | 31 |
| v5 | Deno 2.9.4 | 127 |

Counts are from the measured corpus of 190 strict-JSON lockfiles taken from
repositories outside `denoland/deno`; Deno's own conformance fixtures are
excluded because they contain assertion placeholders rather than real values.
The distribution matters for tooling: **v5 is roughly two thirds of what exists
in the wild, and v2 is rare but not extinct.**

## Projection boundary

Only the npm section has a faithful mapping to the repository's Node-oriented
canonical graph:

- each native npm identity becomes a package node;
- npm dependency, optional-dependency, and projected peer relations become
  graph edges;
- npm tarball resolution and SHA-512 SRI become artifact evidence;
- npm `os`, `cpu`, deprecated, install-script, binary, and optional-peer facts
  are retained where the graph has a carrier.

JSR packages, remote URL modules, redirects, and workspace configuration have
no equivalent Node-package identity at the lockfile layer in this graph. They
remain native sidecar state for same-format replay and are not manufactured as
fake package nodes. A Node-family projection emits
`DENO_JSR_PACKAGES_DROPPED` / `DENO_REMOTE_PACKAGES_DROPPED` with exact counts.
Converting those dependencies requires transforming the source graph, for
which Deno's official
[`denoland/dnt`](https://github.com/denoland/dnt) is the supported external
path. A same-format mutation changes only the npm/specifier material required
by that mutation and retains those native sections.

`deno.lock` does not encode whether a requested dependency is a development-only
or production declaration. The lock alone therefore cannot establish that a
vulnerable package is dev-only, and the adapter deliberately does not infer
that scope from reachability. An audit or fix that needs the distinction must
also receive the sibling `deno.json`/`deno.jsonc` or `package.json` as manifest
evidence. Cross-format conversion always requires that evidence and fails
closed with `DENO_MANIFEST_REQUIRED` when it is absent. Declarations classify
root npm edges as `dep`, `dev`, `optional`, or `peer`; unresolved declarations
or unclassified lockfile roots are rejected rather than guessed.

An unresolved mandatory npm reference marks the native state unrepresentable.
Exact replay remains safe, but any structural mutation fails with
`IRREDUCIBLE_LOSS`. Optional missing references are diagnosed and likewise
prevent a mutation from claiming complete emission.

## Native npm identity and peers

A native key has the form:

```text
name@version[_peer-name@peer-version...]
```

Scoped names are supported. Parsing splits the package name from the version at
the first identity separator after the complete name, then recursively parses
the peer suffix. The raw suffix is authoritative for same-format replay and
renaming. Projected peer edges are a one-way semantic view; they never normalize
or replace a native suffix that Deno already wrote.

If the adapter cannot associate a suffix peer with one unique npm package, it
keeps the native suffix, emits a diagnostic, and declines any mutation that
would require inventing the missing association.

## Integrity

The file contains distinct integrity domains which must not be normalized into
one another:

| Section | Stored value | Meaning |
| --- | --- | --- |
| `npm` | canonical singular `sha512-…` SRI | npm registry tarball integrity |
| `jsr` | 64-character lowercase SHA-256 hex | JSR release metadata lock checksum |
| `remote` | 64-character lowercase SHA-256 hex | fetched remote-module bytes |

The emitter requires singular SHA-512 SRI and a tarball resolution for every
mutated npm node. It never derives npm SRI from JSR or remote hashes.

For JSR, the measured artifact proof is `@std/assert@1.0.19`: the SHA-256 of
the exact raw `_meta.json` response body equals the lock entry. The producer
uses an explicit `lockfile_checksum` when metadata provides one; otherwise the
raw metadata-response SHA-256 is the fallback. Individual source-file hashes
remain fields inside that metadata and are not interchangeable with the
package-level lock checksum.

### npm tarball presence policy

- If a source entry explicitly carried `tarball`, preserve the field.
- If it omitted `tarball` and the graph still uses the default npm registry URL,
  keep it omitted.
- If the graph uses a non-default tarball URL, emit it explicitly.

This prevents a semantic mutation from creating cosmetic churn while still
preserving an authoritative custom source.

## Merge conflicts

Before JSON parsing, the adapter recognizes all four line-start diff3 markers:
`<<<<<<<`, `|||||||`, `=======`, and `>>>>>>>`.

Their presence produces `DENO_MERGE_CONFLICT` and rejects parsing before any
mutation. Deno's own merge behavior can choose one side for a collision, but
the library does not guess which supply-chain claim is authoritative.

## Emission

Unchanged input is byte-exact, including ordering, whitespace, line endings,
and all native-only sections. Mutation:

1. preserves the input version;
2. renames the changed native npm identity, including dependent references;
3. rewrites requested-specifier resolutions for that version's layout;
4. rebuilds only npm entries whose graph facts changed;
5. preserves unknown top-level/native fields;
6. emits deterministic two-space JSON plus a final newline.

The committed v5 mutation fixture is byte-identical to Deno 2.9.4 output and
passes `deno install --frozen` unchanged.

The distribution-size ceiling is raised from 1140 kB to 1220 kB with this
adapter. The adapter is an intentional new public format surface; the new limit
records that cost and restores 80 kB of explicit headroom instead of leaving
the gate exactly at the measured bundle size.

## Corpus and tests

The measured corpus contains 190 real strict-JSON v2-v5 lockfiles. Every
non-conflicted file parses and replays byte-identically. Conflict fixtures are
tested separately because they are intentionally not JSON.

The unit and interop suites cover:

- v2-v5 detection, parsing, exact replay, and version-preserving mutation;
- native peer suffixes and reference rewriting;
- mandatory/optional incomplete-reference fail-closed behavior;
- tarball presence policy and integrity-domain validation;
- all diff3 markers;
- producer-compatible v5 emission;
- all 16 manifest-backed `deno` → Node-family matrix cells as supported
  conversions and all 16 reverse cells as explicit unsupported conversions;
- pinned native frozen acceptance for every supported target generation,
  including a dedicated npm-4/Node-26 gate and bundled Yarn 4.17.1/v10.

Behavioral context is documented in [`docs/spec/pm/deno.md`](../pm/deno.md);
integrity terminology follows [`_common.md`](./_common.md).
