# Shared `deno.lock` model — Deno v2-v5

> Status: shared measured schema for the four public `deno-v2` … `deno-v5`
> adapters; same-format npm-section mutation, nine supported intra-Deno
> conversions, and manifest-backed npm-subgraph projection to all 16
> Node-family formats.
> Updated: 2026-07-28.
> Provenance: **External** — emitted and frozen-verified by pinned Deno binaries.

The four public adapters each accept exactly one `deno.lock` wire version. They
share the parser/state/emitter model described here. The model projects the native npm
resolution section into the canonical graph and keeps JSR, remote modules,
redirects, and workspace data in a same-format native sidecar. An unchanged
graph replays the original bytes exactly. A same-identity graph mutation is
emitted as canonical two-space JSON for that identity. Cross-identity emission
always uses the selected target adapter's layout and version.

This deliberately is not a general Deno ecosystem conversion surface. The
interop matrix supports all 64 concrete-Deno → Node-family directions for the
npm resolution subgraph when a sibling manifest is supplied. The 64 reverse
directions remain explicitly unsupported and fail closed with
`CAPABILITY_LACK`. The supported operations are:

```text
deno-v2 … deno-v5 → npm subgraph audit/fix → same concrete format
supported Deno source → deno-v2 / deno-v3 / deno-v4
concrete Deno source + sibling manifest → npm subgraph → Node-family lock
```

This is a lockfile-layer boundary, not an ecosystem dead end. Deno's official
[`denoland/dnt`](https://github.com/denoland/dnt) performs a source-level
Deno-to-Node transformation: it rewrites module specifiers, can localise remote
modules that have no npm mapping, and emits an npm package with `package.json`.
That output can enter Lockgraph's normal npm-family pipeline. These adapters do
not invoke `dnt`, and no composed `dnt` → Lockgraph round trip is certified here.

## Compatibility and producer oracles

| Lock version | Evidence | Frozen oracle |
| --- | --- | --- |
| v2 | structurally valid fixture plus corpus parse/replay | none exists — see below |
| v3 | emitted by Deno 1.44.4 | clean/restored exit 0; cold-cache tamper exit 10 |
| v4 | emitted by Deno 2.2.8 | clean/restored exit 0; cold-cache tamper exit 10 |
| v5 | emitted by Deno 2.9.4 | clean/restored exit 0; cold-cache tamper exit 1 |

Deno v1 is unsupported. Every concrete format detector and parser rejects it
rather than
guessing an obsolete schema.

**v2 has no producer oracle in either direction.** No pinned binary writes it, and
none preserves it: given a minimal valid v2 lock and a real dependency install on
a cold cache, 1.44.4 rewrites it to v3, 2.2.8 to v4 and 2.9.4 to v5. On 2.9.4
`--frozen` fails before that, demanding a `workspace` block — a section the v2
layout does not define. So a v2 lock cannot be certified by acceptance either, and
v2 emission is conformance to this specification alone. The v2 files in the
scraped corpus are the only external evidence for the generation.

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

#### The declared version does not determine the nesting

The `version` string names the generation that *wrote* the file. It does not
guarantee that the body nests its sections the way that row of the table says.
Two corpus files disagree with their own declaration:

| file | declares | nests as |
| --- | --- | --- |
| an ordinary Fresh + Supabase application `deno.lock` | `"3"` | v4/v5 — top-level `specifiers` and `npm`, array-form dependency references |
| `cli/fixtures/deno.lock.future`, a hand-authored fixture in a dependency-update tool | `"4"` | v3 — `packages.specifiers`, `packages.jsr`, `packages.npm` |

Deno resolves the disagreement by running its **upgrade** transforms from the
declared version up to the current one. Each transform is a no-op when its own
source section is absent, and no downgrade transform exists. So:

> **A nesting at or above the declared version is read in full. A nesting below
> it is invisible.**

Measured against the vendored 2.9.4 binary by planting a dangling specifier — a
parse-time corruption check, so it reports whether the section was *read*, not
whether it happened to agree:

| declared | nesting | Deno 2.9.4 |
| --- | --- | --- |
| v2 | v3, or v4/v5 | reads it — `Could not find 'ghost@1.0.0' in the list of packages.` |
| v3 | v4/v5 | reads it — same corruption error |
| v3 | both v3 and v4/v5 | reads the v3 one; the transform **moves it onto** the top-level keys, overwriting them |
| v4, v5 | v3 | silently discards it — no corruption error, and the next write drops the key |
| v4 | v2 | refuses — `Invalid npm package 'packages'` |

The adapter mirrors this exactly, because both halves matter:

- The v3-declared application lock holds **170 live npm packages**. Deno installs
  from it. Refusing it would refuse a file `deno install --frozen` works with, so
  the parser probes the nesting and reads them. Value shapes travel with the
  nesting, not with the declaration: that file's specifier values are already
  bare versions. Converting it to v4 now differs from the source by exactly one
  line — the version string.
- The v4-declared fixture's `packages` section is content **Deno never reads**.
  Reading it would mint a graph Deno never builds, so the adapter does not read
  it either.

The lowest populated nesting at or above the declared version wins; only a
section with at least one entry can claim a nesting, because moving an empty
section is a no-op. Every other populated section is an **orphan**, and an orphan
is declared, never dropped in silence: `DENO_ORPHANED_SECTION_IGNORED` (warning)
on parse names each section the graph does not carry, and
`DENO_ORPHANED_SECTION_DROPPED` (error) on a version conversion names each
section the emitted document cannot carry. The latter is an inherent-meaningful
projection loss, so a strict conversion fails rather than emitting a lock that is
quietly missing them.

Detection is widened to match: a `"3"` document whose only sections sit at the
top level is still detected as `deno-v3`, rather than being turned away for
carrying nothing where its declared version would have put it.

### What changes between versions

Three transitions, each a different kind of change:

| transition | change |
| --- | --- |
| v2 → v3 | sections move under a `packages` container; a `jsr` section appears for the first time; `workspace` appears |
| v3 → v4 | sections hoist back to the top level; `redirects` appears; npm dependency references change from name-to-id maps to compact string arrays; **specifier values narrow from a locator to a bare version** |
| v4 → v5 | section layout is unchanged; the **npm entry gains eight fields** |

#### The v3 → v4 specifier value narrowing is not always applied

A v3 specifier resolves to a full locator — `"npm:lodash-es@4.17.21"` — and v4
resolves to the bare `"4.17.21"`, with the native id rebuilt as `<name>@<value>`.
Three corpus files declare `"version": "4"`, use the v4 top-level section layout,
and still carry v3 locators in **every** specifier value, jsr entries included.
The rebuild then yields `lodash-es@npm:lodash-es@4.17.21`.

That is not a lookup to be repaired by stripping the prefix. Deno builds the same
id and refuses it:

```
Invalid npm package id '@types/node@npm:@types/node@18.16.19'. Invalid npm version.
```

The value is wrong, not the resolution, so the parser fails closed and names the
stale shape. Reporting it as a missing package instead — which is what the
diagnostic used to say — invites exactly the wrong repair. The v3 reader keeps
accepting the identical locator, because in a v3 document it is correct.

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
| v2 | Deno 1.x (early) | 1206 |
| v3 | Deno 1.44.4 | 1351 |
| v4 | Deno 2.2.8 | 247 |
| v5 | Deno 2.9.4 | 773 |

Counts are over the **versioned strict-JSON** population (3577 files) — see
[the three populations](#the-three-populations). Deno's own conformance fixtures
are excluded there because they carry assertion placeholders, not real values.
The distribution matters for tooling: **no generation is vestigial.** v2 and v3
together are seven files in ten — Deno does not rewrite a lockfile merely to
raise its version, so old files persist in repositories indefinitely — and v4,
the shortest-lived generation, is the rarest despite being the most recent
before v5.

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
vulnerable package is dev-only, and the adapters deliberately do not infer
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

If an adapter cannot associate a suffix peer with one unique npm package, it
keeps the native suffix, emits a diagnostic, and declines any mutation that
would require inventing the missing association.

### Mutual peer cycles unroll to arbitrary depth

When two packages peer-depend on each other, Deno writes one native id per turn
of the cycle, marking each nesting level with one more underscore:

```text
@aws-sdk/client-sso-oidc@3.623.0_@aws-sdk+client-sts@3.623.0__@aws-sdk+client-sso-oidc@3.623.0
@aws-sdk/client-sso-oidc@3.623.0_@aws-sdk+client-sts@3.623.0__@aws-sdk+client-sso-oidc@3.623.0___@aws-sdk+client-sts@3.623.0
```

One corpus lock carries **357** native ids mentioning `client-sts` for a single
pair of mutually peer-dependent packages. The canonical NodeId keys the peer
context by resolved base `name@version`, which is depth-insensitive, so every
unrolling of one base projects onto one node.

> **Census** · **scraped** population (3678 files) · counted over every scraped
> lock, including the `denoland` upstream fixtures the other two populations drop.

Measured over all 3678 scraped locks: 167 locks contain a base with more than one
unrolling, 513 base groups have more than one native id, and in **513 of 513**
every unrolling of the group carries the same integrity. Zero exceptions. A
deeper unrolling never denotes a different artifact, so the unrollings collapse
onto a single node.

Identical integrity is the **condition**, not a corollary. Two native ids that
project onto one node while carrying different integrity — or while either
proves no integrity at all — are different artifacts, and the parse refuses,
naming both ids and both integrity values. Ordinary peer-context identity is
untouched: a package resolved under two genuinely different peer sets has two
different canonical NodeIds and therefore stays two nodes, even when both
resolutions install the very same bytes.

Every native id stays in the sidecar, so same-format replay reproduces each
unrolling verbatim. The collapse is parse-side identity only: one node cannot
rebuild the distinct dependency blocks of the unrollings it stands for, so a
collapsed graph marks its native state unrepresentable and any emit other than
the byte-exact replay fails with `IRREDUCIBLE_LOSS`.

### The suffix is an opaque map key

Deno parses the suffix, uses the whole string as a map key, and never checks it
against the resolution it names. A lock relabelled to
`react-dom@19.1.1_ghost@9.9.9` — a peer naming a package present nowhere in the
file — passes `install --frozen=true`, plain `install`, and `deno ci` on a cold
`DENO_DIR`, and is not rewritten. Four further mutually incompatible relabelings
of the same lock behave identically.

Two consequences. Reproducing the exact suffix Deno would have chosen is not a
correctness requirement, so emitted ids may be canonical rather than
Deno-historical. And a lock whose suffixes are internally consistent cannot be
rejected by Deno on that ground, which makes the frozen oracle — not id equality
— the only available proof of acceptance.

### Which fields can carry a declared range

Only one. Measured over every npm entry in 153 real v5 locks, classifying each
string reference as a bare name, an exact `name@version`, or a range:

| field | bare | exact | ranged |
| --- | --: | --: | --: |
| `dependencies` | 72848 | 12428 | **0** |
| `optionalDependencies` | 5117 | 1422 | **0** |
| `optionalPeers` | 1932 | 210 | **3** |
| key suffix `_peer@version` | — | 7412 | **0** |

`optionalPeers` is the sole carrier that accepts `name@range`, and it is used that
way rarely — `encoding@^0.1.0`, `bufferutil@^4.0.1`, `utf-8-validate@^5.0.2`. Every
other reference in the file records a **resolution**, never a constraint. A
round trip through `deno.lock` therefore normalizes the declared range of an
ordinary dependency, an optional dependency, and a non-optional peer to the exact
resolved version, and only an optional peer's range can be preserved verbatim.

Concretely: `react-dom` declaring `peerDependencies.react = "^19.2.0"` comes back
from a round trip as `19.2.8`. The normalization is a property of the format, not
of any adapter, and an emitter may treat it as expected only for a **resolved**
reference whose exact version the emitted carrier actually holds. An
**unresolved** non-optional peer has no carrier at all, and dropping one is a
real loss rather than a normalization.

### `optionalPeers` has three states, and two producers disagree

Measured on `node-fetch@2.7.0`, which declares `encoding` as an optional peer:

| situation | what the producer writes |
| --- | --- |
| optional peer absent from the tree, fresh install on 2.9.4 | no `optionalPeers` key at all |
| optional peer present in the tree | key gains a peer suffix — `node-fetch@2.7.0_encoding@0.1.13` — and the entry carries `optionalPeers: ["encoding"]`, a bare name, with `encoding` also listed in `dependencies` |
| real corpus lock produced by the v4→v5 upgrade | `optionalPeers: ["encoding@^0.1.0"]`, ranged, with `encoding` absent from the file entirely |

So the ranged shape comes from the version-upgrade path, not from a fresh
resolve: a fresh 2.9.4 install of the same package omits the field that
`transform4_to_5` writes. Both are accepted on read — 1469 entries across the
corpus carry `optionalPeers` — but a byte-identity claim must name which producer
path it was compared against. The bare shape is legal only when the package is
present in `npm`; the ranged shape is always legal.

## Integrity

The file contains distinct integrity domains which must not be normalized into
one another:

| Section | Stored value | Meaning |
| --- | --- | --- |
| `npm` | canonical singular `sha512-…` SRI, or a bare 40-character lowercase SHA-1 hex shasum | npm registry tarball integrity |
| `jsr` | 64-character lowercase SHA-256 hex | JSR release metadata lock checksum |
| `remote` | 64-character lowercase SHA-256 hex | fetched remote-module bytes |

The emitter requires a tarball resolution and a SHA-512 member for every mutated
npm node, and selects that member. A multi-member SRI is legal input: 9.8 % of
npm-3 nodes and 7.3 % of yarn-classic nodes carry `sha1` alongside `sha512`, so
requiring a singular value would reject roughly one node in ten of every real
npm-3 lock. Deno stores exactly one member; selection happens on emit, never by
narrowing the graph. The emitter never derives npm SRI from JSR or remote hashes.

### npm integrity has a second, non-SRI shape

Deno stores whatever `dist.integrity()` yields for the resolved packument: the
registry's own `integrity` string when it has one, otherwise the legacy
`dist.shasum` as **bare lowercase hex, with no `sha1-` prefix and no base64**.

registry.npmjs.org always supplies `integrity`, so 310 462 of the 310 478 npm
entries across the v3/v4/v5 corpus are canonical singular `sha512-…` SRI. The
other 16 are one lock resolved through a cnpm mirror — all 16 entries carry an
explicit `tarball` on `registry.m.jd.com`, and cnpm packuments serve only
`shasum`. Deno 2.9.4 reads that lock without complaint, so refusing it was a
defect here, not in the file.

The hex digest is carried as a `sha1` hash tagged `registry`, because it *is*
`dist.shasum` verbatim. That origin is tarball-scoped, so it re-encodes into
another family's SRI field as `sha1-<base64>` — exactly what npm itself writes
for a shasum-only package — while the yarn-classic `url-fragment` sha1 stays
excluded from this field, as it must. On emit the sha512 is preferred; the bare
shasum is written only when it is the sole tarball digest the node proves, which
is precisely when Deno would write it too.

Uppercase hex is refused rather than normalised: canonicality is the byte-replay
condition, not a matter of taste.

### An absent `jsr` integrity is refused, and is not a malformed one

Eight `jsr` entries across two v3 corpus files carry no `integrity` key at all —
`{"dependencies": ["jsr:@std/fmt@^0.216.0"]}`, or just `{}`. Absence is not
malformation and does not share its diagnostic; reporting "must be lowercase
SHA-256 hex" for a field that is not there sends the reader hunting a corrupt
digest that does not exist.

Absence is nonetheless **refused**. This is the opposite of the v5
patched-package case below, where Deno's own printer declares `integrity`
optional and Deno reads the file back. Here every Deno that can open the
document rejects it:

| oracle | message |
| --- | --- |
| 1.44.4, contemporary with these v3 files | ``Unable to parse contents of lockfile […] missing field `integrity` `` |
| 2.9.4 | ``Invalid jsr section: missing field `integrity` `` |

Both files date from the first weeks of `jsr:` support; they are orphans of a
producer whose successors will not read its output. Accepting them would mint a
graph no Deno can install from. Every `jsr` integrity that *is* present anywhere
in the corpus — 12 301 of them — is well-formed lowercase SHA-256 hex, so a
genuinely malformed value has never been observed.

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

Before JSON parsing, every adapter recognizes all four line-start diff3 markers:
`<<<<<<<`, `|||||||`, `=======`, and `>>>>>>>`.

Their presence produces `DENO_MERGE_CONFLICT` and rejects parsing before any
mutation. Deno's own merge behavior can choose one side for a collision, but
the library does not guess which supply-chain claim is authoritative.

## Emission

Unchanged same-identity input is byte-exact, including ordering, whitespace,
line endings, and all native-only sections. Same-identity mutation:

1. emits the selected adapter's version;
2. renames the changed native npm identity, including dependent references;
3. rewrites requested-specifier resolutions for that version's layout;
4. rebuilds only npm entries whose graph facts changed;
5. preserves unknown top-level/native fields;
6. emits deterministic two-space JSON plus a final newline.

Deno 2.9.4 accepts a lock in this shape under `deno install --frozen` without
rewriting it.

The distribution-size ceiling is raised from 1140 kB to 1220 kB with this
shared implementation. The four adapters are intentional new public format
surfaces; the new limit
records that cost and restores 80 kB of explicit headroom instead of leaving
the gate exactly at the measured bundle size.

The declaration-only ceiling is raised from 123 kB to 135 kB because the
single preview entry point became four concrete public subpaths. The roughly
10% headroom records the four independently importable type surfaces without
hiding them behind one schema-ambiguous declaration.

## Corpus and tests

### The three populations

Counts in this file are taken from three **nested** sets, not one corpus. Every
census elsewhere in the document names which one it used; if a number here looks
like it disagrees with another, check the population before the number.

| Population | Files | What it is |
| --- | --: | --- |
| scraped | 3678 | everything pulled from public repositories |
| real | 3581 | scraped, minus `denoland` upstream fixtures — those carry deliberate `[WILDCARD]` placeholders and tamper cases rather than real values |
| versioned strict-JSON | 3577 | real, minus 3 merge-conflicted files that are not strict JSON and 1 pre-v2 flat URL-to-hash map with no `version` key |

The **real** population contains **3581 lockfiles** spanning all four
generations. Three are merge-conflicted and therefore not strict JSON, one
is the pre-v2 flat URL-to-hash map with no `version` key, and 6 are refused on
parse. The gate asserts this as a property rather than a file count — the corpus
is gitignored scratch that grows whenever it is re-scraped, so an exact count
would only be green for whoever scraped last.

**Every remaining refusal is a document Deno itself refuses**, verified by
running each file through the vendored oracle binaries. Refusing them is
agreement with the producer, not a gap here:

| refusal | files | Deno's own verdict |
| --- | --: | --- |
| specifier value is a lockfile-v3 locator in a v4 document | 3 | `Invalid npm package id '@types/node@npm:@types/node@18.16.19'. Invalid npm version.` — the same id this adapter builds |
| `jsr` entry has no `integrity` field | 2 | ``Invalid jsr section: missing field `integrity` `` (2.9.4); ``missing field `integrity` `` (1.44.4) |
| specifier references an npm package absent from the file | 1 | `The lockfile is corrupt. […] Could not find '@types/node@24.2.0' in the list of packages.` |

Closed classes are deleted from the gate's known-refusal map rather than left at
zero, so a recurrence fails as an *unexpected* refusal instead of being absorbed
into a count nobody reads:

- **14 files whose native npm ids collapsed onto one canonical NodeId** — those
  ids are cycle unrollings of one artifact and now share one node (see *[Mutual
  peer cycles unroll to arbitrary
  depth](#mutual-peer-cycles-unroll-to-arbitrary-depth)*). The surviving refusal
  — two ids that collapse while carrying *different* integrity — has never been
  observed.
- **15 v5 locks that failed to seal peer edges** — an aliased optional peer
  (`ajv-formats@3.0.1_@redocly+ajv@8.18.1` with `optionalPeers:
  ["ajv@npm:@redocly/ajv@8.18.1"]`) appeared both as a declaration and as its
  native suffix target, contributing two peer edges where the node's peerContext
  records one base. The alias declaration now owns that projection.
- **5 v5 workspace-linked patch packages with neither integrity nor tarball** —
  Deno writes `{}` for a patched package and its printer declares `integrity`
  optional for exactly that case. The absence is now recognised as
  source-authoritative without permitting mutation-time synthesis.
- **1 lock whose npm integrity was not canonical SRI** — a cnpm mirror's bare
  `dist.shasum` hex (see *[npm integrity has a second, non-SRI
  shape](#npm-integrity-has-a-second-non-sri-shape)*).
- **2 files reported as malformed `jsr` integrity** — their entries carry no
  `integrity` key at all, and absence is not malformation. They moved to their
  own class; a genuinely malformed `jsr` digest has still never been seen.

The unit and interop suites cover:

- disjoint v2-v5 detection, parsing, exact replay, and target-driven mutation;
- all nine supported intra-Deno conversions, with pinned frozen target-native
  acceptance for every v3/v4 target and structural parse/emit proof for v2;
- explicit fail-closed v2/v3/v4 → v5 cells until complete package metadata and
  dependency/optional/peer edge-reclassification evidence exists;
- native peer suffixes and reference rewriting;
- mandatory/optional incomplete-reference fail-closed behavior;
- tarball presence policy and integrity-domain validation;
- all diff3 markers;
- producer-compatible v5 emission;
- all 64 manifest-backed concrete-Deno → Node-family matrix cells as supported
  conversions and all 64 reverse cells as explicit unsupported conversions;
- pinned native frozen acceptance for every supported target generation,
  including a dedicated npm-4/Node-26 gate and bundled Yarn 4.17.1/v10.

Public entry pages are [`deno-v2.md`](./deno-v2.md),
[`deno-v3.md`](./deno-v3.md), [`deno-v4.md`](./deno-v4.md), and
[`deno-v5.md`](./deno-v5.md). Behavioral context is documented in
[`docs/spec/pm/deno.md`](../pm/deno.md);
integrity terminology follows [`_common.md`](./_common.md).
